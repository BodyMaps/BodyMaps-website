"""The MRI collection gate: what it keeps, what it turns away, and what it must ignore without a trace."""
import json
import os

import nibabel as nib
import numpy as np
import pytest

from services import user_dataset as ud
from services import user_mri_dataset as um


@pytest.fixture
def mri(tmp_path, monkeypatch):
    root = tmp_path / "UserDataMRI"
    monkeypatch.setenv("USER_MRI_DATASET_PATH", str(root))
    monkeypatch.setattr(ud, "MIN_FREE_BYTES", 0)
    monkeypatch.setattr(um, "_last_disk_note", 0.0)
    return root


def _head(shape=(64, 64, 32), noise=3.0, seed=0, peak=300.0):
    """A bright head-like ellipsoid with texture on a dark noisy background, like a brain MRI."""
    rng = np.random.default_rng(seed)
    x, y, z = np.meshgrid(*[np.linspace(-1, 1, n) for n in shape], indexing="ij")
    inside = (x / 0.8) ** 2 + (y / 0.8) ** 2 + (z / 0.9) ** 2 < 1
    volume = rng.normal(8.0, noise, shape)
    volume[inside] = peak + 40 * rng.standard_normal(inside.sum()) + 60 * np.sin(6 * x[inside])
    return np.clip(volume, 0, None).astype("float32")


def _save(path, data, zooms=(1.0, 1.0, 2.0), dtype=None):
    affine = np.diag([zooms[0], zooms[1], zooms[2], 1.0])
    data = data.astype(dtype) if dtype else data
    nib.save(nib.Nifti1Image(data, affine), str(path))
    return str(path)


def _admit(path, user="u1", ip="1.2.3.4", session="s1"):
    um._admit_and_store(str(path), user, ip, session)


def _cases(root):
    folder = root / "image_only"
    return sorted(p.name for p in folder.iterdir() if not p.name.endswith(".partial")) if folder.exists() else []


def _rejections(root):
    path = root / "rejections.jsonl"
    return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []


# ---- what is kept -----------------------------------------------------------------------------------------

def test_a_good_mri_is_kept_with_its_metadata(mri, tmp_path):
    path = _save(tmp_path / "a.nii.gz", _head(), zooms=(0.9, 0.9, 1.0))
    _admit(path)
    assert _cases(mri) == ["USER_MRI_00000001"]
    folder = mri / "image_only" / "USER_MRI_00000001"
    assert nib.load(str(folder / "mri.nii.gz")).shape == (64, 64, 32)
    meta = json.loads((folder / "metadata.json").read_text())
    assert meta["modality"] == "MR" and meta["quality_tier"] == "high" and meta["tier_blockers"] == []
    assert meta["case_id"] == "USER_MRI_00000001" and meta["user_id"] == "u1" and meta["session_id"] == "s1"
    assert meta["shape"] == [64, 64, 32] and meta["spacing_mm"] == [0.9, 0.9, 1.0]
    assert len(meta["sha256"]) == 64 and meta["image_stats"]["foreground_fraction"] > 0.2
    assert "ip" not in meta and "1.2.3.4" not in json.dumps(meta)  # the address is only in short-lived accounting


def test_thick_slices_make_it_standard_not_refused(mri, tmp_path):
    _admit(_save(tmp_path / "a.nii.gz", _head(), zooms=(0.9, 0.9, 5.0)))
    meta = json.loads((mri / "image_only" / "USER_MRI_00000001" / "metadata.json").read_text())
    assert meta["quality_tier"] == "standard" and any(b.startswith("slices:") for b in meta["tier_blockers"])


def test_ids_count_up(mri, tmp_path):
    _admit(_save(tmp_path / "a.nii.gz", _head(seed=1)))
    _admit(_save(tmp_path / "b.nii.gz", _head(seed=2, peak=420.0)))
    assert _cases(mri) == ["USER_MRI_00000001", "USER_MRI_00000002"]
    assert json.loads((mri / "registry.json").read_text())["next_id"] == 3


def test_an_uncompressed_upload_is_stored_as_real_gzip(mri, tmp_path):
    path = _save(tmp_path / "a.nii", _head())
    _admit(path)
    stored = mri / "image_only" / "USER_MRI_00000001" / "mri.nii.gz"
    assert stored.read_bytes()[:2] == b"\x1f\x8b" and nib.load(str(stored)).shape == (64, 64, 32)


# ---- what is ignored without a trace ----------------------------------------------------------------------

def _ct(shape=(64, 64, 32), seed=0):
    rng = np.random.default_rng(seed)
    volume = np.full(shape, -1000.0)
    x, y, z = np.meshgrid(*[np.linspace(-1, 1, n) for n in shape], indexing="ij")
    body = (x / 0.8) ** 2 + (y / 0.8) ** 2 < 1
    volume[body] = rng.normal(40, 20, body.sum())
    volume[body & (z > 0.5)] = -80  # some fat
    return volume.astype("int16")


