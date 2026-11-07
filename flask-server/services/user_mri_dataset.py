"""User MRI collection with its own admission gate: the MRI sibling of ``user_dataset`` (which keeps CTs).

When a user sends a scan to the server for segmentation we may keep it, but only if it passes a gate. The CT gate
(``user_dataset``) is about CTs and their organ masks and turns an MRI away. This module is the MRI version. There is
no mask: nothing here is segmented, and nothing in the folder is human-verified. The gate has these jobs:

  1. Is it an MRI?          -- a 3D volume with no CT signature (no air band near -1000, no negative HU range).
                               A CT, or anything that cannot be told apart, is ignored without a trace: this runs on
                               every upload, so it must not log, count or reject the CTs.
  2. Is it usable?          -- not empty, not noise, not saturated, plausible size, resolution not clearly poor.
  3. Is it a duplicate?     -- exact (file hash) and near (a coarse content hash, intensity-scale free).
  4. Is it abuse?           -- the same per-user / per-address / global daily caps as the CT collection, a size cap,
                               and a free-disk floor.

Accepted scans are stored beside the CT collection, in the same layout, under ``USER_MRI_DATASET_PATH``:

    UserDataMRI/
      image_only/USER_MRI_00000001/mri.nii.gz
      image_only/USER_MRI_00000001/metadata.json
      registry.json           # id counter, fingerprints, rolling quota events
      rejections.jsonl        # what was turned away and why

Every case's metadata.json carries ``quality_tier`` ("high" or "standard"), ``tier_blockers`` (what held a case back),
the geometry and intensity statistics, and ``modality: "MR"``. The pulse sequence (T1, T2, FLAIR, ...) is not
recorded: it cannot be read reliably from a NIfTI file.

The whole feature is inert unless ``USER_MRI_DATASET_PATH`` is set. Collection runs on a daemon thread after the job is
accepted and never affects the request or the job; every failure is swallowed.
"""
from __future__ import annotations

import json
import os
import shutil
import threading
import time
import traceback
from datetime import datetime, timezone
from typing import Optional

from services import user_dataset as ud

TIER_RULE = 1


def _f(name: str, default: str) -> float:
    return float(os.environ.get(name, default))


# --- tunables (all overridable via env) ---
MAX_BYTES = int(os.environ.get("USER_MRI_DATASET_MAX_BYTES", str(2 * 1024 ** 3)))
MAX_VOXELS = int(os.environ.get("USER_MRI_DATASET_MAX_VOXELS", str(1_000_000_000)))
# Resolution. MRI is coarser than CT, especially through the slices; refuse only what is clearly poor.
MAX_SLICE_MM = _f("USER_MRI_DATASET_MAX_SLICE_MM", "8.0")
MAX_INPLANE_MM = _f("USER_MRI_DATASET_MAX_INPLANE_MM", "2.5")
HIGH_SLICE_MM = _f("USER_MRI_DATASET_HIGH_SLICE_MM", "3.0")
HIGH_INPLANE_MM = _f("USER_MRI_DATASET_HIGH_INPLANE_MM", "1.2")
# Image quality, from the voxel values. Foreground is "clearly brighter than the darkest 1%".
MIN_FOREGROUND = _f("USER_MRI_DATASET_MIN_FOREGROUND", "0.03")
HIGH_FOREGROUND = _f("USER_MRI_DATASET_HIGH_FOREGROUND", "0.08")
MIN_SNR = _f("USER_MRI_DATASET_MIN_SNR", "3.0")
HIGH_SNR = _f("USER_MRI_DATASET_HIGH_SNR", "10.0")
MAX_SATURATION = _f("USER_MRI_DATASET_MAX_SATURATION", "0.2")
# A real image is spatially smooth (neighbouring voxels agree); noise or a corrupt file is not.
MIN_SMOOTHNESS = _f("USER_MRI_DATASET_MIN_SMOOTHNESS", "0.5")
HIGH_SATURATION = _f("USER_MRI_DATASET_HIGH_SATURATION", "0.02")
SAMPLE_VOXELS = 16_000_000   # the statistics are measured on a strided sample of at most this many voxels
NEAR_DUP_GRID = 24
_CORNER = 0.12               # in-plane corner blocks (as a fraction of each side) used to measure background noise
_last_disk_note = 0.0


def _root() -> Optional[str]:
    p = os.environ.get("USER_MRI_DATASET_PATH", "").strip()
    return p or None


