"""The two migrations that add projects, run for real against a SQLite file the way the server runs them."""

import os
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

SERVER = Path(__file__).resolve().parents[2]
BEFORE, PROJECTS, ASSIGNMENT_PROJECTS = "b8e41d6a2f93", "c4a8e61b7d09", "d1f6a39b8c52"


def alembic(db: Path, *args: str) -> None:
    env = {**os.environ, "DATABASE_URL": f"sqlite:///{db}"}
    done = subprocess.run([sys.executable, "-m", "alembic", "-c", "alembic.ini", *args], cwd=SERVER, env=env,
                          capture_output=True, text=True, timeout=300)
    assert done.returncode == 0, done.stderr[-2000:]


def rows(db: Path, sql: str):
    con = sqlite3.connect(db)
    try:
        return con.execute(sql).fetchall()
    finally:
        con.close()


def tables(db: Path) -> set[str]:
    return {r[0] for r in rows(db, "select name from sqlite_master where type='table'")}


@pytest.fixture()
def db(tmp_path):
    return tmp_path / "migrate.db"


def test_the_built_in_project_exists_and_old_assignments_join_it(db):
    alembic(db, "upgrade", BEFORE)
    assert "project" not in tables(db)
    alembic(db, "upgrade", "head")
    assert {"project", "project_member"} <= tables(db)
    assert rows(db, "select id, name, slug, is_default, allow_training from project") == [("jhu", "JHU", "jhu", 1, 0)]
    cols = {r[1]: r for r in rows(db, "pragma table_info(annotation_assignment)")}
    assert "project_id" in cols and cols["project_id"][3] == 1   # not null


def test_an_assignment_made_before_projects_is_moved_into_the_built_in_one(db):
    alembic(db, "upgrade", PROJECTS)
    con = sqlite3.connect(db)
    user_cols = [r[1] for r in con.execute("pragma table_info(user_account)")]
    values = {"id": "u1", "email": "a@x.org", "created_at": "2026-01-01 00:00:00", "plan": "free", "is_system": 0}
    # only the columns this database really has and that need a value
    needed = [r[1] for r in con.execute("pragma table_info(user_account)") if r[3] and r[4] is None and r[1] not in values]
    for name in needed:
        values[name] = 0 if "is_" in name or name.endswith("_verified") else "x"
    keep = {k: v for k, v in values.items() if k in user_cols}
    con.execute(f"insert into user_account ({','.join(keep)}) values ({','.join('?' * len(keep))})", list(keep.values()))
    con.execute("insert into annotation_assignment (id, assignee_id, range_start, range_end, task, created_at) "
                "values ('a1', 'u1', 1, 5, 'Veins', '2026-01-01 00:00:00')")
    con.commit()
    con.close()
    alembic(db, "upgrade", ASSIGNMENT_PROJECTS)
    assert rows(db, "select id, project_id from annotation_assignment") == [("a1", "jhu")]


def test_the_migrations_can_be_undone(db):
    alembic(db, "upgrade", "head")
    alembic(db, "downgrade", PROJECTS)
    assert "project_id" not in {r[1] for r in rows(db, "pragma table_info(annotation_assignment)")}
    alembic(db, "downgrade", BEFORE)
    assert not {"project", "project_member"} & tables(db)
    alembic(db, "upgrade", "head")
    assert rows(db, "select id from project") == [("jhu",)]
