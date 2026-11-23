"""End-to-end tests for projects through a Flask test client.

Who may create a project (an admin), who may name its owners (an admin), who may add collaborators (the project's own
owners), that one project's owner has no say in another, and that the built-in JHU project keeps running on the existing
annotation_manager / annotator roles.
"""

import importlib

import pytest


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'projects.db'}")
    monkeypatch.delenv("ADMIN_EMAILS", raising=False)

    import constants
    importlib.reload(constants)
    import models.engine as engine
    importlib.reload(engine)
    import models.user  # noqa: F401
    import models.auth_session  # noqa: F401
    import models.user_role  # noqa: F401
    import models.annotation_assignment  # noqa: F401
    import models.project  # noqa: F401
    import services.auth_store as auth_store
    importlib.reload(auth_store)
    import services.role_store as role_store
    importlib.reload(role_store)
    import models.job  # noqa: F401
    import services.project_store as project_store
    importlib.reload(project_store)
    import services.assignment_store as assignment_store
    importlib.reload(assignment_store)
    import api.auth as auth_mod
    importlib.reload(auth_mod)
    import api.auth_blueprint as auth_bp
    importlib.reload(auth_bp)
    import api.projects_blueprint as projects_bp
    importlib.reload(projects_bp)
    import api.assignments_blueprint as asg_bp
    importlib.reload(asg_bp)

    engine.reset_engine_for_tests()
    engine.create_all()
    auth_store.ensure_system_user()

    from flask import Flask
    app = Flask(__name__)
    app.register_blueprint(auth_bp.auth_blueprint, url_prefix="/api")
    app.register_blueprint(projects_bp.projects_blueprint, url_prefix="/api")
    app.register_blueprint(asg_bp.assignments_blueprint, url_prefix="/api")
    with app.test_client() as c:
        yield c
    engine.reset_engine_for_tests()


def sign_up(client, email):
    r = client.post("/api/auth/register", json={"email": email, "password": "password1"})
    return r.get_json()["user"]["id"]


def sign_in(client, email):
    client.post("/api/auth/login", json={"email": email, "password": "password1"})


def person(client, email, role=None):
    from services import role_store
    uid = sign_up(client, email)
    if role:
        role_store.grant(uid, role)
    return uid


def make_project(client, name="Stanford Lab"):
    sign_in(client, "admin@x.org")
    r = client.post("/api/projects", json={"name": name})
    assert r.status_code == 201, r.get_json()
    return r.get_json()["id"]


def add(client, project_id, user_id, role="collaborator"):
    return client.post(f"/api/projects/{project_id}/members", json={"user_id": user_id, "role": role})


@pytest.fixture()
def world(client):
    from services import role_store
    ids = {
        "admin": person(client, "admin@x.org", role_store.ROLE_ADMIN),
        "owner": person(client, "owner@stanford.edu"),
        "owner2": person(client, "owner2@mit.edu"),
        "collab": person(client, "collab@stanford.edu"),
        "stranger": person(client, "stranger@x.org"),
        "manager": person(client, "manager@jhu.edu", role_store.ROLE_ANNOTATION_MANAGER),
        "annotator": person(client, "annotator@jhu.edu", role_store.ROLE_ANNOTATOR),
    }
    ids["project"] = make_project(client)
    ids["other"] = make_project(client, "MIT Lab")
    assert add(client, ids["project"], ids["owner"], "owner").status_code == 200
    assert add(client, ids["other"], ids["owner2"], "owner").status_code == 200
    client.post("/api/auth/logout")
    return ids


def test_signed_out_callers_are_refused(client):
    assert client.get("/api/projects").status_code == 401
    assert client.post("/api/projects", json={"name": "X"}).status_code == 401


def test_only_an_admin_creates_a_project(client, world):
    sign_in(client, "owner@stanford.edu")
    assert client.post("/api/projects", json={"name": "Mine"}).status_code == 403
    sign_in(client, "manager@jhu.edu")
    assert client.post("/api/projects", json={"name": "Mine"}).status_code == 403


@pytest.mark.parametrize("name", ["", "   ", None, 5, "x" * 81, ["a"]])
def test_a_bad_project_name_is_refused(client, world, name):
    sign_in(client, "admin@x.org")
    r = client.post("/api/projects", json={"name": name})
    assert r.status_code == 400 and r.get_json()["reason"] == "bad_name"


@pytest.mark.parametrize("again", ["Stanford Lab", "stanford lab", "  Stanford   LAB ", "Stanford-Lab"])
def test_a_second_project_with_the_same_name_is_refused(client, world, again):
    sign_in(client, "admin@x.org")
    r = client.post("/api/projects", json={"name": again})
    assert r.status_code == 409 and r.get_json()["reason"] == "name_taken"


def test_a_new_project_does_not_allow_training(client, world):
    sign_in(client, "admin@x.org")
    listed = {p["name"]: p for p in client.get("/api/projects").get_json()["projects"]}
    assert listed["Stanford Lab"]["allow_training"] is False
    assert listed["JHU"]["allow_training"] is False


