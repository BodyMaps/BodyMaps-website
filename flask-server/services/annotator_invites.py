"""Temporary, single-use codes that make an account an annotator.

Two people (the admins) decide who may change what every viewer sees. They can grant the ``annotator`` role
straight from the Accounts tab, or create a code here and hand it over; the person redeems it from their
own account. A code works once and expires, so a code that is forwarded or left in a chat is worth nothing
afterwards. Redeeming only ever grants ``annotator``: never ``admin``, and never the power to create codes.
"""

import hashlib
import secrets
import uuid
from datetime import datetime, timedelta

from sqlalchemy import select, update

from models.annotator_invite import AnnotatorInvite
from models.engine import session_scope
from models.job import utcnow
from models.user import User
from models.user_role import UserRole
from services import role_store

# No 0/O, 1/I/L: the code is read aloud and typed by hand.
_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
_CODE_LENGTH = 12
MAX_HOURS = 24 * 14

GRANTED = "granted"
ALREADY = "already"


def normalize(code: str) -> str:
    """Case, spaces and dashes do not matter when typing a code."""
    return "".join(ch for ch in str(code).upper() if ch.isalnum())


def digest(code: str) -> str:
    return hashlib.sha256(normalize(code).encode("utf-8")).hexdigest()


def _display(raw: str) -> str:
    return "-".join(raw[i:i + 4] for i in range(0, len(raw), 4))


def create(created_by: str, hours) -> dict:
    """A new code that works for ``hours``. The code is returned here and never stored in the clear."""
    if not isinstance(hours, int) or isinstance(hours, bool) or not 1 <= hours <= MAX_HOURS:
        raise ValueError(f"hours must be a whole number from 1 to {MAX_HOURS}")
    raw = "".join(secrets.choice(_ALPHABET) for _ in range(_CODE_LENGTH))
    expires_at = utcnow() + timedelta(hours=hours)
    invite_id = str(uuid.uuid4())
    with session_scope() as s:
        s.add(AnnotatorInvite(id=invite_id, code_hash=digest(raw), created_by=created_by, expires_at=expires_at))
    return {"id": invite_id, "code": _display(raw), "expires_at": expires_at}


def redeem(user_id: str, code: str) -> str | None:
    """Grant ``annotator`` to ``user_id`` for a valid code: ``GRANTED``, ``ALREADY`` (they already may; the
    code is kept for someone else), or None when the code is unknown, used or expired."""
    now = utcnow()
    code_hash = digest(code)
    with session_scope() as s:
        user = s.get(User, user_id)
        if user is None or user.is_system:
            raise LookupError(user_id)
        invite = s.execute(
            select(AnnotatorInvite).where(
                AnnotatorInvite.code_hash == code_hash,
                AnnotatorInvite.redeemed_at.is_(None),
                AnnotatorInvite.expires_at > now,
            )
        ).scalar_one_or_none()
        if invite is None:
            return None
        held = set(s.execute(select(UserRole.role).where(UserRole.user_id == user_id)).scalars())
        if held & {role_store.ROLE_ANNOTATOR, role_store.ROLE_ADMIN}:
            return ALREADY
        # The WHERE clause is what makes it single-use when two people redeem at the same moment.
        claimed = s.execute(
            update(AnnotatorInvite)
            .where(AnnotatorInvite.id == invite.id, AnnotatorInvite.redeemed_at.is_(None))
            .values(redeemed_by=user_id, redeemed_at=now)
        )
        if claimed.rowcount != 1:
            return None
        s.add(UserRole(
            id=str(uuid.uuid4()), user_id=user_id, role=role_store.ROLE_ANNOTATOR,
            granted_by=invite.created_by, granted_at=now,
        ))
    return GRANTED


def _as_utc_text(value: datetime | None) -> str | None:
    return value.isoformat() + "Z" if value is not None else None


def recent(limit: int = 50) -> list[dict]:
    """Newest first: what an admin needs to see which codes are still open and who used the others."""
    now = utcnow()
    with session_scope() as s:
        rows = s.execute(
            select(AnnotatorInvite).order_by(AnnotatorInvite.created_at.desc()).limit(limit)
        ).scalars().all()
        redeemer_ids = {row.redeemed_by for row in rows if row.redeemed_by}
        emails = {
            user.id: user.email
            for user in s.execute(select(User).where(User.id.in_(redeemer_ids))).scalars()
        } if redeemer_ids else {}
        return [{
            "id": row.id,
            "status": "redeemed" if row.redeemed_at else ("expired" if row.expires_at <= now else "open"),
            "created_at": _as_utc_text(row.created_at),
            "expires_at": _as_utc_text(row.expires_at),
            "redeemed_at": _as_utc_text(row.redeemed_at),
            "redeemed_by": emails.get(row.redeemed_by) if row.redeemed_by else None,
        } for row in rows]


def revoke(invite_id: str) -> bool:
    """Withdraw a code that has not been used. False when there is no such open code."""
    with session_scope() as s:
        result = s.execute(
            update(AnnotatorInvite)
            .where(AnnotatorInvite.id == invite_id, AnnotatorInvite.redeemed_at.is_(None))
            .values(expires_at=utcnow())
        )
        return result.rowcount == 1
