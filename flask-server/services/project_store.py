"""Projects and who holds which role in them.

A role is per project: ``owner`` (may hand out cases, add and remove collaborators, and upload a dataset for
the project) and ``collaborator`` (may be handed cases and annotate them). Only an admin creates a project and names
its owners; an owner adds collaborators of their own.

The built-in ``jhu`` project is the existing library. Its people are not rows here: its owners are the accounts holding
the ``annotation_manager`` role and its collaborators those holding ``annotator``, so the existing team, the Accounts
page, invitation codes and every role check keep working untouched. Those two roles are also the only thing that lets an
account save a corrected scan for everyone in the shared library, and nothing here gives that right to a member of any
other project.
"""

import re
import uuid

from sqlalchemy import func, select

from models.engine import session_scope
from models.job import utcnow
from models.project import (
    DEFAULT_PROJECT_ID, DEFAULT_PROJECT_NAME, ROLE_COLLABORATOR, ROLE_OWNER, Project, ProjectMember,
)
from models.user import User
from services import role_store

MAX_NAME = 80
MAX_PROJECTS = 500   # a guard against a runaway client; nobody makes this many by hand

# Fixed wording for every refusal; the API sends these and nothing taken from an exception.
MESSAGES = {
    "bad_name": "Give the project a name of 1 to 80 characters.",
    "name_taken": "A project with that name already exists.",
    "too_many": "There are already too many projects.",
    "no_such_project": "That project was not found.",
    "no_such_person": "That account was not found.",
    "bad_role": "The role must be owner or collaborator.",
    "not_allowed": "You are not allowed to do that in this project.",
    "owner_by_admin": "Only an admin can make someone a project owner.",
    "default_owner": "JHU project owners are set on the server, not here.",
    "need_exact_email": "Type the person's full email address.",
    "not_a_member": "That person is not in this project.",
}


class ProjectError(ValueError):
    """A refused request. ``reason`` is a key of MESSAGES."""

    def __init__(self, reason: str):
        super().__init__(MESSAGES.get(reason, reason))
        self.reason = reason


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:80] or "project"


def ensure_default_project() -> None:
    """Make sure the built-in project's row exists (a fresh or test database has none; the migration adds it on the server)."""
    with session_scope() as s:
        if s.get(Project, DEFAULT_PROJECT_ID) is None:
            s.add(Project(
                id=DEFAULT_PROJECT_ID, name=DEFAULT_PROJECT_NAME, slug=DEFAULT_PROJECT_ID, is_default=True,
                allow_training=False, created_by=None, created_at=utcnow(),
            ))


def _as_dict(p: Project, role: str | None) -> dict:
    return {
        "id": p.id, "name": p.name, "slug": p.slug, "is_default": bool(p.is_default),
        "allow_training": bool(p.allow_training), "role": role,
    }


def _default_role(held) -> str | None:
    if role_store.ROLE_ANNOTATION_MANAGER in held:
        return ROLE_OWNER
    if role_store.ROLE_ANNOTATOR in held:
        return ROLE_COLLABORATOR
    return None


def member_role(user_id: str | None, project_id: str) -> str | None:
    """``owner``, ``collaborator`` or None: the account's role in one project."""
    if not user_id or not isinstance(project_id, str):
        return None
    if project_id == DEFAULT_PROJECT_ID:
        return _default_role(role_store.roles_for(user_id))
    with session_scope() as s:
        return s.execute(
            select(ProjectMember.role).where(ProjectMember.project_id == project_id, ProjectMember.user_id == user_id)
        ).scalar_one_or_none()


def is_owner(user_id: str | None, project_id: str) -> bool:
    return member_role(user_id, project_id) == ROLE_OWNER


def exists(project_id) -> bool:
    if not isinstance(project_id, str):
        return False
    ensure_default_project()
    with session_scope() as s:
        return s.get(Project, project_id) is not None


def get(project_id: str) -> dict:
    ensure_default_project()
    if not isinstance(project_id, str):
        raise ProjectError("no_such_project")
    with session_scope() as s:
        p = s.get(Project, project_id)
        if p is None:
            raise ProjectError("no_such_project")
        return _as_dict(p, None)


def list_for(user_id: str, *, is_admin: bool = False) -> list[dict]:
    """The projects an account belongs to (an admin sees every project), each with the account's own role in it."""
    ensure_default_project()
    held = role_store.roles_for(user_id)
    with session_scope() as s:
        mine = dict(s.execute(
            select(ProjectMember.project_id, ProjectMember.role).where(ProjectMember.user_id == user_id)
        ).all())
        rows = s.execute(select(Project).order_by(Project.is_default.desc(), func.lower(Project.name))).scalars().all()
        out = []
        for p in rows:
            role = _default_role(held) if p.is_default else mine.get(p.id)
            if role is not None or is_admin:
                out.append(_as_dict(p, role))
        return out


def create(name, created_by: str) -> dict:
    if not isinstance(name, str) or not 1 <= len(name.strip()) <= MAX_NAME:
        raise ProjectError("bad_name")
    name = " ".join(name.split())
    ensure_default_project()
    with session_scope() as s:
        if s.execute(select(func.count(Project.id))).scalar_one() >= MAX_PROJECTS:
            raise ProjectError("too_many")
        slug = _slug(name)
        if s.execute(select(Project.id).where(func.lower(Project.name) == name.lower())).first() or \
                s.execute(select(Project.id).where(Project.slug == slug)).first():
            raise ProjectError("name_taken")
        p = Project(id=str(uuid.uuid4()), name=name, slug=slug, is_default=False, allow_training=False,
                    created_by=created_by, created_at=utcnow())
        s.add(p)
        s.flush()
        return _as_dict(p, None)


