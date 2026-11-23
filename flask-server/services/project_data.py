"""Scans a project owner uploads into their project: stored on the server, numbered from 1, opened in the viewer by the
project's own people and nobody else.

Unlike the scans people send for segmentation (``user_dataset``, which keeps one only when it passes a quality gate), a
scan an owner uploads into their own project is always kept: it is theirs, uploaded on purpose. It still has to be a
readable 3D volume of a sensible size, it must not already be in the project, and the disk must have room for it.

Layout, under ``PROJECT_DATASET_PATH`` (a writable folder; the feature is off while it is unset). It mirrors the other
datasets, so a script that reads ``image_only/<case>/ct.nii.gz`` reads these too (the file is named ``ct.nii.gz`` for an MRI
as well; the modality is in ``metadata.json`` and in the index):

    <root>/<project id>/image_only/PRJ_<code>_00000001/ct.nii.gz
    <root>/<project id>/image_only/PRJ_<code>_00000001/metadata.json

A project's scans are numbered 1, 2, 3... in the order they are stored; that number is what an assignment for the project
refers to. Its id in the viewer and the API is ``PRJ_<first 8 characters of the project id>_<number, 8 digits>``.

Nothing here makes a scan visible to anyone outside the project: ``can_open`` is the one question every request about a
``PRJ_`` id is put to (see api/access_policy.py), and it answers yes only for a member of the scan's project.

``allow_training`` on the project says whether its scans may be used to train models; ``training_manifest`` lists the scans
of the projects that allow it and nothing else.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import os
import re
import shutil
import threading
import uuid
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from models.engine import session_scope
from models.job import utcnow
from models.project import DEFAULT_PROJECT_ID, Project
from models.project_scan import ProjectScan
from services import project_store

ROOT_ENV = "PROJECT_DATASET_PATH"
MODALITIES = ("ct", "mri")
SCAN_FILE = "ct.nii.gz"
META_FILE = "metadata.json"

_CASE_ID = re.compile(r"^PRJ_([0-9a-f]{8})_(\d{8})$", re.IGNORECASE)
_ANY_PROJECT_ID = re.compile(r"^PRJ_", re.IGNORECASE)


def _int(name: str, default: str) -> int:
    return int(float(os.environ.get(name, default)))


MAX_BYTES = _int("PROJECT_DATASET_MAX_BYTES", str(2 * 1024 ** 3))
MAX_VOXELS = _int("PROJECT_DATASET_MAX_VOXELS", "1000000000")
MAX_SCANS = _int("PROJECT_DATASET_MAX_SCANS", "20000")
MIN_FREE_BYTES = _int("PROJECT_DATASET_MIN_FREE_GB", "50") * 1024 ** 3
MIN_BYTES = 1024

MESSAGES = {
    "not_configured": "Dataset uploads are not set up on this server yet.",
    "library_project": "The shared library is not changed from here.",
    "no_such_project": "That project was not found.",
    "bad_modality": "Say whether the scan is a CT or an MRI.",
    "no_such_upload": "That upload was not found. Upload the file again.",
    "too_large": "That file is larger than the limit for one scan.",
    "too_small": "That file is too small to be a scan.",
    "not_a_volume": "That file is not a 3D scan volume (.nii or .nii.gz).",
    "bad_geometry": "That scan's size or spacing is not usable.",
    "too_many_voxels": "That scan is larger than the limit for one scan.",
    "truncated": "That file is damaged or incomplete. Upload it again.",
    "duplicate": "This scan is already in the project.",
    "project_full": "This project has reached its limit on scans.",
    "no_room": "The server does not have room for this scan right now.",
    "no_such_scan": "That scan was not found.",
}


class ProjectDataError(ValueError):
    """A refused request. ``reason`` is a key of MESSAGES; ``details`` carries e.g. the number of the scan already stored."""

    def __init__(self, reason: str, details: dict | None = None):
        super().__init__(MESSAGES.get(reason, reason))
        self.reason = reason
        self.details = details or {}


# ---- where things are ------------------------------------------------------------------------------------------

def root() -> str | None:
    """The folder scans are stored under, or None while the feature is not set up."""
    path = (os.environ.get(ROOT_ENV) or "").strip()
    return path if path and os.path.isdir(path) else None


def code_for(project_id: str) -> str:
    return str(project_id)[:8].lower()


def case_id_for(project_id: str, number: int) -> str:
    return f"PRJ_{code_for(project_id)}_{int(number):08d}"


def looks_like_project_case(text) -> bool:
    """Anything that starts like a project case id, well formed or not: such a string is never looked up as another
    dataset's id, and a request carrying one is put to ``can_open``."""
    return isinstance(text, str) and bool(_ANY_PROJECT_ID.match(text.strip()))


