"""Projects: groups of people who work on cases together.

Routes (registered under <BASE_PATH>/api):
  GET    /projects                              -> the projects the caller belongs to (an admin sees all), with their role
  POST   /projects                              {name} -> create a project                                  (admin)
  PATCH  /projects/<id>                         {allow_training} -> whether its scans may be used for training (admin)
  GET    /projects/<id>/members                 -> everyone in the project                    (project owner or admin)
  GET    /projects/<id>/find?email=             -> the account with exactly that address      (project owner or admin)
  POST   /projects/<id>/members                 {user_id, role} -> add someone or change their role
                                                  (an owner adds collaborators; making an owner is an admin's job)
  DELETE /projects/<id>/members/<user_id>       -> take someone out                           (project owner or admin)

Every project except the built-in ``jhu`` one is created by an admin, who names its owners. See services/project_store.py.
"""

from flask import Blueprint, jsonify, request

from api.auth import current_roles, current_user, require_auth
from services import project_store, role_store

projects_blueprint = Blueprint("projects", __name__)

_STATUS = {
    "no_such_project": 404, "no_such_person": 404, "not_a_member": 404,
    "not_allowed": 403, "owner_by_admin": 403, "default_owner": 403,
    "name_taken": 409,
}


def _body() -> dict:
    raw = request.get_json(silent=True)
    return raw if isinstance(raw, dict) else {}


def _is_admin() -> bool:
    return role_store.ROLE_ADMIN in current_roles()


def _refusal(e: project_store.ProjectError):
    reason = e.reason if e.reason in project_store.MESSAGES else "not_allowed"
    return jsonify({"error": project_store.MESSAGES[reason], "reason": reason}), _STATUS.get(reason, 400)


def _role_refusal(e: role_store.RoleError):
    messages = {
        role_store.LAST_ADMIN: role_store.LAST_ADMIN_MESSAGE,
        role_store.SELF_DEMOTE: role_store.SELF_DEMOTE_MESSAGE,
    }
    return jsonify({"error": messages.get(e.reason, project_store.MESSAGES["not_allowed"]), "reason": e.reason}), 409


def _require_owner_or_admin(project_id: str):
    """None when the caller may manage the project, else the response to send."""
    if not project_store.exists(project_id):
        return jsonify({"error": project_store.MESSAGES["no_such_project"], "reason": "no_such_project"}), 404
    if _is_admin() or project_store.is_owner(current_user()["id"], project_id):
        return None
    return jsonify({"error": project_store.MESSAGES["not_allowed"], "reason": "not_allowed"}), 403


@projects_blueprint.route("/projects", methods=["GET"])
@require_auth
def list_projects():
    return jsonify({"projects": project_store.list_for(current_user()["id"], is_admin=_is_admin())}), 200


@projects_blueprint.route("/projects", methods=["POST"])
@require_auth
def create_project():
    if not _is_admin():
        return jsonify({"error": project_store.MESSAGES["not_allowed"], "reason": "not_allowed"}), 403
    try:
        return jsonify(project_store.create(_body().get("name"), created_by=current_user()["id"])), 201
    except project_store.ProjectError as e:
        return _refusal(e)


@projects_blueprint.route("/projects/<project_id>", methods=["PATCH"])
@require_auth
def update_project(project_id: str):
    if not _is_admin():
        return jsonify({"error": project_store.MESSAGES["not_allowed"], "reason": "not_allowed"}), 403
    allowed = _body().get("allow_training")
    if not isinstance(allowed, bool):
        return jsonify({"error": "allow_training must be true or false", "reason": "bad_value"}), 400
    try:
        return jsonify(project_store.set_allow_training(project_id, allowed)), 200
    except project_store.ProjectError as e:
        return _refusal(e)


@projects_blueprint.route("/projects/<project_id>/members", methods=["GET"])
@require_auth
def list_members(project_id: str):
    refused = _require_owner_or_admin(project_id)
    if refused:
        return refused
    return jsonify({"members": project_store.members(project_id)}), 200


@projects_blueprint.route("/projects/<project_id>/find", methods=["GET"])
@require_auth
def find_account(project_id: str):
    refused = _require_owner_or_admin(project_id)
    if refused:
        return refused
    try:
        return jsonify({"account": project_store.find_by_email(project_id, request.args.get("email"))}), 200
    except project_store.ProjectError as e:
        return _refusal(e)


@projects_blueprint.route("/projects/<project_id>/members", methods=["POST"])
@require_auth
def add_member(project_id: str):
    body = _body()
    try:
        person = project_store.add_member(
            project_id, body.get("user_id"), body.get("role", "collaborator"),
            acting_user_id=current_user()["id"], acting_is_admin=_is_admin(),
        )
    except project_store.ProjectError as e:
        return _refusal(e)
    return jsonify(person), 200


@projects_blueprint.route("/projects/<project_id>/members/<user_id>", methods=["DELETE"])
@require_auth
def remove_member(project_id: str, user_id: str):
    try:
        project_store.remove_member(project_id, user_id, acting_user_id=current_user()["id"], acting_is_admin=_is_admin())
    except project_store.ProjectError as e:
        return _refusal(e)
    except role_store.RoleError as e:
        return _role_refusal(e)
    return jsonify({"removed": True}), 200