def set_allow_training(project_id: str, allowed: bool) -> dict:
    ensure_default_project()
    with session_scope() as s:
        p = s.get(Project, project_id) if isinstance(project_id, str) else None
        if p is None:
            raise ProjectError("no_such_project")
        p.allow_training = bool(allowed)
        s.flush()
        return _as_dict(p, None)


def _person(u: User, role: str) -> dict:
    return {"id": u.id, "name": u.name, "email": u.email, "role": role}


def members(project_id: str) -> list[dict]:
    """Everyone in a project with their role, owners first."""
    if not exists(project_id):
        raise ProjectError("no_such_project")
    with session_scope() as s:
        if project_id == DEFAULT_PROJECT_ID:
            from models.user_role import UserRole
            rows = s.execute(
                select(User, UserRole.role).join(UserRole, UserRole.user_id == User.id)
                .where(UserRole.role.in_(sorted(role_store.ANNOTATING_ROLES)), User.deletion_requested_at.is_(None))
            ).all()
            best: dict[str, tuple[User, str]] = {}
            for u, r in rows:
                role = ROLE_OWNER if r == role_store.ROLE_ANNOTATION_MANAGER else ROLE_COLLABORATOR
                if u.id not in best or role == ROLE_OWNER:
                    best[u.id] = (u, role)
            people = [_person(u, r) for u, r in best.values()]
        else:
            rows = s.execute(
                select(User, ProjectMember.role).join(ProjectMember, ProjectMember.user_id == User.id)
                .where(ProjectMember.project_id == project_id, User.deletion_requested_at.is_(None))
            ).all()
            people = [_person(u, r) for u, r in rows]
    people.sort(key=lambda p: (p["role"] != ROLE_OWNER, (p["name"] or p["email"] or "").lower()))
    return people


def find_by_email(project_id: str, email) -> dict | None:
    """One account by its exact address, for adding it to a project. Nothing else about other accounts is listed here:
    an owner can add a person they already know the address of, not browse everyone who has signed up."""
    if not isinstance(email, str) or "@" not in email or len(email.strip()) < 5:
        raise ProjectError("need_exact_email")
    with session_scope() as s:
        u = s.execute(
            select(User).where(func.lower(User.email) == email.strip().lower(), User.is_system.is_(False),
                               User.deletion_requested_at.is_(None))
        ).scalar_one_or_none()
        return None if u is None else {"id": u.id, "name": u.name, "email": u.email}


def _live_user(s, user_id) -> User:
    u = s.get(User, user_id) if isinstance(user_id, str) else None
    if u is None or u.is_system or u.deletion_requested_at is not None:
        raise ProjectError("no_such_person")
    return u


def add_member(project_id: str, user_id, role, *, acting_user_id: str, acting_is_admin: bool) -> dict:
    """Give an account a role in a project. An owner may add collaborators; making someone an owner is an admin's job."""
    if role not in (ROLE_OWNER, ROLE_COLLABORATOR):
        raise ProjectError("bad_role")
    if not exists(project_id):
        raise ProjectError("no_such_project")
    acting_owner = is_owner(acting_user_id, project_id)
    if role == ROLE_OWNER and not acting_is_admin:
        raise ProjectError("owner_by_admin")
    if not (acting_owner or acting_is_admin):
        raise ProjectError("not_allowed")
    if project_id == DEFAULT_PROJECT_ID:
        if role == ROLE_OWNER:
            raise ProjectError("default_owner")
        if not acting_owner:
            # The shared library's collaborators are handed out only by its own owners (annotation managers).
            raise ProjectError("not_allowed")
        with session_scope() as s:
            u = _live_user(s, user_id)
        role_store.grant(u.id, role_store.ROLE_ANNOTATOR, granted_by=acting_user_id)
        return _person(u, member_role(u.id, project_id) or ROLE_COLLABORATOR)
    with session_scope() as s:
        u = _live_user(s, user_id)
        row = s.execute(
            select(ProjectMember).where(ProjectMember.project_id == project_id, ProjectMember.user_id == u.id)
        ).scalar_one_or_none()
        if row is None:
            s.add(ProjectMember(id=str(uuid.uuid4()), project_id=project_id, user_id=u.id, role=role,
                                added_by=acting_user_id, added_at=utcnow()))
        elif row.role != role:
            # Promoting is covered above (admin only). Demoting an owner is also an admin's call.
            if row.role == ROLE_OWNER and not acting_is_admin:
                raise ProjectError("owner_by_admin")
            row.role = role
        return _person(u, role)


def remove_member(project_id: str, user_id, *, acting_user_id: str, acting_is_admin: bool) -> None:
    """Take an account out of a project. Their finished marks stay on record; they just stop being handed cases."""
    if not exists(project_id):
        raise ProjectError("no_such_project")
    acting_owner = is_owner(acting_user_id, project_id)
    if not (acting_owner or acting_is_admin):
        raise ProjectError("not_allowed")
    if project_id == DEFAULT_PROJECT_ID:
        if not acting_owner:
            raise ProjectError("not_allowed")
        if member_role(user_id, project_id) == ROLE_OWNER:
            raise ProjectError("default_owner")
        with session_scope() as s:
            u = _live_user(s, user_id)
        role_store.revoke(u.id, role_store.ROLE_ANNOTATOR, acting_user_id=acting_user_id)
        return
    with session_scope() as s:
        row = s.execute(
            select(ProjectMember).where(ProjectMember.project_id == project_id, ProjectMember.user_id == user_id)
        ).scalar_one_or_none() if isinstance(user_id, str) else None
        if row is None:
            raise ProjectError("not_a_member")
        if row.role == ROLE_OWNER and not acting_is_admin:
            raise ProjectError("owner_by_admin")
        s.delete(row)