# ---------------------------------------------------------------------------
# Reading
# ---------------------------------------------------------------------------
def _sample(path: str):
    """(sample, shape): the volume as a strided float32 3D array of at most SAMPLE_VOXELS voxels."""
    import math

    import nibabel as nib
    import numpy as np

    img = nib.load(path)
    shape = tuple(int(d) for d in img.shape)
    big = [d for d in shape if d > 1]
    voxels = 1
    for d in big:
        voxels *= d
    stride = max(1, math.ceil((voxels / SAMPLE_VOXELS) ** (1 / 3)))
    index = tuple(slice(None, None, stride) if d > 1 else slice(None) for d in shape)
    arr = np.squeeze(np.asarray(img.dataobj[index], dtype="float32"))
    return arr, shape


def validate_header(path: str):
    """(ok, reason, shape). Cheap, header only: size, readable, exactly 3 non-trivial axes, plausible dimensions."""
    try:
        import nibabel as nib
    except Exception as e:  # pragma: no cover
        return False, f"deps_missing:{e}", None
    try:
        size = os.path.getsize(path)
    except OSError:
        return False, "unstatable", None
    if size > MAX_BYTES:
        return False, "too_large", None
    if size < 5 * 1024:
        return False, "too_small", None
    try:
        shape = tuple(int(d) for d in nib.load(path).shape)
    except Exception as e:
        return False, f"unreadable:{type(e).__name__}", None
    dims = [d for d in shape if d > 1]
    if len(dims) != 3:
        return False, f"not_3d:{list(shape)}", shape
    if any(d < 16 or d > 2048 for d in dims):
        return False, f"implausible_dims:{dims}", shape
    voxels = 1
    for d in dims:
        voxels *= d
    if voxels > MAX_VOXELS:
        return False, f"too_many_voxels:{voxels}", shape
    return True, "ok", shape


def classify(arr) -> str:
    """"ct", "mri" or "unknown" from the voxel values alone.

    A CT has an air band near -1000 HU (outside the body) or a negative HU range (fat, lung); an MRI is
    non-negative, or at most slightly negative after bias correction. A deep negative range that does not look like
    HU (a z-scored volume goes about -3 to 8, so it is not that) is "unknown" and is left alone.
    """
    import numpy as np

    v = arr.ravel()
    lo = float(v.min())
    if float(np.mean((v <= -900) & (v >= -1100))) >= 0.01:
        return "ct"
    if lo <= -150:
        return "ct" if float(np.mean(v < -50)) >= 0.02 else "unknown"
    return "mri"


def _lag1(arr) -> float:
    import numpy as np

    a, b = arr[:-1].ravel(), arr[1:].ravel()
    if a.std() == 0 or b.std() == 0:
        return 0.0
    return float(np.corrcoef(a, b)[0, 1])


def quality_stats(arr) -> Optional[dict]:
    """Foreground fraction, a noise estimate, saturation and the intensity span. None when there is no signal."""
    import numpy as np

    v = arr.ravel()
    p1, p995 = (float(x) for x in np.percentile(v, [1, 99.5]))
    span = p995 - p1
    if not np.isfinite(span) or span <= 0:
        return None
    threshold = p1 + 0.15 * span
    foreground = v > threshold
    stats = {
        "intensity_p1": round(p1, 4), "intensity_p99_5": round(p995, 4),
        "foreground_fraction": round(float(foreground.mean()), 4),
        "saturation": round(float(np.mean(v >= float(v.max()) - 0.001 * span)), 4),
        "snr": None,
        # How much neighbouring voxels agree (lag-1 correlation along two axes): about 1 for an image, about 0 for noise.
        "smoothness": round((_lag1(arr) + _lag1(arr.transpose(1, 0, 2))) / 2, 3),
    }
    # Noise: the in-plane corners are air in almost every MRI. A corner block counts as background when most of it
    # is dark; its whole spread (not just the dark tail, which would hide the noise) is the noise estimate.
    x, y = arr.shape[0], arr.shape[1]
    cx, cy = max(1, int(x * _CORNER)), max(1, int(y * _CORNER))
    blocks = [arr[:cx, :cy], arr[-cx:, :cy], arr[:cx, -cy:], arr[-cx:, -cy:]]
    dark = [b.ravel() for b in blocks if float(np.median(b)) <= threshold]
    background = np.concatenate(dark) if dark else np.empty(0, dtype=arr.dtype)
    if background.size >= 500 and foreground.any():
        spread = float(background.std())
        # A background that is exactly constant (a skull-stripped or masked scan) has no noise to measure.
        if spread > 1e-6 * span:
            stats["snr"] = round((float(v[foreground].mean()) - float(background.mean())) / spread, 2)
    return stats