def test_only_an_admin_switches_training_on_and_it_must_be_a_real_boolean(client, world):
    sign_in(client, "owner@stanford.edu")
    assert client.patch(f"/api/projects/{world['project']}", json={"allow_training": True}).status_code == 403
    sign_in(client, "admin@x.org")
    assert client.patch(f"/api/projects/{world['project']}", json={"allow_training": "yes"}).status_code == 400
    ok = client.patch(f"/api/projects/{world['project']}", json={"allow_training": True})
    assert ok.status_code == 200 and ok.get_json()["allow_training"] is True
    assert client.patch("/api/projects/nope", json={"allow_training": True}).status_code == 404


def test_each_person_sees_only_their_own_projects_with_their_role(client, world):
    sign_in(client, "owner@stanford.edu")
    mine = {p["name"]: p["role"] for p in client.get("/api/projects").get_json()["projects"]}
    assert mine == {"Stanford Lab": "owner"}
    sign_in(client, "manager@jhu.edu")
    assert {p["name"]: p["role"] for p in client.get("/api/projects").get_json()["projects"]} == {"JHU": "owner"}
    sign_in(client, "annotator@jhu.edu")
    assert {p["name"]: p["role"] for p in client.get("/api/projects").get_json()["projects"]} == {"JHU": "collaborator"}
    sign_in(client, "stranger@x.org")
    assert client.get("/api/projects").get_json()["projects"] == []


def test_an_admin_sees_every_project(client, world):
    sign_in(client, "admin@x.org")
    names = [p["name"] for p in client.get("/api/projects").get_json()["projects"]]
    assert names[0] == "JHU" and sorted(names[1:]) == ["MIT Lab", "Stanford Lab"]


def test_the_signed_in_user_carries_their_projects(client, world):
    sign_in(client, "owner@stanford.edu")
    me = client.get("/api/auth/me").get_json()["user"]
    assert [(p["name"], p["role"]) for p in me["projects"]] == [("Stanford Lab", "owner")]


def test_an_owner_adds_a_collaborator_and_that_person_sees_the_project(client, world):
    sign_in(client, "owner@stanford.edu")
    r = add(client, world["project"], world["collab"])
    assert r.status_code == 200 and r.get_json()["role"] == "collaborator"
    sign_in(client, "collab@stanford.edu")
    assert [(p["name"], p["role"]) for p in client.get("/api/projects").get_json()["projects"]] == [("Stanford Lab", "collaborator")]


def test_an_owner_cannot_make_an_owner_but_an_admin_can(client, world):
    sign_in(client, "owner@stanford.edu")
    r = add(client, world["project"], world["collab"], "owner")
    assert r.status_code == 403 and r.get_json()["reason"] == "owner_by_admin"
    sign_in(client, "admin@x.org")
    assert add(client, world["project"], world["collab"], "owner").status_code == 200


@pytest.mark.parametrize("role", ["admin", "annotator", "annotation_manager", "", None, 3])
def test_an_unknown_role_is_refused(client, world, role):
    sign_in(client, "admin@x.org")
    r = client.post(f"/api/projects/{world['project']}/members", json={"user_id": world["collab"], "role": role})
    assert r.status_code == 400 and r.get_json()["reason"] == "bad_role"


def test_a_collaborator_or_stranger_cannot_manage_a_project(client, world):
    sign_in(client, "owner@stanford.edu")
    add(client, world["project"], world["collab"])
    for who in ("collab@stanford.edu", "stranger@x.org"):
        sign_in(client, who)
        assert client.get(f"/api/projects/{world['project']}/members").status_code == 403
        assert client.get(f"/api/projects/{world['project']}/find?email=a@b.org").status_code == 403
        assert add(client, world["project"], world["stranger"]).status_code == 403
        assert client.delete(f"/api/projects/{world['project']}/members/{world['owner']}").status_code == 403


def test_an_owner_has_no_say_in_another_project(client, world):
    sign_in(client, "owner@stanford.edu")
    assert client.get(f"/api/projects/{world['other']}/members").status_code == 403
    assert add(client, world["other"], world["stranger"]).status_code == 403
    assert client.delete(f"/api/projects/{world['other']}/members/{world['owner2']}").status_code == 403


def test_an_unknown_project_is_not_found(client, world):
    sign_in(client, "admin@x.org")
    assert client.get("/api/projects/nope/members").status_code == 404
    assert add(client, "nope", world["collab"]).status_code == 404
    assert client.delete(f"/api/projects/nope/members/{world['collab']}").status_code == 404


def test_members_are_listed_owners_first(client, world):
    sign_in(client, "owner@stanford.edu")
    add(client, world["project"], world["collab"])
    people = client.get(f"/api/projects/{world['project']}/members").get_json()["members"]
    assert [(p["email"], p["role"]) for p in people] == [("owner@stanford.edu", "owner"), ("collab@stanford.edu", "collaborator")]