def canonical(text) -> str | None:
    """``PRJ_<code>_<8 digits>`` in its stored spelling, or None for anything else."""
    m = _CASE_ID.match(text.strip()) if isinstance(text, str) else None
    return None if m is None else f"PRJ_{m.group(1).lower()}_{m.group(2)}"


def _row(case_id: str) -> dict | None:
    cid = canonical(case_id)
    if cid is None:
        return None
    with session_scope() as s:
        r = s.execute(select(ProjectScan).where(ProjectScan.case_id == cid)).scalar_one_or_none()
        return None if r is None else _as_dict(r)


def _as_dict(r: ProjectScan) -> dict:
    return {
        "id": r.id, "project_id": r.project_id, "number": r.number, "case_id": r.case_id,
        "original_name": r.original_name, "modality": r.modality, "size_bytes": int(r.size_bytes),
        "shape": json.loads(r.shape), "spacing": json.loads(r.spacing),
        "uploaded_at": r.uploaded_at.isoformat() + "Z" if r.uploaded_at else None,
    }


def project_of_case(case_id) -> str | None:
    row = _row(case_id)
    return None if row is None else row["project_id"]


def can_open(user_id: str | None, case_id) -> bool:
    """Whether this account may open this project scan: yes only for a member (owner or collaborator) of its project."""
    row = _row(case_id)
    return row is not None and project_store.member_role(user_id, row["project_id"]) is not None


def ct_path(case_id) -> str | None:
    """The stored file of a scan, or None when there is no such scan or it is not on disk."""
    base, row = root(), _row(case_id)
    if base is None or row is None:
        return None
    path = os.path.join(base, row["project_id"], "image_only", row["case_id"], SCAN_FILE)
    return path if os.path.isfile(path) else None


def _scan_dir(base: str, project_id: str, case_id: str) -> str:
    return os.path.join(base, project_id, "image_only", case_id)


# ---- reading ---------------------------------------------------------------------------------------------------

def list_scans(project_id: str) -> list[dict]:
    with session_scope() as s:
        rows = s.execute(
            select(ProjectScan).where(ProjectScan.project_id == project_id).order_by(ProjectScan.number)
        ).scalars().all()
        return [_as_dict(r) for r in rows]


def count_scans(project_id: str) -> int:
    with session_scope() as s:
        return s.execute(select(func.count(ProjectScan.id)).where(ProjectScan.project_id == project_id)).scalar_one()


def training_manifest() -> list[dict]:
    """The scans of every project that allows training, and of no other: project, case id, modality and file."""
    base = root()
    out = []
    with session_scope() as s:
        projects = s.execute(select(Project).where(Project.allow_training.is_(True), Project.is_default.is_(False))).scalars().all()
        for p in projects:
            for r in s.execute(select(ProjectScan).where(ProjectScan.project_id == p.id).order_by(ProjectScan.number)).scalars():
                out.append({
                    "project_id": p.id, "project": p.name, "case_id": r.case_id, "modality": r.modality,
                    "file": None if base is None else os.path.join(_scan_dir(base, p.id, r.case_id), SCAN_FILE),
                })
    return out


