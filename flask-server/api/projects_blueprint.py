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
  GET    /projects/<id>/scans                   -> the project's scans, numbered from 1               (project owner)
  POST   /projects/<id>/scans                   {session_id, uploaded_filename, modality, original_name?}
                                                  -> keep a finished upload (/upload-inference-chunk + /finalize-upload)
                                                     as the project's next scan                       (project owner)
  DELETE /projects/<id>/scans/<number>          -> remove one scan                                    (project owner)

Every project except the built-in ``jhu`` one is created by an admin, who names its owners. See services/project_store.py.
"""

import os

from flask import Blueprint, current_app, jsonify, request

from api.auth import current_roles, current_user, require_auth
from services import project_data, project_store, role_store

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


_DATA_STATUS = {
    "not_configured": 503, "no_room": 503, "library_project": 403, "no_such_project": 404, "no_such_upload": 404,
    "no_such_scan": 404, "duplicate": 409, "too_large": 413,
}


def _data_refusal(e: project_data.ProjectDataError):
    reason = e.reason if e.reason in project_data.MESSAGES else "not_a_volume"
    payload = {"error": project_data.MESSAGES[reason], "reason": reason}
    if reason == "duplicate" and isinstance(e.details.get("number"), int):
        payload["number"] = e.details["number"]
    return jsonify(payload), _DATA_STATUS.get(reason, 400)


def _require_owner(project_id: str):
    """None when the caller owns the project (an admin who is not an owner does not), else the response to send."""
    if not project_store.exists(project_id):
        return jsonify({"error": project_store.MESSAGES["no_such_project"], "reason": "no_such_project"}), 404
    if project_store.is_owner(current_user()["id"], project_id):
        return None
    return jsonify({"error": project_store.MESSAGES["not_allowed"], "reason": "not_allowed"}), 403


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


@projects_blueprint.route("/projects/<project_id>/scans", methods=["GET"])
@require_auth
def list_scans(project_id: str):
    refused = _require_owner(project_id)
    if refused:
        return refused
    return jsonify({"scans": project_data.list_scans(project_id), "configured": project_data.root() is not None}), 200


@projects_blueprint.route("/projects/<project_id>/scans", methods=["POST"])
@require_auth
def add_scan(project_id: str):
    """Keep a finished chunked upload as the project's next scan. The upload itself is the site's existing one: the file is
    sent in chunks and put together by /finalize-upload, which records who it belongs to; only that account can add it here."""
    refused = _require_owner(project_id)
    if refused:
        return refused
    body = _body()
    session_id, uploaded = body.get("session_id"), body.get("uploaded_filename")
    if not isinstance(session_id, str) or not isinstance(uploaded, str):
        return _data_refusal(project_data.ProjectDataError("no_such_upload"))
    from api import api_blueprint as site
    user = current_user()
    source = site._uploaded_file_candidate(session_id, uploaded)
    if source is None or site._read_owner_marker(session_id) != user["id"]:
        # The same answer for "not there" and "not yours".
        return _data_refusal(project_data.ProjectDataError("no_such_upload"))
    try:
        stored = project_data.store_scan(project_id, source, body.get("original_name") or os.path.basename(source),
                                         body.get("modality"), uploaded_by=user["id"])
    except project_data.ProjectDataError as e:
        if e.reason == "duplicate":
            # Already stored: the staged copy is of no further use.
            site._remove_finalized_upload(session_id)
        return _data_refusal(e)
    except Exception:
        current_app.logger.exception("Storing a project scan failed")
        return jsonify({"error": "The scan could not be stored. Try again.", "reason": "store_failed"}), 500
    site._remove_finalized_upload(session_id)
    return jsonify(stored), 201


@projects_blueprint.route("/projects/<project_id>/scans/<int:number>", methods=["DELETE"])
@require_auth
def delete_scan(project_id: str, number: int):
    refused = _require_owner(project_id)
    if refused:
        return refused
    try:
        project_data.delete_scan(project_id, number)
    except project_data.ProjectDataError as e:
        return _data_refusal(e)
    return jsonify({"deleted": True}), 200
