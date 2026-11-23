"""A scan a project owner has uploaded into their project.

One row per stored scan. ``number`` counts the project's own scans from 1 (the number assignments for the project use);
``case_id`` is the id the viewer and the API use for it (``PRJ_<first 8 characters of the project id>_<number, 8 digits>``).
The scan itself lives on disk under the project dataset folder (see ``services.project_data``); this row is the index of it
and the record of who uploaded it.
"""

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from models.base import db
from models.job import utcnow


class ProjectScan(db.Model):
    __tablename__ = "project_scan"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    # CASCADE: deleting a project removes its index rows (its files are removed by the code that deletes the project).
    project_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("project.id", ondelete="CASCADE"), nullable=False, index=True,
    )
    number: Mapped[int] = mapped_column(Integer, nullable=False)
    case_id: Mapped[str] = mapped_column(String(32), nullable=False, unique=True)
    original_name: Mapped[str] = mapped_column(String(255), nullable=False)
    # "ct" or "mri", as declared by the owner who uploaded it.
    modality: Mapped[str] = mapped_column(String(8), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    # JSON text: [x, y, z] voxels and [x, y, z] millimetres.
    shape: Mapped[str] = mapped_column(Text, nullable=False)
    spacing: Mapped[str] = mapped_column(Text, nullable=False)
    uploaded_by: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("user_account.id", ondelete="SET NULL"), nullable=True,
    )
    uploaded_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)

    __table_args__ = (
        UniqueConstraint("project_id", "number", name="uq_project_scan_project_id_number"),
        UniqueConstraint("project_id", "sha256", name="uq_project_scan_project_id_sha256"),
    )

    def __repr__(self) -> str:
        return f"<ProjectScan {self.case_id}>"