# ---- checking a file --------------------------------------------------------------------------------------------

def _inspect(path: str) -> tuple[list[int], list[float]]:
    """(shape, spacing) of a NIfTI volume, from its header alone, or a ProjectDataError."""
    try:
        import nibabel as nib
        import numpy as np
        img = nib.load(path)
        shape = [int(d) for d in img.shape]
        zooms = [float(z) for z in img.header.get_zooms()[:len(shape)]]
        affine = np.asarray(img.affine, dtype=float)
    except Exception:
        raise ProjectDataError("not_a_volume")
    dims = [(d, z) for d, z in zip(shape, zooms) if d > 1]
    if len(dims) != 3:
        raise ProjectDataError("not_a_volume")
    if any(d < 8 or d > 4096 for d, _ in dims) or any(not (z == z) or z <= 0 or z > 100 for _, z in dims):
        raise ProjectDataError("bad_geometry")
    if not np.isfinite(affine).all():
        raise ProjectDataError("bad_geometry")
    voxels = 1
    for d, _ in dims:
        voxels *= d
    if voxels > MAX_VOXELS:
        raise ProjectDataError("too_many_voxels")
    return [d for d, _ in dims], [z for _, z in dims]


def _decoded_size_ok(path: str, shape: list[int]) -> bool:
    """Read a gzip file to its end, which checks its integrity, and see that it holds at least the voxels the header says."""
    try:
        import nibabel as nib
        header = nib.load(path).header
        need = int(header.get_data_offset()) + int(header.get_data_dtype().itemsize) * int(shape[0]) * int(shape[1]) * int(shape[2])
        seen = 0
        opener = gzip.open if _is_gzip(path) else open
        with opener(path, "rb") as f:
            while True:
                block = f.read(8 * 1024 * 1024)
                if not block:
                    break
                seen += len(block)
        return seen >= need
    except Exception:
        return False


def _is_gzip(path: str) -> bool:
    with open(path, "rb") as f:
        return f.read(2) == b"\x1f\x8b"


