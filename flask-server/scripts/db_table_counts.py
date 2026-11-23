"""Row counts of every table in the SQLite databases, before and after a migration.

A migration must never remove rows: a column added by rebuilding a table once emptied a child table through
ON DELETE CASCADE, and nothing noticed. deploy.sh records the counts just before ``alembic upgrade head`` and checks
them straight after; if any table has fewer rows it stops, names the table, and points at the backup it took first.

    python scripts/db_table_counts.py snapshot counts.json  a.db b.db
    python scripts/db_table_counts.py check    counts.json  a.db b.db      # exit 1 and say which table shrank

Tables whose rows expire on their own (sessions and one-time tokens) are not compared, so normal clean-up between the two
readings is not mistaken for loss. Databases are opened read-only; nothing is changed.
"""
import json
import sqlite3
import sys
from pathlib import Path

# Rows here are removed by the site itself when they expire, at any moment.
EXPIRING = {"auth_session", "password_reset_token", "email_verification_token", "application_session", "alembic_version"}


def counts(db_path: str) -> dict:
    uri = Path(db_path).resolve().as_uri() + "?mode=ro"
    with sqlite3.connect(uri, uri=True) as con:
        names = [r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY 1")]
        return {name: con.execute(f'SELECT COUNT(*) FROM "{name}"').fetchone()[0] for name in names}


def snapshot(out: str, dbs: list) -> int:
    data = {db: counts(db) for db in dbs}
    Path(out).write_text(json.dumps(data), encoding="utf-8")
    print(f"recorded row counts of {sum(len(t) for t in data.values())} tables in {len(dbs)} database(s)")
    return 0


def check(before_file: str, dbs: list) -> int:
    before = json.loads(Path(before_file).read_text(encoding="utf-8"))
    shrunk = []
    for db in dbs:
        now = counts(db)
        for table, n_before in before.get(db, {}).items():
            if table in EXPIRING:
                continue
            n_now = now.get(table)
            if n_now is None:
                shrunk.append(f"{db}: table {table} is gone (it had {n_before} rows)")
            elif n_now < n_before:
                shrunk.append(f"{db}: table {table} went from {n_before} rows to {n_now}")
    if shrunk:
        print("ROW COUNTS FELL DURING THE MIGRATION:")
        for line in shrunk:
            print("  " + line)
        return 1
    print("every table has at least the rows it had before the migration")
    return 0


def main(argv) -> int:
    if len(argv) >= 4 and argv[1] == "snapshot":
        return snapshot(argv[2], argv[3:])
    if len(argv) >= 4 and argv[1] == "check":
        return check(argv[2], argv[3:])
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
