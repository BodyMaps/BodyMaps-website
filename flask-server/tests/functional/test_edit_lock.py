"""The edit lock on a dataset scan's shared version, through a Flask test client.

One annotator edits a scan at a time: who gets it, renewing it, letting go, a lapsed lock, an annotation manager
taking over, and the shared save and revert refusing while someone else holds the scan. Synthetic accounts only.
"""

import importlib
import threading
from datetime import timedelta

import pytest


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'edit_lock.db'}")
    monkeypatch.delenv("ADMIN_EMAILS", raising=False)
    monkeypatch.delenv("BODYMAPS_EDIT_LOCK_TTL_SECONDS", raising=False)

    import constants
    importlib.reload(constants)
    import models.engine as engine
    importlib.reload(engine)
    import models.user  # noqa: F401
    import models.auth_session  # noqa: F401
    import models.user_role  # noqa: F401
    import models.scan_edit_lock  # noqa: F401
    import services.auth_store as auth_store
    importlib.reload(auth_store)
    import services.role_store as role_store
    importlib.reload(role_store)
    import services.edit_lock_store as edit_lock_store
    importlib.reload(edit_lock_store)
    import api.auth as auth_mod
    importlib.reload(auth_mod)
    import api.auth_blueprint as auth_bp
    importlib.reload(auth_bp)
    import api.api_blueprint as api_bp
    importlib.reload(api_bp)

    engine.reset_engine_for_tests()
    engine.create_all()
    auth_store.ensure_system_user()

    from flask import Flask
    app = Flask(__name__)
    app.register_blueprint(auth_bp.auth_blueprint, url_prefix="/api")
    app.register_blueprint(api_bp.api_blueprint, url_prefix="/api")
    with app.test_client() as c:
        yield c
    engine.reset_engine_for_tests()


def make(client, email, role=None):
    from services import role_store
    r = client.post("/api/auth/register", json={"email": email, "password": "password1"})
    uid = r.get_json()["user"]["id"]
    if role:
        role_store.grant(uid, role)
    return uid


def sign_in(client, email):
    client.post("/api/auth/logout")
    client.post("/api/auth/login", json={"email": email, "password": "password1"})


def team(client):
    from services import role_store
    make(client, "one@b.com", role_store.ROLE_ANNOTATOR)
    make(client, "two@b.com", role_store.ROLE_ANNOTATOR)
    make(client, "lead@b.com", role_store.ROLE_ANNOTATION_MANAGER)
    make(client, "visitor@b.com")


LOCK = "/api/shared-annotation/55/lock"


def test_first_editor_holds_the_scan_and_the_next_sees_who(client):
    team(client)
    sign_in(client, "one@b.com")
    r = client.post(LOCK)
    assert r.status_code == 200
    assert r.get_json()["mine"] is True
    assert r.get_json()["ttl_seconds"] == 30 * 60

    sign_in(client, "two@b.com")
    r = client.post(LOCK)
    assert r.status_code == 409
    body = r.get_json()
    assert body["reason"] == "edit_lock" and body["mine"] is False
    assert body["holder"] == "one@b.com"
    assert "one@b.com is editing this scan" in body["error"]
    status = client.get(LOCK).get_json()
    assert status["held"] is True and status["mine"] is False and status["holder"] == "one@b.com"


def test_renewing_keeps_the_hold_and_moves_the_expiry(client):
    from models.engine import session_scope
    from models.scan_edit_lock import ScanEditLock
    team(client)
    sign_in(client, "one@b.com")
    client.post(LOCK)
    with session_scope() as s:
        row = s.get(ScanEditLock, "PanTS_00000055")
        first_acquired, first_expiry = row.acquired_at, row.expires_at
        row.expires_at = first_expiry - timedelta(minutes=20)  # as if the last renewal was a while ago
    assert client.post(LOCK).status_code == 200
    with session_scope() as s:
        row = s.get(ScanEditLock, "PanTS_00000055")
        assert row.acquired_at == first_acquired
        assert row.expires_at > first_expiry - timedelta(minutes=20)


def test_the_same_scan_written_two_ways_shares_one_lock(client):
    team(client)
    sign_in(client, "one@b.com")
    client.post("/api/shared-annotation/PanTS_00000055/lock")
    sign_in(client, "two@b.com")
    assert client.post(LOCK).status_code == 409


