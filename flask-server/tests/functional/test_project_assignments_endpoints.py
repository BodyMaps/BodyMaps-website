"""Assignments are per project: a project owner hands cases to that project's collaborators and to nobody else's,
and an owner of one project has no say in another's (or in the shared JHU library's).
"""

import importlib

import pytest


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'project_assignments.db'}")
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


def sign_in(client, email):
    client.post("/api/auth/login", json={"email": email, "password": "password1"})


def person(client, email, role=None):
    from services import role_store
    uid = client.post("/api/auth/register", json={"email": email, "password": "password1"}).get_json()["user"]["id"]
    if role:
        role_store.grant(uid, role)
    return uid


@pytest.fixture()
def world(client):
    from services import project_store, role_store
    ids = {
        "admin": person(client, "admin@x.org", role_store.ROLE_ADMIN),
        "stan_owner": person(client, "owner@stanford.edu"),
        "stan_collab": person(client, "collab@stanford.edu"),
        "stan_collab2": person(client, "collab2@stanford.edu"),
        "mit_owner": person(client, "owner@mit.edu"),
        "mit_collab": person(client, "collab@mit.edu"),
        "manager": person(client, "manager@jhu.edu", role_store.ROLE_ANNOTATION_MANAGER),
        "annotator": person(client, "annotator@jhu.edu", role_store.ROLE_ANNOTATOR),
        "stranger": person(client, "stranger@x.org"),
    }
    ids["stan"] = project_store.create("Stanford Lab", ids["admin"])["id"]
    ids["mit"] = project_store.create("MIT Lab", ids["admin"])["id"]
    for project, owner, collabs in (("stan", "stan_owner", ["stan_collab", "stan_collab2"]), ("mit", "mit_owner", ["mit_collab"])):
        project_store.add_member(ids[project], ids[owner], "owner", acting_user_id=ids["admin"], acting_is_admin=True)
        for c in collabs:
            project_store.add_member(ids[project], ids[c], "collaborator", acting_user_id=ids[owner], acting_is_admin=False)
    return ids


def hand_out(client, project_id, assignee, start=1, end=10, task="Veins", **extra):
    body = {"assignee_id": assignee, "start": start, "end": end, "task": task, **extra}
    if project_id is not None:
        body["project_id"] = project_id
    return client.post("/api/assignments", json=body)


def test_an_owner_hands_cases_to_their_own_collaborator_in_their_project(client, world):
    sign_in(client, "owner@stanford.edu")
    r = hand_out(client, world["stan"], world["stan_collab"], 1, 40)
    assert r.status_code == 201
    body = r.get_json()
    assert body["project_id"] == world["stan"] and body["total"] == 40
    listed = client.get(f"/api/assignments?project={world['stan']}").get_json()["assignments"]
    assert [a["id"] for a in listed] == [body["id"]]


def test_the_shared_library_list_never_shows_a_projects_assignments(client, world):
    sign_in(client, "owner@stanford.edu")
    hand_out(client, world["stan"], world["stan_collab"])
    sign_in(client, "manager@jhu.edu")
    assert client.get("/api/assignments").get_json()["assignments"] == []
    assert client.get("/api/assignments?project=jhu").get_json()["assignments"] == []


def test_a_collaborator_of_another_project_cannot_be_handed_cases(client, world):
    sign_in(client, "owner@stanford.edu")
    for who in ("mit_collab", "annotator", "stranger", "mit_owner"):
        r = hand_out(client, world["stan"], world[who])
        assert r.status_code == 400 and r.get_json()["reason"] == "not_an_annotator", who


def test_an_owner_can_be_handed_cases_too(client, world):
    sign_in(client, "owner@stanford.edu")
    assert hand_out(client, world["stan"], world["stan_owner"]).status_code == 201


def test_an_owner_has_no_say_in_another_project(client, world):
    sign_in(client, "owner@stanford.edu")
    mit = world["mit"]
    assert hand_out(client, mit, world["mit_collab"]).status_code == 403
    assert client.get(f"/api/assignments?project={mit}").status_code == 403
    assert client.get(f"/api/assignments/people?project={mit}").status_code == 403
    assert client.get(f"/api/assignments/accounts?project={mit}&q=collab@mit.edu").status_code == 403
    assert client.post("/api/assignments/annotators", json={"user_id": world["stranger"], "project_id": mit}).status_code == 403
    assert client.delete(f"/api/assignments/annotators/{world['mit_collab']}?project={mit}").status_code == 403