def resolution_gate(geometry: dict):
    """(ok, reason). Header only, so a clearly poor scan is turned away before decoding anything."""
    zooms = sorted(float(z) for z in geometry.get("spacing_mm", []) if z and z > 0)
    if len(zooms) != 3:
        return False, "no_voxel_spacing"
    if zooms[2] > MAX_SLICE_MM:
        return False, f"slices_too_thick:{zooms[2]:.2f}mm"
    if zooms[1] > MAX_INPLANE_MM:
        return False, f"in_plane_too_coarse:{zooms[1]:.2f}mm"
    return True, "ok"


def quality_gate(stats: Optional[dict]):
    """(ok, reason): usable at all."""
    if not stats:
        return False, "no_signal"
    if stats.get("smoothness", 1.0) < MIN_SMOOTHNESS:
        return False, f"no_structure:{stats['smoothness']}"
    if stats["foreground_fraction"] < MIN_FOREGROUND:
        return False, f"mostly_empty:{stats['foreground_fraction']:.3f}"
    if stats["saturation"] > MAX_SATURATION:
        return False, f"saturated:{stats['saturation']:.3f}"
    if stats["snr"] is not None and stats["snr"] < MIN_SNR:
        return False, f"too_noisy:snr={stats['snr']}"
    return True, "ok"


def tier_blockers(geometry: dict, stats: dict) -> list:
    """Why a case is not "high" (empty when it is)."""
    zooms = sorted(float(z) for z in (geometry or {}).get("spacing_mm", []) if z and z > 0)
    if len(zooms) != 3:
        return ["no_voxel_spacing"]
    out = []
    if zooms[2] > HIGH_SLICE_MM:
        out.append(f"slices:{zooms[2]:.2f}mm")
    if zooms[1] > HIGH_INPLANE_MM:
        out.append(f"in_plane:{zooms[1]:.2f}mm")
    stats = stats or {}
    if stats.get("snr") is not None and stats["snr"] < HIGH_SNR:
        out.append(f"snr:{stats['snr']}")
    if stats.get("foreground_fraction", 1) < HIGH_FOREGROUND:
        out.append(f"foreground:{stats['foreground_fraction']}")
    if stats.get("saturation", 0) > HIGH_SATURATION:
        out.append(f"saturation:{stats['saturation']}")
    return out


def quality_tier(geometry: dict, stats: dict) -> str:
    """"high" or "standard": a label stored with each case, not a gate."""
    return "standard" if tier_blockers(geometry, stats) else "high"


def near_fingerprint(arr) -> str:
    """A coarse content hash that ignores intensity scale and compression: block-average to a small grid, normalise
    by the scan's own 99.5th percentile, quantise, hash."""
    import hashlib

    import numpy as np

    g = NEAR_DUP_GRID
    idx = [np.linspace(0, s, g + 1).astype(int) for s in arr.shape[:3]]
    small = np.zeros((g, g, g), dtype="float32")
    for i in range(g):
        for j in range(g):
            for k in range(g):
                blk = arr[idx[0][i]:idx[0][i + 1], idx[1][j]:idx[1][j + 1], idx[2][k]:idx[2][k + 1]]
                small[i, j, k] = float(blk.mean()) if blk.size else 0.0
    scale = float(np.percentile(arr, 99.5)) or 1.0
    q = np.round(small / scale * 10.0).astype("int16")
    return hashlib.sha256(q.tobytes()).hexdigest()


# ---------------------------------------------------------------------------
# Promotion and orchestration
# ---------------------------------------------------------------------------
def _promote(root: str, case_id: str, path: str, metadata: dict) -> None:
    """Write the case into a ``.partial`` staging dir, then publish it with one atomic rename, so a failure (disk
    full, killed thread) never leaves a half-written case behind."""
    final = os.path.join(root, "image_only", case_id)
    stage = final + ".partial"
    shutil.rmtree(stage, ignore_errors=True)
    try:
        os.makedirs(stage, exist_ok=True)
        ud._store_nifti_gz(path, os.path.join(stage, "mri.nii.gz"))
        with open(os.path.join(stage, "metadata.json"), "w", encoding="utf-8") as f:
            json.dump({**metadata, "case_id": case_id}, f, indent=2)
        os.replace(stage, final)
    except Exception:
        shutil.rmtree(stage, ignore_errors=True)
        raise


