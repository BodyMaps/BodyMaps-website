"""Who is editing a dataset scan's shared version right now: one row per scan, at most one editor at a time.

A dataset scan has one segmentation everybody sees (see ``save_segmentation_shared``). Two annotators editing it at
the same time cannot both save: the second is refused by the revision check and loses their work. The lock stops
that before it starts: whoever begins editing holds the scan, and everyone else sees it view only until they
finish. See services/edit_lock_store.py.

``case_key`` is the canonical scan id (``PanTS_00000035``), so "35" and "PanTS_00000035" share one lock. A lock is
renewed by the editor's open page and lapses at ``expires_at`` when that page goes quiet (laptop asleep, browser
closed). Deleting the holder's account removes their lock (CASCADE).
"""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from models.base import db
from models.job import utcnow


class ScanEditLock(db.Model):
    __tablename__ = "scan_edit_lock"

    case_key: Mapped[str] = mapped_column(String(32), primary_key=True)
    holder_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("user_account.id", ondelete="CASCADE"), nullable=False, index=True,
    )
    acquired_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)

    def __repr__(self) -> str:
        return f"<ScanEditLock {self.case_key} -> {self.holder_id} until {self.expires_at}>"
