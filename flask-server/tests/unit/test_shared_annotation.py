"""Shared annotation override: an annotator saves a dataset scan's segmentation for EVERYONE.

The normal /save-segmentation keeps an edit private to the account; /save-segmentation-shared replaces
what the dataset shows. These tests pin the permission gate, the lost-update guard, who sees what
(original / shared / a person's own edit), the 2D mask + low-res preview, the mesh cache location, the
history archive and the revert.
"""
import gzip
import json
import os

import nibabel as nib
import numpy as np
import pytest
from flask import Flask

import api.api_blueprint as routes
import api.auth as auth_module
from constants import Constants
from services import role_store

CASE = 35
PANTS = "PanTS_00000035"


class Who:
    """The signed-in account for the next request (None = signed out)."""

    def __init__(self):
        self.user = None
        self.roles = []

    def sign_in(self, user_id, roles=()):
        self.user = {"id": user_id, "name": f"User {user_id}", "email": f"{user_id}@example.org"}
        self.roles = list(roles)

    def sign_out(self):
        self.user, self.roles = None, []


@pytest.fixture
def env(tmp_path, monkeypatch):
    root = tmp_path / "pants"
    mask_path = root / "mask_only" / PANTS / "combined_labels.nii.gz"
    mask_path.parent.mkdir(parents=True)
    original = np.zeros((8, 8, 8), dtype=np.uint8)
    original[2:6, 2:6, 2:6] = 25
    nib.save(nib.Nifti1Image(original, np.diag([0.75, 0.75, 5, 1])), mask_path)
    monkeypatch.setattr(Constants, "PANTS_PATH", str(root))
    monkeypatch.setattr(Constants, "PANTS_LABEL_SCHEMA", "ipantsmini-v1", raising=False)
    monkeypatch.setattr(Constants, "MESH_PATH", str(tmp_path / "meshes"), raising=False)
    monkeypatch.setenv("PANTS_VIEWER_LABEL_CACHE_PATH", str(tmp_path / "viewer-labels"))
    monkeypatch.setattr(routes, "LOWRES_ROOT", str(tmp_path / "lowres"))
    monkeypatch.setattr(routes, "mount_down_response", lambda: None)
    who = Who()
    for module in (routes, auth_module):
        monkeypatch.setattr(module, "current_user", lambda: who.user)
    for module in (routes, auth_module):
        monkeypatch.setattr(module, "current_roles", lambda: who.roles)
    app = Flask(__name__)
    app.register_blueprint(routes.api_blueprint, url_prefix="/api")
    return app.test_client(), original, who, tmp_path


def _payload(volume):
    return gzip.compress(volume.tobytes(order="F"))


def _shared_status(client):
    response = client.get(f"/api/shared-annotation/{CASE}")
    assert response.status_code == 200, response.get_json()
    return response.get_json()


def _save_shared(client, volume, if_match="none", case=CASE):
    headers = {} if if_match is None else {"If-Match": if_match}
    return client.post(f"/api/save-segmentation-shared/{case}?res=full", data=_payload(volume), headers=headers)


def _served(client, query=""):
    response = client.get(f"/api/get-segmentations/{CASE}.nii.gz{query}")
    assert response.status_code == 200, response.get_data()[:200]
    return response, np.asarray(nib.Nifti1Image.from_bytes(gzip.decompress(response.get_data())).dataobj)


def _corrected(original):
    fixed = original.copy()
    fixed[0, 0, 0] = 7
    return fixed


# ---- who may save ------------------------------------------------------------------------------

def test_roles_vocabulary_has_annotator_and_admin():
    assert role_store.ROLE_ANNOTATOR == "annotator"
    assert {"admin", "annotator"} <= set(role_store.ROLES)


def test_signed_out_cannot_save_shared(env):
    client, original, who, _ = env
    assert _save_shared(client, _corrected(original)).status_code == 401


def test_plain_account_cannot_save_shared_and_nothing_is_written(env):
    client, original, who, tmp_path = env
    who.sign_in("plain")
    assert _save_shared(client, _corrected(original)).status_code == 403
    assert not os.path.exists(routes._pants_shared_edit_path(CASE))


