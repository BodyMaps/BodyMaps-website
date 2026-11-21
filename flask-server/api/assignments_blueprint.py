"""Annotation assignments: hand ranges of cases to annotators and follow their progress.

Routes (registered under <BASE_PATH>/api):
  GET    /assignments/mine                       -> the caller's own assignments, with the mark on each case
  PUT    /assignments/<id>/cases/<number>        {status: done|flagged|todo} -> mark one case (assignee or owner of its project)
  GET    /assignments?project=                   -> every assignment of the project with progress          (project owner)
  POST   /assignments                            {assignee_id, start, end, task, note?, due?, force?, project_id?}  (project owner)
  PATCH  /assignments/<id>                       {assignee_id?, task?, note?, due?}                        (owner of its project)
  DELETE /assignments/<id>                                                                                 (owner of its project)
  GET    /assignments/people?project=            -> accounts that can be given cases                       (project owner)
  GET    /assignments/accounts?q=&project=       -> accounts matching part of a name (JHU) or a full email (others)  (project owner)
  POST   /assignments/annotators                 {user_id, project_id?} -> add a collaborator              (project owner)
  DELETE /assignments/annotators/<user_id>?project= -> take the collaborator out                           (project owner)

Every route that changes or lists other people's work takes the project it is about (``?project=<id>`` or ``project_id``
in the body; the built-in ``jhu`` project when left out) and needs the caller to be an owner of that project. For the
built-in project that is the annotation manager role; for any other it is the project owner role (see
services/project_store.py). A collaborator only ever sees and marks their own work, and an owner of one project has no
say in another.
"""

from flask import Blueprint, jsonify, request

from api.auth import current_user, require_auth
from models.project import DEFAULT_PROJECT_ID
from services import assignment_store, project_store

assignments_blueprint = Blueprint("assignments", __name__)

_REFUSAL_STATUS = {"overlap": 409, "no_such_project": 404, "not_a_member": 404, "not_allowed": 403, "owner_by_admin": 403,
                   "default_owner": 403}

# What the caller is told for each refusal. Fixed text keyed by the reason: nothing from the exception itself is
# echoed back, so no internal detail can leak through an error response.
_REFUSAL_MESSAGES = {
    "bad_range": "Cases must be whole numbers from 1 up, the first before the last, with no more than 50,000 in one assignment.",
    "bad_task": "Say what should be annotated, as text of up to 120 characters.",
    "bad_note": "The note must be text of up to 2000 characters.",
    "bad_due": "The due date must look like 2026-12-31.",
    "no_such_person": "That account was not found.",
    "not_an_annotator": "Only an annotator can be given cases. Make them an annotator first.",
    "overlap": "Part of this range is already assigned for the same task.",
    "bad_status": "The status must be done, flagged or todo.",
    "bad_case": "The case must be a number.",
    "outside_range": "That case is not part of this assignment.",
    "short_query": "Type at least 3 letters of a name or email.",
    "need_exact_email": "Type the person's full email address.",
    "no_such_project": "That project was not found.",
    "not_a_member": "That person is not in this project.",
    "not_allowed": "You are not allowed to do that in this project.",
    "owner_by_admin": "Only an admin can make someone a project owner.",
    "default_owner": "JHU project owners are set on the server, not here.",
    "bad_role": "The role must be owner or collaborator.",
}

_NOT_FOUND_REASONS = {"no_such_project", "not_a_member"}
_FORBIDDEN_REASONS = {"not_allowed", "owner_by_admin", "default_owner"}


def _body() -> dict:
    raw = request.get_json(silent=True)
    return raw if isinstance(raw, dict) else {}


def _project_id(from_body: bool = False):
    """The project a request is about: ``?project=``, or ``project_id`` in the body; the built-in one when absent.
    None when what was sent is not a project id at all."""
    raw = _body().get("project_id") if from_body else request.args.get("project")
    if raw is None or raw == "":
        return DEFAULT_PROJECT_ID
    return raw if isinstance(raw, str) and len(raw) <= 36 else None


def _owner_gate(project_id):
    """None when the caller is signed in and owns the project, else the response to send."""
    user = current_user()
    if user is None:
        return jsonify({"error": "Authentication required"}), 401
    if project_id is None or not project_store.exists(project_id):
        return jsonify({"error": _REFUSAL_MESSAGES["no_such_project"], "reason": "no_such_project"}), 404
    if not project_store.is_owner(user["id"], project_id):
        return jsonify({"error": "You don't have access to this."}), 403
    return None


def _assignment_gate(assignment_id: str):
    """(project id, None) when the caller owns the assignment's project, else (None, the response to send).

    An assignment that does not exist and one in a project the caller does not own are answered alike, so an id
    cannot be used to find out what exists elsewhere."""
    user = current_user()
    if user is None:
        return None, (jsonify({"error": "Authentication required"}), 401)
    try:
        project_id = assignment_store.project_of(assignment_id)
    except LookupError:
        project_id = None
    if project_id is not None and project_store.is_owner(user["id"], project_id):
        return project_id, None
    if _owns_any():
        return None, (jsonify({"error": "No such assignment"}), 404)
    return None, (jsonify({"error": "You don't have access to this."}), 403)