def test_a_ct_is_ignored_without_any_record(mri, tmp_path):
    _admit(_save(tmp_path / "ct.nii.gz", _ct()))
    assert not mri.exists() or (_cases(mri) == [] and _rejections(mri) == [])
    assert not (mri / "registry.json").exists()  # not even an attempt was counted


def test_a_deep_negative_range_with_no_air_band_is_left_alone(mri, tmp_path):
    # Not an MRI (it goes to -500) and not recognisably a CT either: ignored, with no record.
    _admit(_save(tmp_path / "odd.nii.gz", (_head() - 500.0).astype("float32")))
    assert _cases(mri) == [] and _rejections(mri) == []


def test_a_zscored_mri_is_still_an_mri(mri, tmp_path):
    v = _head()
    _admit(_save(tmp_path / "z.nii.gz", ((v - v.mean()) / v.std()).astype("float32")))
    assert _cases(mri) == ["USER_MRI_00000001"]


@pytest.mark.parametrize("build,why", [
    (lambda: _head()[:, :, :1].repeat(4, axis=2)[:, :, :1], "one slice"),
    (lambda: np.zeros((64, 64, 32), dtype="float32"), "constant"),
    (lambda: np.full((64, 64, 32), np.nan, dtype="float32"), "all nan"),
])
def test_unusable_volumes_leave_no_trace_before_they_are_known_to_be_mri(mri, tmp_path, build, why):
    _admit(_save(tmp_path / "x.nii.gz", build()))
    assert _cases(mri) == []


def test_a_4d_series_is_not_collected(mri, tmp_path):
    data = np.stack([_head(seed=i) for i in range(3)], axis=-1)
    _admit(_save(tmp_path / "x.nii.gz", data))
    assert _cases(mri) == []


# ---- what is turned away, with a reason ---------------------------------------------------------------------

def test_a_mostly_empty_mri_is_rejected(mri, tmp_path):
    data = _head(shape=(64, 64, 32), noise=2.0)
    data[:] = np.random.default_rng(3).normal(8, 2, data.shape).clip(0)
    data[20:32, 20:32, 10:18] = 400.0  # a small bright object (0.9% of the volume), otherwise empty
    _admit(_save(tmp_path / "e.nii.gz", data.astype("float32")))
    assert _cases(mri) == []
    assert [r["reason"].split(":")[0] for r in _rejections(mri)] == ["mostly_empty"]


def test_pure_noise_is_rejected(mri, tmp_path):
    data = np.random.default_rng(4).normal(100, 40, (64, 64, 32)).clip(0).astype("float32")
    _admit(_save(tmp_path / "n.nii.gz", data))
    assert _cases(mri) == []
    assert [r["reason"].split(":")[0] for r in _rejections(mri)] == ["no_structure"]


def test_a_clearly_coarse_scan_is_turned_away_before_its_statistics_are_measured(mri, tmp_path, monkeypatch):
    path = _save(tmp_path / "c.nii.gz", _head(), zooms=(3.0, 3.0, 10.0))
    reads = []
    real = um._sample
    monkeypatch.setattr(um, "_sample", lambda p: reads.append(p) or real(p))
    _admit(path)
    assert len(reads) == 1  # only the one that tells MRI from CT; the statistics were never read
    assert _cases(mri) == []
    assert _rejections(mri)[0]["reason"].startswith(("slices_too_thick", "in_plane_too_coarse"))


def test_an_exact_repeat_is_a_duplicate(mri, tmp_path):
    path = _save(tmp_path / "a.nii.gz", _head())
    _admit(path)
    _admit(path, user="u2")
    assert _cases(mri) == ["USER_MRI_00000001"]
    assert _rejections(mri)[-1]["reason"] == "duplicate_exact"


def test_the_same_scan_saved_differently_is_a_near_duplicate(mri, tmp_path):
    data = _head()
    _admit(_save(tmp_path / "a.nii.gz", data))
    _admit(_save(tmp_path / "b.nii", data.astype("float64"), zooms=(1.0, 1.0, 2.0)))  # other dtype, no compression
    assert _cases(mri) == ["USER_MRI_00000001"]
    assert _rejections(mri)[-1]["reason"] == "duplicate_near"


def test_a_different_scan_is_not_a_near_duplicate(mri, tmp_path):
    _admit(_save(tmp_path / "a.nii.gz", _head(seed=1)))
    _admit(_save(tmp_path / "b.nii.gz", _head(shape=(64, 64, 32), seed=2, peak=520.0)))
    assert len(_cases(mri)) == 2


def test_daily_caps_apply_per_user(mri, tmp_path, monkeypatch):
    monkeypatch.setattr(ud, "DAILY_PER_USER", 2)
    for i in range(3):
        _admit(_save(tmp_path / f"{i}.nii.gz", _head(seed=i, peak=300.0 + 90 * i)), user="same")
    assert len(_cases(mri)) == 2
    assert _rejections(mri)[-1]["reason"] == "user_quota"
    _admit(_save(tmp_path / "other.nii.gz", _head(seed=9, peak=900.0)), user="someone-else")
    assert len(_cases(mri)) == 3