@pytest.mark.parametrize("role", ["annotator", "admin"])
def test_annotator_and_admin_can_save_shared(env, role):
    client, original, who, _ = env
    who.sign_in("approved", [role])
    response = _save_shared(client, _corrected(original))
    assert response.status_code == 200, response.get_json()
    assert os.path.isfile(routes._pants_shared_edit_path(CASE))


def test_signed_out_and_plain_cannot_revert(env):
    client, original, who, _ = env
    assert client.delete(f"/api/shared-annotation/{CASE}").status_code == 401
    who.sign_in("plain")
    assert client.delete(f"/api/shared-annotation/{CASE}").status_code == 403


# ---- the lost-update guard -----------------------------------------------------------------------

def test_save_without_if_match_is_refused_not_guessed(env):
    client, original, who, _ = env
    who.sign_in("approved", ["annotator"])
    assert _save_shared(client, _corrected(original), if_match=None).status_code == 428
    assert not os.path.exists(routes._pants_shared_edit_path(CASE))


def test_stale_if_match_is_a_conflict(env):
    client, original, who, _ = env
    who.sign_in("approved", ["annotator"])
    assert _save_shared(client, _corrected(original), if_match="deadbeef").status_code == 409
    assert _save_shared(client, _corrected(original), if_match="none").status_code == 200
    # The second annotator still holds the "none" they opened the scan with.
    who.sign_in("second", ["annotator"])
    assert _save_shared(client, _corrected(original), if_match="none").status_code == 409


def test_second_save_with_the_new_revision_succeeds_and_bumps_the_version(env):
    client, original, who, _ = env
    who.sign_in("approved", ["annotator"])
    assert _save_shared(client, _corrected(original)).status_code == 200
    status = _shared_status(client)
    assert status["exists"] and status["version"] == 1 and status["saved_by"] == "User approved"
    second = original.copy()
    second[7, 7, 7] = 9
    assert _save_shared(client, second, if_match=status["revision"]).status_code == 200
    assert _shared_status(client)["version"] == 2


# ---- who sees what -------------------------------------------------------------------------------

def test_everyone_sees_the_original_until_someone_overrides(env):
    client, original, who, _ = env
    who.sign_in("reader")
    _, seen = _served(client)
    # The dataset's source labels are converted to the viewer's ids on the way out; the shape is the original's.
    assert seen.shape == original.shape and np.array_equal(seen != 0, original != 0)
    assert _shared_status(client)["exists"] is False


def test_other_accounts_see_the_shared_version_after_an_override(env):
    client, original, who, _ = env
    fixed = _corrected(original)
    who.sign_in("approved", ["annotator"])
    assert _save_shared(client, fixed).status_code == 200
    for reader in ("reader-1", "reader-2"):
        who.sign_in(reader)
        response, seen = _served(client)
        assert np.array_equal(seen, fixed)
        assert response.headers["Cache-Control"] == "no-cache"
    who.sign_out()
    _, seen = _served(client)
    assert np.array_equal(seen, fixed)


def test_reopening_after_a_second_override_shows_the_newest(env):
    client, original, who, _ = env
    who.sign_in("approved", ["annotator"])
    first = _corrected(original)
    assert _save_shared(client, first).status_code == 200
    second = first.copy()
    second[7, 7, 7] = 9
    assert _save_shared(client, second, if_match=_shared_status(client)["revision"]).status_code == 200
    who.sign_in("reader")
    _, seen = _served(client)
    assert np.array_equal(seen, second)


def test_a_persons_own_saved_edit_still_wins_for_that_person(env):
    client, original, who, _ = env
    who.sign_in("reader")
    mine = original.copy()
    mine[1, 1, 1] = 3
    assert client.post(f"/api/save-segmentation/{CASE}?res=full", data=_payload(mine)).status_code == 200
    shared = _corrected(original)
    who.sign_in("approved", ["annotator"])
    assert _save_shared(client, shared).status_code == 200
    who.sign_in("reader")
    _, seen = _served(client)
    assert np.array_equal(seen, mine)
    who.sign_in("someone-else")
    _, seen = _served(client)
    assert np.array_equal(seen, shared)


def test_the_original_file_is_never_modified(env):
    client, original, who, tmp_path = env
    source = tmp_path / "pants" / "mask_only" / PANTS / "combined_labels.nii.gz"
    before = source.read_bytes()
    who.sign_in("approved", ["annotator"])
    assert _save_shared(client, _corrected(original)).status_code == 200
    assert source.read_bytes() == before


