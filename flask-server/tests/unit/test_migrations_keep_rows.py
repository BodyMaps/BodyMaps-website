"""Migrations must never remove rows.

annotation_assignment_case (every done/flagged mark) refers to annotation_assignment with ON DELETE CASCADE. A migration that only
added a column to annotation_assignment rebuilt the table, which dropped the old one with foreign keys on, and that deleted every
mark. These tests run the real migrations, with the real alembic environment, on a database that already holds assignments and marks.
"""
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

SERVER = Path(__file__).resolve().parents[2]
BEFORE_PROJECT_ASSIGNMENTS = "c4a8e61b7d09"      # the revision just before annotation_assignment gets its project_id


def alembic(db: Path, *args: str) -> None:
    env = {**os.environ, "DATABASE_URL": f"sqlite:///{db}"}
    done = subprocess.run([sys.executable, "-m", "alembic", "-c", "alembic.ini", *args], cwd=SERVER, env=env,
                          capture_output=True, text=True, timeout=300)
    assert done.returncode == 0, done.stderr[-3000:]


def insert(con, table, **given):
    """A row with the values given and a placeholder for every other column the table insists on."""
    cols = list(con.execute(f"pragma table_info({table})"))
    values = dict(given)
    for _cid, name, kind, notnull, default, pk in cols:
        if name in values or (not notnull and not pk) or default is not None:
            continue
        values[name] = 0 if "INT" in kind.upper() or "BOOL" in kind.upper() else "2026-01-01 00:00:00" if "DATE" in kind.upper() else "x"
    con.execute(f"insert into {table} ({','.join(values)}) values ({','.join('?' * len(values))})", list(values.values()))


@pytest.fixture()
def seeded(tmp_path):
    """A database one revision short of per-project assignments, with an assignment and its marks in it."""
    db = tmp_path / "live.db"
    alembic(db, "upgrade", BEFORE_PROJECT_ASSIGNMENTS)
    con = sqlite3.connect(db)
    con.execute("PRAGMA foreign_keys=OFF")
    insert(con, "user_account", id="u1", email="annotator@x.org")
    insert(con, "annotation_assignment", id="a1", assignee_id="u1", range_start=100, range_end=200, task="Veins")
    for n in range(100, 149):
        insert(con, "annotation_assignment_case", assignment_id="a1", case_number=n, status="flagged" if n == 100 else "done")
    con.commit()
    con.close()
    return db


def test_marks_survive_the_migration_that_adds_project_id(seeded):
    alembic(seeded, "upgrade", "head")
    con = sqlite3.connect(seeded)
    assert con.execute("select count(*) from annotation_assignment").fetchone()[0] == 1
    assert con.execute("select status, count(*) from annotation_assignment_case group by status order by 1").fetchall() == [("done", 48), ("flagged", 1)]
    assert con.execute("select project_id from annotation_assignment").fetchone()[0] == "jhu"
    assert con.execute("pragma foreign_key_check").fetchall() == []
    con.close()


def test_every_migration_step_keeps_every_row(seeded):
    """One revision at a time from the seeded point to head: no table may have fewer rows after a step than before it."""
    import re
    versions = {}
    for f in (SERVER / "migrations" / "versions").glob("*.py"):
        text = f.read_text(encoding="utf-8")
        rev = re.search(r"^revision(?:: str)? = ['\"]([0-9a-f]+)['\"]", text, re.M)
        down = re.search(r"^down_revision(?:: [^=]+)? = ['\"]?([0-9a-f]+|None)['\"]?", text, re.M)
        if rev and down:
            versions[down.group(1)] = rev.group(1)
    step = BEFORE_PROJECT_ASSIGNMENTS
    walked = 0
    while step in versions:
        before = counts(seeded)
        alembic(seeded, "upgrade", versions[step])
        after = counts(seeded)
        for table, n in before.items():
            if table in ("alembic_version",):
                continue
            assert after.get(table, 0) >= n, f"{table}: {n} rows before revision {versions[step]}, {after.get(table)} after"
        step = versions[step]
        walked += 1
    assert walked >= 1


def counts(db: Path) -> dict:
    con = sqlite3.connect(db)
    try:
        names = [r[0] for r in con.execute("select name from sqlite_master where type='table' and name not like 'sqlite_%'")]
        return {n: con.execute(f'select count(*) from "{n}"').fetchone()[0] for n in names}
    finally:
        con.close()
