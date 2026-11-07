"""Temporary, single-use invitation codes that grant the ``annotator`` role.

An admin creates one, hands the code to a person, and the person redeems it from their account. Only a
SHA-256 digest of the code is stored, so a database dump does not contain redeemable codes; the code itself
is shown to the admin once, when it is created.

``created_by`` and ``redeemed_by`` are SET NULL: deleting an account must not erase the record of who was
let in, or who let them in.
"""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from models.base import db
from models.job import utcnow


class AnnotatorInvite(db.Model):
    __tablename__ = "annotator_invite"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    code_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    created_by: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("user_account.id", ondelete="SET NULL"), nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    redeemed_by: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("user_account.id", ondelete="SET NULL"), nullable=True,
    )
    redeemed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    def __repr__(self) -> str:
        return f"<AnnotatorInvite {self.id} expires={self.expires_at}>"