def test_low_resolution_preview_follows_the_shared_version(env):
    client, original, who, tmp_path = env
    low_path = tmp_path / "lowres" / "mask_only" / PANTS / "combined_labels_lowres.nii.gz"
    low_path.parent.mkdir(parents=True)
    nib.save(nib.Nifti1Image(original[::2, ::2, ::2], np.diag([1.5, 1.5, 10, 1])), low_path)
    fixed = original.copy()
    fixed[2:6, 2:6, 2:6] = 12  # a whole-structure correction the coarse grid can show
    who.sign_in("approved", ["annotator"])
    assert _save_shared(client, fixed).status_code == 200
    who.sign_in("reader")
    response, preview = _served(client, "?res=low")
    assert response.headers["Cache-Control"] == "no-cache"
    assert preview.shape == (4, 4, 4)
    assert 12 in np.unique(preview) and 25 not in np.unique(preview)


# ---- 3D meshes ------------------------------------------------------------------------------------

def test_meshes_come_from_a_separate_shared_cache_so_the_original_is_not_overwritten(env):
    client, original, who, tmp_path = env
    original_dir = routes._pants_mesh_directory(PANTS)
    assert original_dir == os.path.join(Constants.MESH_PATH, PANTS)
    who.sign_in("approved", ["annotator"])
    assert _save_shared(client, _corrected(original)).status_code == 200
    who.sign_in("reader")
    with client.application.test_request_context("/"):
        shared_dir = routes._pants_mesh_directory(PANTS)
    assert shared_dir == os.path.join(Constants.MESH_PATH, "shared", PANTS)
    assert shared_dir != original_dir


def test_mesh_cache_goes_stale_when_the_shared_version_changes(env, monkeypatch):
    client, original, who, tmp_path = env
    who.sign_in("approved", ["annotator"])
    assert _save_shared(client, _corrected(original)).status_code == 200
    who.sign_in("reader")
    with client.application.test_request_context("/"):
        shared_mask = routes._ai_local_mask_path(str(CASE))
        revision = routes.labelmap_revision(shared_mask)
        mesh_dir = routes._pants_mesh_directory(PANTS)
    os.makedirs(mesh_dir)
    manifest_path = os.path.join(mesh_dir, "manifest.json")
    with open(manifest_path, "w", encoding="utf-8") as handle:
        json.dump({"labelScheme": routes.LABEL_SCHEME, "labelmap_revision": revision, "organs": []}, handle)
    monkeypatch.setattr(Constants, "PANTS_LABEL_SCHEMA", "viewer-v1", raising=False)
    with client.application.test_request_context("/"):
        assert routes._mesh_cache_is_stale(manifest_path, str(CASE)) is False
    second = original.copy()
    second[7, 7, 7] = 9
    who.sign_in("approved", ["annotator"])
    assert _save_shared(client, second, if_match=_shared_status(client)["revision"]).status_code == 200
    who.sign_in("reader")
    with client.application.test_request_context("/"):
        assert routes._mesh_cache_is_stale(manifest_path, str(CASE)) is True


# ---- history and revert ---------------------------------------------------------------------------

def test_replacing_a_shared_version_archives_the_old_one(env):
    client, original, who, _ = env
    who.sign_in("approved", ["annotator"])
    first = _corrected(original)
    assert _save_shared(client, first).status_code == 200
    assert not os.path.isdir(routes._pants_shared_history_dir(CASE))  # nothing to archive on the first save
    second = first.copy()
    second[7, 7, 7] = 9
    assert _save_shared(client, second, if_match=_shared_status(client)["revision"]).status_code == 200
    archived = [n for n in os.listdir(routes._pants_shared_history_dir(CASE)) if n.endswith(".nii.gz")]
    assert len(archived) == 1
    kept = np.asarray(nib.load(os.path.join(routes._pants_shared_history_dir(CASE), archived[0])).dataobj)
    assert np.array_equal(kept, first)