def test_only_the_holder_can_let_go(client):
    team(client)
    sign_in(client, "one@b.com")
    client.post(LOCK)
    sign_in(client, "two@b.com")
    assert client.delete(LOCK).get_json() == {"released": False}
    assert client.post(LOCK).status_code == 409
    sign_in(client, "one@b.com")
    assert client.delete(LOCK).get_json() == {"released": True}
    sign_in(client, "two@b.com")
    assert client.post(LOCK).status_code == 200


def test_a_lapsed_lock_goes_to_the_next_editor(client):
    from models.engine import session_scope
    from models.job import utcnow
    from models.scan_edit_lock import ScanEditLock
    team(client)
    sign_in(client, "one@b.com")
    client.post(LOCK)
    with session_scope() as s:
        s.get(ScanEditLock, "PanTS_00000055").expires_at = utcnow() - timedelta(seconds=1)
    sign_in(client, "two@b.com")
    assert client.get(LOCK).get_json()["held"] is False
    r = client.post(LOCK)
    assert r.status_code == 200 and r.get_json()["mine"] is True


def test_a_manager_can_take_over_and_an_annotator_cannot(client):
    team(client)
    sign_in(client, "one@b.com")
    client.post(LOCK)
    sign_in(client, "two@b.com")
    assert client.post(LOCK + "/take-over").status_code == 403
    sign_in(client, "lead@b.com")
    r = client.post(LOCK + "/take-over")
    assert r.status_code == 200 and r.get_json()["mine"] is True
    sign_in(client, "one@b.com")
    assert client.get(LOCK).get_json()["holder"] == "lead@b.com"


def test_who_may_ask_for_a_lock(client):
    team(client)
    client.post("/api/auth/logout")  # registering signs the new account in
    assert client.post(LOCK).status_code == 401  # signed out
    sign_in(client, "visitor@b.com")
    assert client.post(LOCK).status_code == 403  # no annotating role
    sign_in(client, "one@b.com")
    assert client.post("/api/shared-annotation/not-a-scan/lock").status_code == 400


def test_save_and_revert_are_refused_while_someone_else_edits(client):
    team(client)
    sign_in(client, "one@b.com")
    client.post(LOCK)

    sign_in(client, "two@b.com")
    for r in (client.post("/api/save-segmentation-shared/55"), client.delete("/api/shared-annotation/55")):
        assert r.status_code == 409
        assert r.get_json()["reason"] == "edit_lock"
        assert r.get_json()["holder"] == "one@b.com"

    # The holder is not stopped by the lock; the save goes on to its usual checks (here: no scan on disk).
    sign_in(client, "one@b.com")
    r = client.post("/api/save-segmentation-shared/55")
    assert (r.get_json() or {}).get("reason") != "edit_lock"

    # A scan nobody holds saves exactly as before.
    sign_in(client, "two@b.com")
    r = client.post("/api/save-segmentation-shared/56")
    assert (r.get_json() or {}).get("reason") != "edit_lock"


def test_two_people_asking_at_once_get_one_lock(client):
    team(client)
    from models.engine import session_scope
    from models.user import User
    from services import edit_lock_store
    with session_scope() as s:
        ids = [u.id for u in s.query(User).filter(User.email.in_(["one@b.com", "two@b.com", "lead@b.com"]))]
    results, start = [], threading.Barrier(len(ids) * 3)

    def grab(uid):
        start.wait()
        results.append((uid, edit_lock_store.acquire("PanTS_00000077", uid)["mine"]))

    threads = [threading.Thread(target=grab, args=(uid,)) for uid in ids * 3]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    winners = {uid for uid, mine in results if mine}
    assert len(winners) == 1


@pytest.mark.parametrize("value, expected", [("120", 120), ("5", 60), ("999999", 86400), ("soon", 1800)])
def test_the_lapse_time_comes_from_the_environment_within_limits(client, monkeypatch, value, expected):
    from services import edit_lock_store
    monkeypatch.setenv("BODYMAPS_EDIT_LOCK_TTL_SECONDS", value)
    assert edit_lock_store.ttl_seconds() == expected