def _admit_and_store(path: str, user_id: Optional[str], ip: Optional[str], session_id: Optional[str]) -> None:
    root = _root()
    if not root or not os.path.isfile(path):
        return
    ctx = {"user_id": user_id, "ip": ip, "session_id": session_id, "modality": "MR"}
    try:
        os.makedirs(root, exist_ok=True)

        # 1) Is it an MRI? Everything before this point must leave no trace: it runs on every upload.
        ok, _reason, _shape = validate_header(path)
        if not ok:
            return
        with ud._HEAVY_WORK:
            sample, _ = _sample(path)
            import numpy as np
            if not np.isfinite(sample).all() or float(sample.min()) == float(sample.max()):
                return
            if classify(sample) != "mri":
                return
        now = time.time()

        # 0) Disk floor.
        if not ud.has_room_for(root, path):
            global _last_disk_note
            if now - _last_disk_note > 3600:    # one line an hour, not one per upload
                _last_disk_note = now
                ud._record_rejection(root, "disk_floor", ctx)
                print("[user_mri_dataset] paused: not enough free disk space", flush=True)
            return

        # 2) Quota and attempt accounting. From here on this is an MRI, so rejections are recorded.
        with ud._locked(root):
            reg = ud._load_registry(root)
            ud._prune_events(reg, now)
            ok, qreason = ud.check_quota(reg, user_id, ip, now)
            reg["events"].append({"ts": now, "user_id": user_id, "ip": ip})
            ud._save_registry(root, reg)
        if not ok:
            ud._record_rejection(root, qreason, ctx)
            return

        # 3) Cheapest first: an exact repeat is recognised from the file hash, before anything is measured.
        sha = ud.file_sha256(path)
        with ud._locked(root):
            seen = ud._load_registry(root)["sha256"].get(sha)
        if seen:
            ud._record_rejection(root, "duplicate_exact", {**ctx, "of": seen})
            return

        # 4) Resolution from the header, then the voxel statistics.
        geometry = ud.scan_geometry(path)
        ok, reason = resolution_gate(geometry)
        if not ok:
            ud._record_rejection(root, reason, {**ctx, **geometry})
            return
        with ud._HEAVY_WORK:
            sample, _ = _sample(path)
            stats = quality_stats(sample)
            ok, reason = quality_gate(stats)
            if not ok:
                ud._record_rejection(root, reason, {**ctx, **geometry, "stats": stats})
                return
            phash = near_fingerprint(sample)

        # 5) Dedup, reserve an id, promote atomically, commit: under the lock, and short.
        with ud._locked(root):
            reg = ud._load_registry(root)
            if sha in reg["sha256"]:
                ud._record_rejection(root, "duplicate_exact", {**ctx, "of": reg["sha256"][sha]})
                return
            if phash in reg["phash"]:
                ud._record_rejection(root, "duplicate_near", {**ctx, "of": reg["phash"][phash]})
                return
            case_id = "USER_MRI_%08d" % reg["next_id"]
            metadata = {
                # No IP here: it is kept only in the short-lived abuse accounting.
                "user_id": user_id, "session_id": session_id, "modality": "MR",
                **geometry, "quality_tier": quality_tier(geometry, stats), "tier_rule": TIER_RULE,
                "tier_blockers": tier_blockers(geometry, stats), "image_stats": stats,
                "collected_at": datetime.now(timezone.utc).isoformat(), "sha256": sha, "phash": phash,
            }
            _promote(root, case_id, path, metadata)
            reg["next_id"] += 1
            reg["sha256"][sha] = case_id
            reg["phash"][phash] = case_id
            ud._save_registry(root, reg)
            print(f"[user_mri_dataset] admitted {case_id} (user={user_id})", flush=True)
    except Exception:
        print(f"[user_mri_dataset] collection error (non-fatal):\n{traceback.format_exc()}", flush=True)


def collect_user_mri_async(path: str, user_id: Optional[str] = None, ip: Optional[str] = None,
                           session_id: Optional[str] = None) -> None:
    """Fire-and-forget: offer an uploaded scan to the MRI gate. Returns at once; the gate runs on a daemon thread.
    A no-op unless USER_MRI_DATASET_PATH is set."""
    if not _root():
        return
    threading.Thread(
        target=_admit_and_store, args=(path, user_id, ip, session_id),
        name=f"user-mri-dataset-{session_id or 'x'}", daemon=True,
    ).start()