def test_history_is_pruned_to_the_newest_versions(env, monkeypatch):
    client, original, who, _ = env
    monkeypatch.setattr(routes, "SHARED_HISTORY_KEEP", 3)
    who.sign_in("approved", ["annotator"])
    volume = original.copy()
    assert _save_shared(client, volume).status_code == 200
    for step in range(6):
        volume = volume.copy()
        volume[step, 0, 0] = 50 + step
        assert _save_shared(client, volume, if_match=_shared_status(client)["revision"]).status_code == 200
    names = [n for n in os.listdir(routes._pants_shared_history_dir(CASE)) if n.endswith(".nii.gz")]
    assert len(names) == 3


def test_revert_restores_the_original_for_everyone_and_archives_the_override(env):
    client, original, who, _ = env
    who.sign_in("approved", ["annotator"])
    _, baseline = _served(client)
    fixed = _corrected(original)
    assert _save_shared(client, fixed).status_code == 200
    revision = _shared_status(client)["revision"]
    response = client.delete(f"/api/shared-annotation/{CASE}", headers={"If-Match": revision})
    assert response.status_code == 200 and response.get_json()["reverted"] is True
    who.sign_in("reader")
    _, seen = _served(client)
    assert np.array_equal(seen, baseline)
    assert _shared_status(client)["exists"] is False
    archived = os.listdir(routes._pants_shared_history_dir(CASE))
    assert any(n.endswith(".nii.gz") for n in archived)
    with client.application.test_request_context("/"):
        assert routes._pants_mesh_directory(PANTS) == os.path.join(Constants.MESH_PATH, PANTS)


def test_revert_with_a_stale_revision_is_refused(env):
    client, original, who, _ = env
    who.sign_in("approved", ["annotator"])
    assert _save_shared(client, _corrected(original)).status_code == 200
    response = client.delete(f"/api/shared-annotation/{CASE}", headers={"If-Match": "stale"})
    assert response.status_code == 409
    assert os.path.isfile(routes._pants_shared_edit_path(CASE))


def test_revert_when_there_is_no_override_is_a_harmless_no_op(env):
    client, original, who, _ = env
    who.sign_in("approved", ["annotator"])
    response = client.delete(f"/api/shared-annotation/{CASE}")
    assert response.status_code == 200 and response.get_json()["reverted"] is False


# ---- status endpoint and unsupported scans ----------------------------------------------------------

def test_status_tells_each_account_whether_it_may_override(env):
    client, original, who, _ = env
    who.sign_in("plain")
    assert _shared_status(client)["can_override"] is False
    who.sign_in("approved", ["annotator"])
    assert _shared_status(client)["can_override"] is True
    who.sign_out()
    assert client.get(f"/api/shared-annotation/{CASE}").status_code == 401


@pytest.mark.parametrize("case", ["CV_00000001", "BDMAP_00000001"])
def test_other_datasets_have_no_shared_version(env, case):
    client, original, who, _ = env
    who.sign_in("approved", ["annotator"])
    assert client.get(f"/api/shared-annotation/{case}").get_json() == {"supported": False, "can_override": False}
    response = client.post(f"/api/save-segmentation-shared/{case}", data=b"", headers={"If-Match": "none"})
    assert response.status_code == 400


def test_a_session_upload_id_is_not_a_shared_scan(env):
    client, original, who, _ = env
    who.sign_in("approved", ["annotator"])
    response = client.post("/api/save-segmentation-shared/123e4567-e89b-12d3-a456-426614174000", data=b"",
                           headers={"If-Match": "none"})
    assert response.status_code == 400


def test_a_wrong_sized_payload_is_rejected_and_writes_nothing(env):
    client, original, who, _ = env
    who.sign_in("approved", ["annotator"])
    response = client.post(f"/api/save-segmentation-shared/{CASE}?res=full", data=gzip.compress(b"\x00" * 10),
                           headers={"If-Match": "none"})
    assert response.status_code == 400
    assert not os.path.exists(routes._pants_shared_edit_path(CASE))
    assert _shared_status(client)["exists"] is False


def test_a_normal_personal_save_does_not_touch_the_shared_version(env):
    client, original, who, _ = env
    who.sign_in("someone-else")
    _, baseline = _served(client)
    who.sign_in("reader")
    assert client.post(f"/api/save-segmentation/{CASE}?res=full", data=_payload(_corrected(original))).status_code == 200
    assert _shared_status(client)["exists"] is False
    who.sign_in("someone-else")
    _, seen = _served(client)
    assert np.array_equal(seen, baseline)