def _owns_any() -> bool:
    user = current_user()
    return bool(user) and any(p["role"] == "owner" for p in project_store.list_for(user["id"]))


def _overlaps(details: dict) -> list[dict]:
    """The overlap list for the response, rebuilt field by field so only the expected values are sent."""
    out = []
    for o in details.get("overlaps", []):
        out.append({
            "id": str(o["id"]), "assignee": str(o["assignee"]),
            "start": int(o["start"]), "end": int(o["end"]),
            "shared_start": int(o["shared_start"]), "shared_end": int(o["shared_end"]),
        })
    return out


def _refusal(e: assignment_store.AssignmentError):
    reason = e.reason if e.reason in _REFUSAL_MESSAGES else "bad_range"
    payload = {"error": _REFUSAL_MESSAGES[reason], "reason": reason}
    if reason == "overlap":
        payload["overlaps"] = _overlaps(e.details)
    return jsonify(payload), _REFUSAL_STATUS.get(reason, 400)


@assignments_blueprint.route("/assignments/mine", methods=["GET"])
@require_auth
def my_assignments():
    return jsonify({"assignments": assignment_store.list_for(current_user()["id"])}), 200


@assignments_blueprint.route("/assignments/<assignment_id>/cases/<int:case_number>", methods=["PUT"])
@require_auth
def mark_case(assignment_id: str, case_number: int):
    try:
        result = assignment_store.set_case_status(
            assignment_id, case_number, _body().get("status"),
            acting_user_id=current_user()["id"],
        )
    except assignment_store.AssignmentError as e:
        return _refusal(e)
    except (LookupError, PermissionError):
        # The same answer for "no such assignment" and "not yours": an id that is not theirs is not theirs to probe.
        return jsonify({"error": "No such assignment"}), 404
    return jsonify(result), 200


@assignments_blueprint.route("/assignments", methods=["GET"])
def list_assignments():
    project_id = _project_id()
    refused = _owner_gate(project_id)
    if refused:
        return refused
    return jsonify({"assignments": assignment_store.list_all(project_id)}), 200


@assignments_blueprint.route("/assignments/people", methods=["GET"])
def assignable_people():
    project_id = _project_id()
    refused = _owner_gate(project_id)
    if refused:
        return refused
    try:
        return jsonify({"people": assignment_store.assignable_people(project_id)}), 200
    except assignment_store.AssignmentError as e:
        return _refusal(e)


@assignments_blueprint.route("/assignments", methods=["POST"])
def create_assignment():
    body = _body()
    project_id = _project_id(from_body=True)
    refused = _owner_gate(project_id)
    if refused:
        return refused
    force = body.get("force", False)
    if not isinstance(force, bool):
        return jsonify({"error": "force must be true or false"}), 400
    try:
        created = assignment_store.create(
            assignee_id=body.get("assignee_id"), start=body.get("start"), end=body.get("end"),
            task=body.get("task"), note=body.get("note"), due=body.get("due"),
            created_by=current_user()["id"], force=force, project_id=project_id,
        )
    except assignment_store.AssignmentError as e:
        return _refusal(e)
    return jsonify(created), 201


@assignments_blueprint.route("/assignments/<assignment_id>", methods=["PATCH"])
def update_assignment(assignment_id: str):
    _, refused = _assignment_gate(assignment_id)
    if refused:
        return refused
    body = _body()
    changes = {k: body[k] for k in ("assignee_id", "task", "note", "due") if k in body}
    try:
        return jsonify(assignment_store.update(assignment_id, changes)), 200
    except assignment_store.AssignmentError as e:
        return _refusal(e)
    except LookupError:
        return jsonify({"error": "No such assignment"}), 404


@assignments_blueprint.route("/assignments/<assignment_id>", methods=["DELETE"])
def delete_assignment(assignment_id: str):
    _, refused = _assignment_gate(assignment_id)
    if refused:
        return refused
    if not assignment_store.delete_assignment(assignment_id):
        return jsonify({"error": "No such assignment"}), 404
    return jsonify({"deleted": True}), 200


@assignments_blueprint.route("/assignments/accounts", methods=["GET"])
def find_accounts():
    project_id = _project_id()
    refused = _owner_gate(project_id)
    if refused:
        return refused
    try:
        return jsonify({"accounts": assignment_store.search_accounts(request.args.get("q", ""), project_id)}), 200
    except assignment_store.AssignmentError as e:
        return _refusal(e)


@assignments_blueprint.route("/assignments/annotators", methods=["POST"])
def add_annotator():
    project_id = _project_id(from_body=True)
    refused = _owner_gate(project_id)
    if refused:
        return refused
    try:
        return jsonify(assignment_store.make_annotator(_body().get("user_id"), granted_by=current_user()["id"],
                                                       project_id=project_id)), 200
    except assignment_store.AssignmentError as e:
        return _refusal(e)


@assignments_blueprint.route("/assignments/annotators/<user_id>", methods=["DELETE"])
def drop_annotator(user_id: str):
    project_id = _project_id()
    refused = _owner_gate(project_id)
    if refused:
        return refused
    try:
        return jsonify(assignment_store.remove_annotator(user_id, acting_user_id=current_user()["id"],
                                                         project_id=project_id)), 200
    except assignment_store.AssignmentError as e:
        return _refusal(e)
