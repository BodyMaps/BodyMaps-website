"""Projects: a group of people who work on a set of cases together.

The original library (PanTS, CancerVerse, AbdomenAtlas) belongs to the built-in project ``jhu``. Its people are
not stored here: its owners and collaborators are the accounts that hold the ``annotation_manager`` and
``annotator`` roles (see ``services.role_store``), exactly as before, so nothing about the existing team changes.

Every other project is created by an admin, who names its project owners. An owner adds collaborators of their own
and, in a later step, uploads a dataset for the project. A person's role is per project: being an owner of one
project says nothing about any other, and neither role carries any right over the shared library.

``allow_training`` says whether the project's uploaded scans may be used to train models. It is off unless an admin
turns it on, and it is a property of the project, not of a person.
"""

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from models.base import db
from models.job import utcnow

DEFAULT_PROJECT_ID = "jhu"
DEFAULT_PROJECT_NAME = "JHU"

ROLE_OWNER = "owner"
ROLE_COLLABORATOR = "collaborator"


class Project(db.Model):
    __tablename__ = "project"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    # Lower-case words joined by hyphens; unique, so a project can be named in a link.
    slug: Mapped[str] = mapped_column(String(80), nullable=False, unique=True)
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    allow_training: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_by: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("user_account.id", ondelete="SET NULL"), nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)

    def __repr__(self) -> str:
        return f"<Project {self.slug}>"


class ProjectMember(db.Model):
    __tablename__ = "project_member"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    project_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("project.id", ondelete="CASCADE"), nullable=False, index=True,
    )
    # CASCADE: a purged account leaves no membership behind.
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("user_account.id", ondelete="CASCADE"), nullable=False, index=True,
    )
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    added_by: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("user_account.id", ondelete="SET NULL"), nullable=True,
    )
    added_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)

    __table_args__ = (
        # One role per person per project.
        UniqueConstraint("project_id", "user_id", name="uq_project_member_project_id_user_id"),
    )

    def __repr__(self) -> str:
        return f"<ProjectMember {self.role} user={self.user_id} project={self.project_id}>"