def test_the_response_revision_lets_the_annotators_next_normal_save_through(env):
    client, original, who, _ = env
    who.sign_in("approved", ["annotator"])
    response = _save_shared(client, _corrected(original))
    body = response.get_json()
    assert body["shared_revision"] != body["revision"] or body["revision"] == body["shared_revision"]
    # The next personal Save names the revision the annotator now resolves to.
    follow_up = client.post(f"/api/save-segmentation/{CASE}?res=full", data=_payload(_corrected(original)),
                            headers={"If-Match": body["revision"]})
    assert follow_up.status_code == 200


# ---- organ statistics, staging and the caches that remember them ------------------------------------

def test_service_and_blueprint_agree_on_where_the_shared_mask_lives(env):
    from services import shared_annotations
    assert shared_annotations.shared_mask_path(PANTS) == routes._pants_shared_edit_path(CASE)
    assert shared_annotations.shared_mask_path(PANTS, low=True) == routes._pants_shared_edit_path(CASE, low=True)


def test_organ_statistics_are_measured_from_the_shared_mask(env, monkeypatch):
    import api.utils as api_utils
    client, original, who, tmp_path = env
    seen = []

    class Recorder:
        def __init__(self, ct_path, mask_path, *args, **kwargs):
            seen.append(str(mask_path))

        def set_organ_intensities(self, *_):
            pass

        def calculate_metrics(self):
            return {"organ_metrics": []}

        def calculate_pdac_sma_staging(self):
            return "staged"

    monkeypatch.setattr(api_utils, "NiftiProcessor", Recorder)
    monkeypatch.setattr(api_utils, "viewer_labelmap_path", lambda path: "CONVERTED:" + str(path))
    api_utils.get_mask_data_internal(CASE)
    assert seen[-1].startswith("CONVERTED:")  # the original goes through the source-to-viewer conversion
    api_utils.get_pdac_staging(CASE)
    assert "mask_only" in seen[-1]

    who.sign_in("approved", ["annotator"])
    assert _save_shared(client, _corrected(original)).status_code == 200
    api_utils.get_mask_data_internal(CASE)
    assert seen[-1] == routes._pants_shared_edit_path(CASE)  # already viewer ids: no conversion
    api_utils.get_pdac_staging(CASE)
    assert seen[-1] == routes._pants_shared_edit_path(CASE)


def test_cached_statistics_are_measured_again_after_an_override_and_after_a_revert(env):
    client, original, who, _ = env
    before = routes._mask_data_stamp(CASE)
    metrics_before = routes._ai_metrics_stamp(str(CASE))
    who.sign_in("approved", ["annotator"])
    assert _save_shared(client, _corrected(original)).status_code == 200
    after = routes._mask_data_stamp(CASE)
    assert after != before and after[1][0] == routes._pants_shared_edit_path(CASE)
    assert routes._ai_metrics_stamp(str(CASE)) != metrics_before
    revision = _shared_status(client)["revision"]
    assert client.delete(f"/api/shared-annotation/{CASE}", headers={"If-Match": revision}).status_code == 200
    assert routes._mask_data_stamp(CASE) == before
    assert routes._ai_metrics_stamp(str(CASE)) == metrics_before


def test_a_second_override_changes_the_statistics_stamp_again(env):
    client, original, who, _ = env
    who.sign_in("approved", ["annotator"])
    assert _save_shared(client, _corrected(original)).status_code == 200
    first = routes._mask_data_stamp(CASE)
    second = original.copy()
    second[7, 7, 7] = 9
    assert _save_shared(client, second, if_match=_shared_status(client)["revision"]).status_code == 200
    assert routes._mask_data_stamp(CASE) != first


# ---- end to end: the 3D meshes everyone is shown -----------------------------------------------------