def _sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(8 * 1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def _gzip_copy(src: str, dst: str) -> None:
    """Write ``src`` to ``dst`` as a .nii.gz: copied as it is when already gzip, compressed when not."""
    if _is_gzip(src):
        shutil.copyfile(src, dst)
        return
    with open(src, "rb") as fin, gzip.open(dst, "wb", compresslevel=3) as fout:
        shutil.copyfileobj(fin, fout, 8 * 1024 * 1024)


# ---- storing ---------------------------------------------------------------------------------------------------

_LOCKS: dict[str, threading.Lock] = {}
_LOCKS_GUARD = threading.Lock()


def _lock_for(project_id: str) -> threading.Lock:
    with _LOCKS_GUARD:
        return _LOCKS.setdefault(project_id, threading.Lock())


def store_scan(project_id: str, source_path: str, original_name: str, modality, uploaded_by: str) -> dict:
    """Check a finished upload and keep it as the project's next scan. The source file is left as it is (the caller removes it).

    Raises ProjectDataError with the reason when it is refused. Storing the same file twice is refused with ``duplicate`` and
    the number of the scan already stored, so a retried request never makes a second copy.
    """
    base = root()
    if base is None:
        raise ProjectDataError("not_configured")
    if project_id == DEFAULT_PROJECT_ID:
        raise ProjectDataError("library_project")
    if not project_store.exists(project_id):
        raise ProjectDataError("no_such_project")
    if modality not in MODALITIES:
        raise ProjectDataError("bad_modality")
    if not isinstance(source_path, str) or not os.path.isfile(source_path):
        raise ProjectDataError("no_such_upload")
    size = os.path.getsize(source_path)
    if size > MAX_BYTES:
        raise ProjectDataError("too_large")
    if size < MIN_BYTES:
        raise ProjectDataError("too_small")
    if count_scans(project_id) >= MAX_SCANS:
        raise ProjectDataError("project_full")

    shape, spacing = _inspect(source_path)
    if not _decoded_size_ok(source_path, shape):
        raise ProjectDataError("truncated")
    digest = _sha256(source_path)
    with session_scope() as s:
        have = s.execute(
            select(ProjectScan.number).where(ProjectScan.project_id == project_id, ProjectScan.sha256 == digest)
        ).scalar_one_or_none()
    if have is not None:
        raise ProjectDataError("duplicate", {"number": have})
    try:
        free = shutil.disk_usage(base).free
    except OSError:
        free = 0
    if free - size < MIN_FREE_BYTES:
        raise ProjectDataError("no_room")

    # Copy outside the lock (it can take a while) to a name nobody opens, then take the number and rename into place inside it.
    incoming_dir = os.path.join(base, project_id, ".incoming")
    os.makedirs(incoming_dir, exist_ok=True)
    incoming = os.path.join(incoming_dir, f"{uuid.uuid4().hex}.nii.gz")
    try:
        _gzip_copy(source_path, incoming)
        stored_size = os.path.getsize(incoming)
        with _lock_for(project_id):
            return _publish(base, project_id, incoming, stored_size, original_name, modality, digest, shape, spacing, uploaded_by)
    finally:
        try:
            os.remove(incoming)
        except OSError:
            pass


def _publish(base, project_id, incoming, size, original_name, modality, digest, shape, spacing, uploaded_by) -> dict:
    name = (os.path.basename(str(original_name or "")).strip() or "scan.nii.gz")[:255]
    for _attempt in range(5):
        with session_scope() as s:
            number = (s.execute(select(func.max(ProjectScan.number)).where(ProjectScan.project_id == project_id)).scalar_one() or 0) + 1
            case_id = case_id_for(project_id, number)
            row = ProjectScan(
                id=str(uuid.uuid4()), project_id=project_id, number=number, case_id=case_id, original_name=name,
                modality=modality, size_bytes=size, sha256=digest, shape=json.dumps(shape), spacing=json.dumps(spacing),
                uploaded_by=uploaded_by, uploaded_at=utcnow(),
            )
            s.add(row)
            try:
                s.flush()
            except IntegrityError:
                s.rollback()
                # Either the same file was stored a moment ago by another request, or two requests took the same number.
                same = s.execute(
                    select(ProjectScan.number).where(ProjectScan.project_id == project_id, ProjectScan.sha256 == digest)
                ).scalar_one_or_none()
                if same is not None:
                    raise ProjectDataError("duplicate", {"number": same})
                continue
            target = _scan_dir(base, project_id, case_id)
            try:
                os.makedirs(target)
                os.replace(incoming, os.path.join(target, SCAN_FILE))
                with open(os.path.join(target, META_FILE), "w", encoding="utf-8") as handle:
                    json.dump({
                        "case_id": case_id, "number": number, "project_id": project_id, "modality": modality,
                        "original_name": name, "size_bytes": size, "sha256": digest, "shape": shape, "spacing_mm": spacing,
                        "uploaded_by": uploaded_by, "uploaded_at": datetime.now(timezone.utc).isoformat(),
                    }, handle)
            except Exception:
                shutil.rmtree(target, ignore_errors=True)
                raise
            return _as_dict(row)
    raise ProjectDataError("no_room")


def delete_scan(project_id: str, number: int) -> None:
    """Remove one scan from a project, its file included. Scans after it keep their numbers."""
    base = root()
    with session_scope() as s:
        row = s.execute(
            select(ProjectScan).where(ProjectScan.project_id == project_id, ProjectScan.number == number)
        ).scalar_one_or_none() if isinstance(number, int) and not isinstance(number, bool) else None
        if row is None:
            raise ProjectDataError("no_such_scan")
        case_id = row.case_id
        s.delete(row)
    if base is not None:
        shutil.rmtree(_scan_dir(base, project_id, case_id), ignore_errors=True)
