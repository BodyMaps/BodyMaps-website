"""One annotator edits a dataset scan's shared version at a time.

The shared save already refuses a save made over a newer version (the If-Match revision check), so nobody's work is
silently overwritten. What it cannot prevent is two people editing the same scan at once: the second to save is
refused and loses everything they did. This lock prevents that up front.

- ``acquire``: the first annotator to start editing holds the scan. Calling it again renews the hold; the editor's
  open page does this every minute, so a break with the scan open never loses it.
- A hold lapses ``ttl_seconds()`` after its last renewal (30 minutes unless ``BODYMAPS_EDIT_LOCK_TTL_SECONDS`` says
  otherwise), so a laptop that went to sleep or a browser that closed without saying so cannot keep a scan forever.
- ``release``: the holder lets go (closing the scan, leaving the page).
- ``take_over``: an annotation manager moves the hold to themselves, e.g. when someone forgot to close a scan.
- ``blocking_holder``: who, other than the caller, holds the scan right now; the shared save and revert refuse
  while someone else does.

Every function takes the canonical case key (``PanTS_00000035``) from ``_shared_case_key``.
"""

import os
from datetime import timedelta

from sqlalchemy import case, or_, select, update
from sqlalchemy.exc import IntegrityError

from models.engine import session_scope
from models.job import utcnow
from models.scan_edit_lock import ScanEditLock
from models.user import User

DEFAULT_TTL_SECONDS = 30 * 60
MIN_TTL_SECONDS = 60
MAX_TTL_SECONDS = 24 * 60 * 60


def ttl_seconds() -> int:
    """How long a hold survives without a renewal. Read on every call so a deploy can change it."""
    try:
        value = int(os.environ.get("BODYMAPS_EDIT_LOCK_TTL_SECONDS", DEFAULT_TTL_SECONDS))
    except ValueError:
        return DEFAULT_TTL_SECONDS
    return min(max(value, MIN_TTL_SECONDS), MAX_TTL_SECONDS)


def _display_name(session, user_id: str) -> str:
    user = session.get(User, user_id)
    if user is None:
        return "Another annotator"
    return user.name or user.email


def _describe(session, row: ScanEditLock | None, user_id: str | None, now) -> dict:
    """The lock as the page sees it. A lapsed row counts as no lock."""
    if row is None or row.expires_at <= now:
        return {"held": False, "mine": False, "holder": None, "expires_at": None}
    return {
        "held": True,
        "mine": bool(user_id) and row.holder_id == user_id,
        "holder": _display_name(session, row.holder_id),
        "expires_at": row.expires_at.isoformat() + "Z",
    }


def status(case_key: str, user_id: str | None) -> dict:
    now = utcnow()
    with session_scope() as s:
        return _describe(s, s.get(ScanEditLock, case_key), user_id, now)


def _claim_existing(case_key: str, user_id: str, now, expires) -> bool:
    """Renew the caller's own hold or take a lapsed one, in one conditional UPDATE so two callers cannot both win."""
    with session_scope() as s:
        result = s.execute(
            update(ScanEditLock)
            .where(ScanEditLock.case_key == case_key)
            .where(or_(ScanEditLock.holder_id == user_id, ScanEditLock.expires_at <= now))
            .values(
                holder_id=user_id,
                expires_at=expires,
                acquired_at=case((ScanEditLock.holder_id == user_id, ScanEditLock.acquired_at), else_=now),
            )
            .execution_options(synchronize_session=False)
        )
        return result.rowcount == 1


def acquire(case_key: str, user_id: str) -> dict:
    """Hold (or keep holding) the scan. Returns the lock; ``mine`` is False when someone else holds it."""
    now = utcnow()
    expires = now + timedelta(seconds=ttl_seconds())
    if not _claim_existing(case_key, user_id, now, expires):
        try:
            with session_scope() as s:
                s.add(ScanEditLock(case_key=case_key, holder_id=user_id, acquired_at=now, expires_at=expires))
        except IntegrityError:
            # Someone created the row between our UPDATE and INSERT. It may have lapsed or be ours after all.
            _claim_existing(case_key, user_id, now, expires)
    return status(case_key, user_id)


def release(case_key: str, user_id: str) -> bool:
    """Let go of the caller's own hold. Never removes someone else's."""
    with session_scope() as s:
        row = s.get(ScanEditLock, case_key)
        if row is None or row.holder_id != user_id:
            return False
        s.delete(row)
        return True


def take_over(case_key: str, user_id: str) -> dict:
    """Move the hold to the caller whoever had it (annotation managers only; the route checks the role)."""
    now = utcnow()
    expires = now + timedelta(seconds=ttl_seconds())
    if not _move_to(case_key, user_id, now, expires):
        try:
            with session_scope() as s:
                s.add(ScanEditLock(case_key=case_key, holder_id=user_id, acquired_at=now, expires_at=expires))
        except IntegrityError:
            # Another take over (or an editor) created the row between our UPDATE and INSERT: take it from them.
            _move_to(case_key, user_id, now, expires)
    return status(case_key, user_id)


def _move_to(case_key: str, user_id: str, now, expires) -> bool:
    """Give an existing row to the caller whoever holds it, in one UPDATE. False when the scan has no row yet."""
    with session_scope() as s:
        result = s.execute(
            update(ScanEditLock)
            .where(ScanEditLock.case_key == case_key)
            .values(holder_id=user_id, acquired_at=now, expires_at=expires)
            .execution_options(synchronize_session=False)
        )
        return result.rowcount == 1


def blocking_holder(case_key: str, user_id: str | None) -> str | None:
    """The name of whoever else holds the scan right now, or None when the caller may save."""
    now = utcnow()
    with session_scope() as s:
        row = s.execute(select(ScanEditLock).where(ScanEditLock.case_key == case_key)).scalar_one_or_none()
        if row is None or row.expires_at <= now or row.holder_id == user_id:
            return None
        return _display_name(s, row.holder_id)