@pytest.fixture
def mesh_env(tmp_path, monkeypatch):
    root = tmp_path / "pants"
    label_path = root / "mask_only" / PANTS / "combined_labels.nii.gz"
    label_path.parent.mkdir(parents=True)
    labels = np.zeros((8, 8, 8), dtype=np.uint8)
    labels[1:3, 1:3, 1:3] = 1
    labels[4:6, 4:6, 4:6] = 14
    nib.save(nib.Nifti1Image(labels, np.eye(4)), label_path)
    monkeypatch.setattr(Constants, "PANTS_PATH", str(root))
    monkeypatch.setattr(Constants, "MESH_PATH", str(tmp_path / "meshes"))
    monkeypatch.setenv("PANTS_VIEWER_LABEL_CACHE_PATH", str(tmp_path / "viewer-labels"))
    monkeypatch.setattr(routes, "mount_down_response", lambda: None)
    who = Who()
    for module in (routes, auth_module):
        monkeypatch.setattr(module, "current_user", lambda: who.user)
        monkeypatch.setattr(module, "current_roles", lambda: who.roles)
    app = Flask(__name__)
    app.register_blueprint(routes.api_blueprint, url_prefix="/api")
    return app.test_client(), labels, who, tmp_path


def _manifest(client):
    response = client.get(f"/api/cases/{CASE}/mesh-manifest")
    assert response.status_code == 200, response.get_data()[:300]
    return response.get_json()


def _organ_ids(manifest):
    return [organ["id"] for organ in manifest["organs"]]


def test_everyone_gets_new_meshes_after_an_override_and_the_originals_again_after_a_revert(mesh_env):
    client, labels, who, tmp_path = mesh_env
    original_manifest_path = tmp_path / "meshes" / PANTS / "manifest.json"
    who.sign_in("reader")
    assert _organ_ids(_manifest(client)) == [1, 14]
    original_mtime = original_manifest_path.stat().st_mtime_ns

    corrected = np.zeros_like(labels)  # the fix: structure 1 was wrong, structure 3 was missing
    corrected[4:6, 4:6, 4:6] = 14
    corrected[1:4, 1:4, 1:4] = 3
    who.sign_in("approved", ["annotator"])
    assert _save_shared(client, corrected).status_code == 200

    who.sign_in("someone-else")
    manifest = _manifest(client)
    assert _organ_ids(manifest) == [3, 14]
    assert (tmp_path / "meshes" / "shared" / PANTS / "manifest.json").is_file()
    new_organ = next(organ for organ in manifest["organs"] if organ["id"] == 3)
    mesh = client.get(new_organ["url"])
    assert mesh.status_code == 200 and mesh.get_data()[:4] == b"glTF"
    who.sign_out()
    assert _organ_ids(_manifest(client)) == [3, 14]  # signed-out viewers (showcase scans) too
    assert original_manifest_path.stat().st_mtime_ns == original_mtime  # the original bake is untouched

    who.sign_in("approved", ["annotator"])
    revision = _shared_status(client)["revision"]
    assert client.delete(f"/api/shared-annotation/{CASE}", headers={"If-Match": revision}).status_code == 200
    who.sign_in("someone-else")
    assert _organ_ids(_manifest(client)) == [1, 14]
    assert original_manifest_path.stat().st_mtime_ns == original_mtime  # reverting needed no rebake


def test_a_second_override_rebakes_the_shared_meshes(mesh_env):
    client, labels, who, tmp_path = mesh_env
    first = np.zeros_like(labels)
    first[1:4, 1:4, 1:4] = 3
    who.sign_in("approved", ["annotator"])
    assert _save_shared(client, first).status_code == 200
    who.sign_in("reader")
    assert _organ_ids(_manifest(client)) == [3]
    second = np.zeros_like(labels)
    second[2:5, 2:5, 2:5] = 14
    who.sign_in("approved", ["annotator"])
    assert _save_shared(client, second, if_match=_shared_status(client)["revision"]).status_code == 200
    who.sign_in("reader")
    assert _organ_ids(_manifest(client)) == [14]


def test_a_person_with_their_own_saved_edit_keeps_their_own_meshes(mesh_env):
    client, labels, who, tmp_path = mesh_env
    mine = np.zeros_like(labels)
    mine[1:3, 1:3, 1:3] = 5
    who.sign_in("reader")
    assert client.post(f"/api/save-segmentation/{CASE}?res=full", data=_payload(mine)).status_code == 200
    shared = np.zeros_like(labels)
    shared[4:6, 4:6, 4:6] = 14
    who.sign_in("approved", ["annotator"])
    assert _save_shared(client, shared).status_code == 200
    who.sign_in("reader")
    assert _organ_ids(_manifest(client)) == [5]
    who.sign_in("someone-else")
    assert _organ_ids(_manifest(client)) == [14]
