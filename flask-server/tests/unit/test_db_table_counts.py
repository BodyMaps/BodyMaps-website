"""scripts/db_table_counts.py: the check deploy.sh runs after the migrations."""
import json
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "db_table_counts.py"


def run(*args):
    done = subprocess.run([sys.executable, str(SCRIPT), *map(str, args)], capture_output=True, text=True, timeout=60)
    return done.returncode, done.stdout + done.stderr


@pytest.fixture()
def db(tmp_path):
    path = tmp_path / "site.db"
    with sqlite3.connect(path) as con:
        con.execute("CREATE TABLE mark (id INTEGER PRIMARY KEY)")
        con.execute("CREATE TABLE auth_session (id INTEGER PRIMARY KEY)")
        con.executemany("INSERT INTO mark DEFAULT VALUES", [()] * 5)
        con.executemany("INSERT INTO auth_session DEFAULT VALUES", [()] * 4)
    return path


def snapshot(db, tmp_path):
    out = tmp_path / "counts.json"
    code, _ = run("snapshot", out, db)
    assert code == 0
    return out


def test_nothing_changed_passes(db, tmp_path):
    out = snapshot(db, tmp_path)
    code, text = run("check", out, db)
    assert code == 0 and "at least the rows it had" in text


def test_a_table_with_fewer_rows_fails_and_is_named(db, tmp_path):
    out = snapshot(db, tmp_path)
    with sqlite3.connect(db) as con:
        con.execute("DELETE FROM mark WHERE id > 1")
    code, text = run("check", out, db)
    assert code == 1 and "table mark went from 5 rows to 1" in text


def test_an_emptied_table_fails(db, tmp_path):
    out = snapshot(db, tmp_path)
    with sqlite3.connect(db) as con:
        con.execute("DELETE FROM mark")
    code, text = run("check", out, db)
    assert code == 1 and "from 5 rows to 0" in text


def test_a_dropped_table_fails(db, tmp_path):
    out = snapshot(db, tmp_path)
    with sqlite3.connect(db) as con:
        con.execute("DROP TABLE mark")
    code, text = run("check", out, db)
    assert code == 1 and "table mark is gone" in text


def test_more_rows_and_new_tables_pass(db, tmp_path):
    out = snapshot(db, tmp_path)
    with sqlite3.connect(db) as con:
        con.execute("INSERT INTO mark DEFAULT VALUES")
        con.execute("CREATE TABLE brand_new (id INTEGER)")
    assert run("check", out, db)[0] == 0


def test_rows_that_expire_by_themselves_are_not_counted_as_loss(db, tmp_path):
    out = snapshot(db, tmp_path)
    with sqlite3.connect(db) as con:
        con.execute("DELETE FROM auth_session")
    assert run("check", out, db)[0] == 0


def test_several_databases_are_checked_and_the_right_one_is_named(db, tmp_path):
    other = tmp_path / "other.db"
    with sqlite3.connect(other) as con:
        con.execute("CREATE TABLE note (id INTEGER)")
        con.executemany("INSERT INTO note VALUES (?)", [(1,), (2,)])
    out = tmp_path / "counts.json"
    assert run("snapshot", out, db, other)[0] == 0
    with sqlite3.connect(other) as con:
        con.execute("DELETE FROM note")
    code, text = run("check", out, db, other)
    assert code == 1 and "other.db: table note went from 2 rows to 0" in text and "site.db" not in text


def test_it_only_reads_the_databases(db, tmp_path):
    before = db.read_bytes()
    out = snapshot(db, tmp_path)
    run("check", out, db)
    assert db.read_bytes() == before


@pytest.mark.parametrize("args", [(), ("snapshot",), ("check", "x.json"), ("frobnicate", "a", "b")])
def test_bad_use_is_refused_with_the_help_text(args):
    code, text = run(*args)
    assert code == 2 and "Row counts of every table" in text