def test_an_owner_cannot_change_or_delete_or_mark_another_projects_assignment(client, world):
    sign_in(client, "owner@mit.edu")
    other = hand_out(client, world["mit"], world["mit_collab"]).get_json()
    sign_in(client, "owner@stanford.edu")
    assert client.patch(f"/api/assignments/{other['id']}", json={"task": "Hacked"}).status_code == 404
    assert client.delete(f"/api/assignments/{other['id']}").status_code == 404
    assert client.put(f"/api/assignments/{other['id']}/cases/3", json={"status": "done"}).status_code == 404
    sign_in(client, "owner@mit.edu")
    mine = client.get(f"/api/assignments?project={world['mit']}").get_json()["assignments"]
    assert [(a["task"], a["done"]) for a in mine] == [("Veins", 0)]


def test_a_jhu_manager_has_no_say_in_a_project(client, world):
    sign_in(client, "owner@stanford.edu")
    made = hand_out(client, world["stan"], world["stan_collab"]).get_json()
    sign_in(client, "manager@jhu.edu")
    assert client.get(f"/api/assignments?project={world['stan']}").status_code == 403
    assert hand_out(client, world["stan"], world["stan_collab"]).status_code == 403
    assert client.delete(f"/api/assignments/{made['id']}").status_code == 404


def test_a_project_owner_has_no_say_in_the_shared_library(client, world):
    sign_in(client, "owner@stanford.edu")
    assert client.get("/api/assignments").status_code == 403
    assert hand_out(client, None, world["annotator"]).status_code == 403
    assert hand_out(client, "jhu", world["annotator"]).status_code == 403


def test_an_admin_who_is_not_an_owner_cannot_hand_out_cases(client, world):
    sign_in(client, "admin@x.org")
    assert hand_out(client, world["stan"], world["stan_collab"]).status_code == 403
    assert client.get(f"/api/assignments?project={world['stan']}").status_code == 403


@pytest.mark.parametrize("project", ["nope", "x" * 40, 7, ["jhu"], {"a": 1}])
def test_an_unknown_project_is_refused(client, world, project):
    sign_in(client, "owner@stanford.edu")
    r = client.post("/api/assignments", json={"assignee_id": world["stan_collab"], "start": 1, "end": 2, "task": "T", "project_id": project})
    assert r.status_code == 404 and r.get_json()["reason"] == "no_such_project"


def test_a_signed_out_caller_is_refused_everywhere(client, world):
    client.post("/api/auth/logout")  # registering the last account left the client signed in as them
    assert client.get(f"/api/assignments?project={world['stan']}").status_code == 401
    assert hand_out(client, world["stan"], world["stan_collab"]).status_code == 401
    assert client.get("/api/assignments/mine").status_code == 401


def test_the_same_range_and_task_in_two_projects_is_not_an_overlap(client, world):
    sign_in(client, "owner@stanford.edu")
    assert hand_out(client, world["stan"], world["stan_collab"], 1, 10).status_code == 201
    sign_in(client, "owner@mit.edu")
    assert hand_out(client, world["mit"], world["mit_collab"], 1, 10).status_code == 201
    sign_in(client, "owner@stanford.edu")
    again = hand_out(client, world["stan"], world["stan_collab2"], 5, 12)
    assert again.status_code == 409 and again.get_json()["reason"] == "overlap"
    assert [o["assignee"] for o in again.get_json()["overlaps"]] == ["collab@stanford.edu"]
    assert hand_out(client, world["stan"], world["stan_collab2"], 5, 12, force=True).status_code == 201