def test_collection_pauses_when_the_disk_is_nearly_full(mri, tmp_path, monkeypatch):
    monkeypatch.setattr(ud, "has_room_for", lambda root, path: False)
    _admit(_save(tmp_path / "a.nii.gz", _head()))
    assert _cases(mri) == []
    assert [r["reason"] for r in _rejections(mri)] == ["disk_floor"]


# ---- safety -----------------------------------------------------------------------------------------------

def test_a_failure_while_storing_leaves_no_half_written_case(mri, tmp_path, monkeypatch):
    def boom(src, dst):
        raise OSError("disk full")
    monkeypatch.setattr(ud, "_store_nifti_gz", boom)
    _admit(_save(tmp_path / "a.nii.gz", _head()))  # swallowed
    assert _cases(mri) == []
    assert not any(p.name.endswith(".partial") for p in (mri / "image_only").iterdir())
    registry = json.loads((mri / "registry.json").read_text())
    assert registry["next_id"] == 1 and registry["sha256"] == {}  # the id was not used up


def test_an_unreadable_file_is_ignored(mri, tmp_path):
    bad = tmp_path / "bad.nii.gz"
    bad.write_bytes(b"not a nifti" * 1000)
    _admit(bad)
    assert _cases(mri) == []


def test_the_voxel_cap_stops_a_gzip_bomb_before_anything_is_decoded(mri, tmp_path, monkeypatch):
    monkeypatch.setattr(um, "MAX_VOXELS", 1000)
    monkeypatch.setattr(um, "_sample", lambda p: pytest.fail("must not decode"))
    _admit(_save(tmp_path / "a.nii.gz", _head()))
    assert _cases(mri) == []


def test_it_is_off_unless_configured(tmp_path, monkeypatch):
    monkeypatch.delenv("USER_MRI_DATASET_PATH", raising=False)
    started = []
    monkeypatch.setattr(um.threading, "Thread", lambda *a, **k: started.append(1))
    um.collect_user_mri_async(_save(tmp_path / "a.nii.gz", _head()), "u", "ip", "s")
    assert started == []


def test_the_async_entry_runs_the_gate_on_a_daemon_thread(mri, tmp_path, monkeypatch):
    seen = {}

    class Inline:
        def __init__(self, target, args, name, daemon):
            seen.update(daemon=daemon, name=name)
            self.target, self.args = target, args

        def start(self):
            self.target(*self.args)

    monkeypatch.setattr(um.threading, "Thread", Inline)
    um.collect_user_mri_async(_save(tmp_path / "a.nii.gz", _head()), "u1", "1.1.1.1", "sess9")
    assert seen == {"daemon": True, "name": "user-mri-dataset-sess9"}
    assert _cases(mri) == ["USER_MRI_00000001"]


def test_the_ct_collection_still_turns_an_mri_away(tmp_path, monkeypatch):
    """The two collections are separate: the CT gate's own rule is unchanged."""
    path = _save(tmp_path / "a.nii.gz", _head())
    ok, reason = ud.validate_ct(path)
    assert not ok and reason.startswith("non_ct_intensity")


# ---- classify and the statistics, directly --------------------------------------------------------------------

def test_classify_cases():
    assert um.classify(_ct()) == "ct"
    assert um.classify(_head()) == "mri"
    outlier = _head()
    outlier[0, 0, 0] = -300.0  # a deep negative value, but no air band and almost nothing negative: not HU-like
    assert um.classify(outlier) == "unknown"
    assert um.classify(_head() - 500) == "ct"  # mostly negative: treated as a CT, so the MRI gate ignores it
    air_only = np.full((16, 16, 16), -1000.0, dtype="float32")
    air_only[:2] = 50
    assert um.classify(air_only) == "ct"


def test_a_clean_masked_background_has_no_noise_estimate_and_is_not_penalised(mri):
    data = _head(noise=0.0)
    data[data < 20] = 0.0  # skull-stripped: an exactly constant background
    stats = um.quality_stats(data)
    assert stats["snr"] is None
    assert um.quality_gate(stats) == (True, "ok")
    assert um.tier_blockers({"spacing_mm": [0.9, 0.9, 1.0]}, stats) == []


def test_a_noisy_scan_is_standard_and_a_very_noisy_one_is_refused():
    quiet = um.quality_stats(_head(noise=3.0))
    grainy = um.quality_stats(_head(noise=60.0))
    unusable = um.quality_stats(_head(noise=130.0))
    assert quiet["snr"] > um.HIGH_SNR and um.tier_blockers({"spacing_mm": [1, 1, 1]}, quiet) == []
    assert um.quality_gate(grainy) == (True, "ok")  # kept...
    assert any(b.startswith("snr") for b in um.tier_blockers({"spacing_mm": [1, 1, 1]}, grainy))  # ...as standard
    assert um.quality_gate(unusable)[1].startswith("too_noisy")


def test_saturated_scans_are_refused():
    data = np.full((64, 64, 32), 4095.0, dtype="float32")
    data[:8] = 100.0
    stats = um.quality_stats(data)
    assert um.quality_gate(stats)[0] is False