def test_finding_a_person_needs_the_full_address_and_never_lists_others(client, world):
    sign_in(client, "owner@stanford.edu")
    found = client.get(f"/api/projects/{world['project']}/find?email=Collab@Stanford.edu").get_json()["account"]
    assert found["id"] == world["collab"]
    # part of an address finds nobody, and a string with no @ is refused outright
    assert client.get(f"/api/projects/{world['project']}/find?email=collab@").get_json()["account"] is None
    assert client.get(f"/api/projects/{world['project']}/find?email=collab").status_code == 400
    assert client.get(f"/api/projects/{world['project']}/find").status_code == 400


def test_adding_someone_twice_is_harmless(client, world):
    sign_in(client, "owner@stanford.edu")
    assert add(client, world["project"], world["collab"]).status_code == 200
    assert add(client, world["project"], world["collab"]).status_code == 200
    assert len(client.get(f"/api/projects/{world['project']}/members").get_json()["members"]) == 2


@pytest.mark.parametrize("who", ["nope", "", None, 5, "x" * 40])
def test_adding_an_account_that_does_not_exist_is_refused(client, world, who):
    sign_in(client, "owner@stanford.edu")
    r = client.post(f"/api/projects/{world['project']}/members", json={"user_id": who, "role": "collaborator"})
    assert r.status_code == 404 and r.get_json()["reason"] == "no_such_person"


def test_an_owner_removes_a_collaborator_but_not_another_owner(client, world):
    sign_in(client, "admin@x.org")
    add(client, world["project"], world["collab"], "owner")
    add(client, world["project"], world["stranger"])
    sign_in(client, "owner@stanford.edu")
    assert client.delete(f"/api/projects/{world['project']}/members/{world['stranger']}").status_code == 200
    r = client.delete(f"/api/projects/{world['project']}/members/{world['collab']}")
    assert r.status_code == 403 and r.get_json()["reason"] == "owner_by_admin"
    sign_in(client, "admin@x.org")
    assert client.delete(f"/api/projects/{world['project']}/members/{world['collab']}").status_code == 200
    assert client.delete(f"/api/projects/{world['project']}/members/{world['collab']}").status_code == 404


def test_being_in_a_project_gives_no_right_over_the_shared_library(client, world):
    from services import role_store
    sign_in(client, "owner@stanford.edu")
    add(client, world["project"], world["collab"])
    for uid in (world["owner"], world["collab"]):
        assert role_store.roles_for(uid) == []
    # and the JHU hand-out routes stay closed to a Stanford owner
    assert client.get("/api/assignments").status_code == 403
    assert client.post("/api/assignments", json={"assignee_id": world["collab"], "start": 1, "end": 2, "task": "T"}).status_code == 403


# ---- the built-in JHU project runs on the existing roles ------------------------------------------------------

def test_a_jhu_owner_adds_and_removes_a_collaborator_through_the_annotator_role(client, world):
    from services import role_store
    sign_in(client, "manager@jhu.edu")
    r = add(client, "jhu", world["stranger"])
    assert r.status_code == 200
    assert role_store.ROLE_ANNOTATOR in role_store.roles_for(world["stranger"])
    members = {p["email"]: p["role"] for p in client.get("/api/projects/jhu/members").get_json()["members"]}
    assert members == {"manager@jhu.edu": "owner", "annotator@jhu.edu": "collaborator", "stranger@x.org": "collaborator"}
    assert client.delete(f"/api/projects/jhu/members/{world['stranger']}").status_code == 200
    assert role_store.ROLE_ANNOTATOR not in role_store.roles_for(world["stranger"])


def test_nobody_is_made_a_jhu_owner_here(client, world):
    sign_in(client, "admin@x.org")
    r = add(client, "jhu", world["stranger"], "owner")
    assert r.status_code == 403 and r.get_json()["reason"] == "default_owner"


def test_an_admin_who_is_not_a_jhu_owner_cannot_hand_out_jhu_collaborators(client, world):
    sign_in(client, "admin@x.org")
    assert add(client, "jhu", world["stranger"]).status_code == 403
    assert client.delete(f"/api/projects/jhu/members/{world['annotator']}").status_code == 403


def test_a_jhu_owner_cannot_remove_another_jhu_owner(client, world):
    from services import role_store
    other = person(client, "manager2@jhu.edu", role_store.ROLE_ANNOTATION_MANAGER)
    sign_in(client, "manager@jhu.edu")
    r = client.delete(f"/api/projects/jhu/members/{other}")
    assert r.status_code == 403 and r.get_json()["reason"] == "default_owner"


def test_a_jhu_owner_has_no_say_in_a_stanford_project(client, world):
    sign_in(client, "manager@jhu.edu")
    assert client.get(f"/api/projects/{world['project']}/members").status_code == 403
    assert add(client, world["project"], world["stranger"]).status_code == 403