def test_a_collaborator_sees_their_own_cases_from_every_project_and_marks_them(client, world):
    sign_in(client, "owner@stanford.edu")
    made = hand_out(client, world["stan"], world["stan_collab"], 1, 3).get_json()
    sign_in(client, "collab@stanford.edu")
    mine = client.get("/api/assignments/mine").get_json()["assignments"]
    assert [(a["id"], a["project_id"]) for a in mine] == [(made["id"], world["stan"])]
    assert client.put(f"/api/assignments/{made['id']}/cases/2", json={"status": "done"}).status_code == 200
    # nothing else of theirs or anyone else's is reachable
    assert client.get(f"/api/assignments?project={world['stan']}").status_code == 403
    sign_in(client, "collab@mit.edu")
    assert client.get("/api/assignments/mine").get_json()["assignments"] == []
    assert client.put(f"/api/assignments/{made['id']}/cases/2", json={"status": "todo"}).status_code == 404


def test_an_owner_marks_any_case_in_their_own_project(client, world):
    sign_in(client, "owner@stanford.edu")
    made = hand_out(client, world["stan"], world["stan_collab"], 1, 3).get_json()
    r = client.put(f"/api/assignments/{made['id']}/cases/1", json={"status": "flagged"})
    assert r.status_code == 200 and r.get_json()["flagged"] == 1


def test_an_owner_changes_and_deletes_their_own_projects_assignment(client, world):
    sign_in(client, "owner@stanford.edu")
    made = hand_out(client, world["stan"], world["stan_collab"], 1, 3).get_json()
    changed = client.patch(f"/api/assignments/{made['id']}", json={"assignee_id": world["stan_collab2"], "task": "Ducts"})
    assert changed.status_code == 200 and changed.get_json()["task"] == "Ducts"
    # handing it to someone outside the project is refused
    refused = client.patch(f"/api/assignments/{made['id']}", json={"assignee_id": world["mit_collab"]})
    assert refused.status_code == 400 and refused.get_json()["reason"] == "not_an_annotator"
    assert client.delete(f"/api/assignments/{made['id']}").status_code == 200
    assert client.delete(f"/api/assignments/{made['id']}").status_code == 404


def test_the_people_of_a_project_are_its_owners_and_collaborators_only(client, world):
    sign_in(client, "owner@stanford.edu")
    people = client.get(f"/api/assignments/people?project={world['stan']}").get_json()["people"]
    assert sorted((p["email"], p["annotator"], p["manager"]) for p in people) == [
        ("collab2@stanford.edu", True, False), ("collab@stanford.edu", True, False), ("owner@stanford.edu", False, True),
    ]


def test_an_owner_adds_and_removes_a_collaborator_by_full_email(client, world):
    sign_in(client, "owner@stanford.edu")
    base = f"/api/assignments/accounts?project={world['stan']}"
    # part of an email, or a bare name, finds nobody and never lists others
    assert client.get(f"{base}&q=stranger").status_code == 400
    assert client.get(f"{base}&q=stranger@").get_json()["accounts"] == []
    found = client.get(f"{base}&q=Stranger@X.org").get_json()["accounts"]
    assert [(a["id"], a["annotator"], a["manager"]) for a in found] == [(world["stranger"], False, False)]
    added = client.post("/api/assignments/annotators", json={"user_id": world["stranger"], "project_id": world["stan"]})
    assert added.status_code == 200 and added.get_json()["annotator"] is True
    assert hand_out(client, world["stan"], world["stranger"]).status_code == 201
    gone = client.delete(f"/api/assignments/annotators/{world['stranger']}?project={world['stan']}")
    assert gone.status_code == 200 and gone.get_json()["annotator"] is False
    assert hand_out(client, world["stan"], world["stranger"]).status_code == 400
    # adding a collaborator in a project never gives the shared library's annotator role
    from services import role_store
    assert role_store.roles_for(world["stranger"]) == []


def test_the_shared_library_flow_is_unchanged(client, world):
    sign_in(client, "manager@jhu.edu")
    r = hand_out(client, None, world["annotator"], 55, 95, "Veins and arteries")
    assert r.status_code == 201 and r.get_json()["project_id"] == "jhu"
    assert [p["email"] for p in client.get("/api/assignments/people").get_json()["people"]] == ["annotator@jhu.edu", "manager@jhu.edu"]
    found = client.get("/api/assignments/accounts?q=strang").get_json()["accounts"]
    assert [a["email"] for a in found] == ["stranger@x.org"]
    assert client.get("/api/assignments").get_json()["assignments"][0]["project_id"] == "jhu"
