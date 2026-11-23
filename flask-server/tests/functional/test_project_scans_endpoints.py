"""Project datasets through the real routes: an owner uploads a scan with the site's chunked upload and adds it to the
project, the project's own people open it in the viewer, and nobody else can see that it exists.

api.api_blueprint has import-time side effects (it creates directories from env-configured paths), so the fixture points
every path at a temp dir before the import. The module is imported once per pytest process: run this file as its own
step, as ci.yml does.
"""
import gzip
import importlib
import os
import threading
import uuid

import nibabel as nib
import numpy as np
import pytest

pytest.importorskip("asgiref")      # get-segmentations is an `async def` route
pytest.importorskip("trimesh")
pytest.importorskip("skimage")


def volume_bytes(seed=0, shape=(16, 18, 20), dtype=np.int16, compressed=True):
    data = np.random.default_rng(seed).integers(-500, 500, size=shape).astype(dtype)
    image = nib.Nifti1Image(data, np.diag([1.5, 1.5, 2.0, 1.0]))
    image.set_data_dtype(dtype)
    suffix = ".nii.gz" if compressed else ".nii"
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "v" + suffix)
        nib.save(image, path)
        return open(path, "rb").read()


@pytest.fixture(scope="module")
def env(tmp_path_factory):
    base = tmp_path_factory.mktemp("project_scans")
    for var, value in [
        ("DATABASE_URL", f"sqlite:///{base / 'ps.db'}"),
        ("PANTS_PATH", str(base / "pants")),
        ("PANTS_LOWRES_PATH", str(base / "lowres")),
        ("PERMISSIONS_DIR", str(base / "perm")),
        ("BODYMAPS_UPLOAD_CHUNK_DIR", str(base / "chunks")),
        ("SESSIONS_DIR_PATH", str(base / "sessions")),
        ("PROJECT_DATASET_PATH", str(base / "projects")),
        ("PROJECT_DATASET_MIN_FREE_GB", "0"),
        ("MOUNT_GUARD", "0"),
    ]:
        os.environ[var] = value
    for var in ("ABDOMENATLAS_PATH", "ABDOMENATLAS_OVERLAY_PATH", "CANCERVERSE_PATH", "CANCERVERSE_OVERLAY_PATH", "ADMIN_EMAILS"):
        os.environ.pop(var, None)
    (base / "projects").mkdir()

    import constants
    importlib.reload(constants)
    import models.engine as engine
    importlib.reload(engine)
    import models.user  # noqa: F401
    import models.auth_session  # noqa: F401
    import models.usage_event  # noqa: F401
    import models.user_role  # noqa: F401
    import models.project  # noqa: F401
    import models.project_scan  # noqa: F401
    import services.auth_store as auth_store
    importlib.reload(auth_store)
    import services.plan_store as plan_store
    importlib.reload(plan_store)
    import services.role_store as role_store
    importlib.reload(role_store)
    import services.project_store as project_store
    importlib.reload(project_store)
    import services.project_data as project_data
    importlib.reload(project_data)
    import api.auth as auth_mod
    importlib.reload(auth_mod)
    import api.auth_blueprint as auth_bp
    importlib.reload(auth_bp)
    import api.projects_blueprint as projects_bp
    importlib.reload(projects_bp)
    import api.access_policy as access_policy
    importlib.reload(access_policy)
    import api.api_blueprint as api_bp           # heavy; imported once

    engine.reset_engine_for_tests()
    engine.create_all()
    auth_store.ensure_system_user()

    from flask import Flask
    app = Flask(__name__)
    app.register_blueprint(auth_bp.auth_blueprint, url_prefix="/api")
    app.register_blueprint(projects_bp.projects_blueprint, url_prefix="/api")
    app.register_blueprint(api_bp.api_blueprint, url_prefix="/api")
    access_policy.install_access_policy(app)

    def make_client(email=None):
        c = app.test_client()
        if email:
            r = c.post("/api/auth/login", json={"email": email, "password": "password1"})
            assert r.status_code == 200, r.get_json()
        return c

    def person(email, role=None):
        c = app.test_client()
        uid = c.post("/api/auth/register", json={"email": email, "password": "password1"}).get_json()["user"]["id"]
        if role:
            role_store.grant(uid, role)
        return uid

    ids = {
        "admin": person("admin@x.org", role_store.ROLE_ADMIN),
        "owner": person("owner@stanford.edu"),
        "collab": person("collab@stanford.edu"),
        "owner2": person("owner@mit.edu"),
        "stranger": person("stranger@x.org"),
        "manager": person("manager@jhu.edu", role_store.ROLE_ANNOTATION_MANAGER),
        "annotator": person("annotator@jhu.edu", role_store.ROLE_ANNOTATOR),
    }
    ids["project"] = project_store.create("Stanford Lab", ids["admin"])["id"]
    ids["other"] = project_store.create("MIT Lab", ids["admin"])["id"]
    project_store.add_member(ids["project"], ids["owner"], "owner", acting_user_id=ids["admin"], acting_is_admin=True)
    project_store.add_member(ids["project"], ids["collab"], "collaborator", acting_user_id=ids["owner"], acting_is_admin=False)
    project_store.add_member(ids["other"], ids["owner2"], "owner", acting_user_id=ids["admin"], acting_is_admin=True)
    return {"app": app, "client": make_client, "ids": ids, "base": base, "data": project_data, "store": project_store}


def upload(client, content, name="scan.nii.gz", session=None):
    """The site's own chunked upload, in one chunk, then finalize. Returns (session id, uploaded_filename)."""
    session = session or uuid.uuid4().hex
    r = client.post("/api/upload-inference-chunk", data={
        "session_id": session, "chunk_index": "0", "total_chunks": "1", "file": (__import__("io").BytesIO(content), "chunk"),
    }, content_type="multipart/form-data")
    assert r.status_code == 200, r.get_json()
    r = client.post("/api/finalize-upload", data={"session_id": session, "total_chunks": "1", "output_filename": name})
    assert r.status_code == 200, r.get_json()
    return session, r.get_json()["uploaded_filename"]


def adopt(client, project_id, session, uploaded, modality="ct", **extra):
    return client.post(f"/api/projects/{project_id}/scans", json={
        "session_id": session, "uploaded_filename": uploaded, "modality": modality, "original_name": "patient.nii.gz", **extra,
    })


def add_scan(env, seed, modality="ct", who="owner@stanford.edu", project=None, **vol):
    c = env["client"](who)
    sess, up = upload(c, volume_bytes(seed, **vol))
    r = adopt(c, project or env["ids"]["project"], sess, up, modality)
    assert r.status_code == 201, r.get_json()
    return r.get_json()


@pytest.fixture(autouse=True)
def fresh_project_data(env):
    """Every test starts with no scans, whatever the one before it stored."""
    import shutil
    from models.engine import session_scope
    from models.project_scan import ProjectScan
    with session_scope() as s:
        s.query(ProjectScan).delete()
    root = env["base"] / "projects"
    for entry in root.iterdir():
        shutil.rmtree(entry, ignore_errors=True)
    os.environ["PROJECT_DATASET_PATH"] = str(root)
    yield


# ---- uploading ---------------------------------------------------------------------------------------------------

def test_an_owner_uploads_a_scan_and_it_becomes_the_projects_first(env):
    c = env["client"]("owner@stanford.edu")
    content = volume_bytes(1)
    sess, up = upload(c, content)
    r = adopt(c, env["ids"]["project"], sess, up)
    assert r.status_code == 201
    scan = r.get_json()
    code = env["ids"]["project"][:8]
    assert scan["number"] == 1 and scan["case_id"] == f"PRJ_{code}_00000001" and scan["modality"] == "ct"
    assert scan["shape"] == [16, 18, 20] and scan["spacing"] == [1.5, 1.5, 2.0]
    folder = env["base"] / "projects" / env["ids"]["project"] / "image_only" / scan["case_id"]
    assert (folder / "ct.nii.gz").read_bytes() == content
    import json
    meta = json.loads((folder / "metadata.json").read_text())
    assert meta["modality"] == "ct" and meta["original_name"] == "patient.nii.gz" and meta["number"] == 1
    # the staged upload is cleaned up
    assert not (env["base"] / "sessions" / "inference" / sess).exists()


def test_scans_are_numbered_in_the_order_they_are_stored(env):
    for seed in (1, 2, 3):
        add_scan(env, seed)
    c = env["client"]("owner@stanford.edu")
    listed = c.get(f"/api/projects/{env['ids']['project']}/scans").get_json()
    assert [s["number"] for s in listed["scans"]] == [1, 2, 3] and listed["configured"] is True


def test_the_same_file_twice_is_refused_with_the_number_it_already_has(env):
    first = add_scan(env, 7)
    c = env["client"]("owner@stanford.edu")
    sess, up = upload(c, volume_bytes(7))
    r = adopt(c, env["ids"]["project"], sess, up)
    assert r.status_code == 409 and r.get_json()["reason"] == "duplicate" and r.get_json()["number"] == first["number"]
    assert len(c.get(f"/api/projects/{env['ids']['project']}/scans").get_json()["scans"]) == 1
    assert not (env["base"] / "sessions" / "inference" / sess).exists()


def test_the_same_file_may_be_in_two_projects(env):
    add_scan(env, 8)
    other = add_scan(env, 8, who="owner@mit.edu", project=env["ids"]["other"])
    assert other["number"] == 1 and other["case_id"].startswith(f"PRJ_{env['ids']['other'][:8]}_")


def test_an_uncompressed_nifti_is_kept_compressed(env):
    c = env["client"]("owner@stanford.edu")
    raw = volume_bytes(4, compressed=False)
    sess, up = upload(c, raw, name="scan.nii")
    r = adopt(c, env["ids"]["project"], sess, up)
    assert r.status_code == 201
    path = env["data"].ct_path(r.get_json()["case_id"])
    assert path.endswith("ct.nii.gz") and gzip.decompress(open(path, "rb").read()) == raw


def test_an_mri_is_kept_as_an_mri(env):
    scan = add_scan(env, 5, modality="mri", dtype=np.float32)
    assert scan["modality"] == "mri"


@pytest.mark.parametrize("modality", [None, "", "pet", "CT", 3, ["ct"]])
def test_the_modality_must_be_ct_or_mri(env, modality):
    c = env["client"]("owner@stanford.edu")
    sess, up = upload(c, volume_bytes(6))
    r = c.post(f"/api/projects/{env['ids']['project']}/scans", json={"session_id": sess, "uploaded_filename": up, "modality": modality})
    assert r.status_code == 400 and r.get_json()["reason"] == "bad_modality"


@pytest.mark.parametrize("what, content, reason", [
    ("random bytes", os.urandom(4096), "not_a_volume"),
    ("text", b"not a scan at all " * 200, "not_a_volume"),
    ("a flat image", None, "not_a_volume"),
    ("a tiny file", b"x" * 10, "too_small"),
    ("a cut-off file", "cut", "truncated"),
])
def test_a_file_that_is_not_a_usable_volume_is_refused_and_not_kept(env, what, content, reason):
    if what == "a flat image":
        content = volume_bytes(1, shape=(64, 64, 1))
    if content == "cut":
        whole = volume_bytes(9, shape=(40, 40, 40), dtype=np.float32)
        content = whole[: len(whole) // 2]
    c = env["client"]("owner@stanford.edu")
    sess, up = upload(c, content)
    r = adopt(c, env["ids"]["project"], sess, up)
    assert r.status_code == 400 and r.get_json()["reason"] == reason, r.get_json()
    assert c.get(f"/api/projects/{env['ids']['project']}/scans").get_json()["scans"] == []


def test_a_file_over_the_size_limit_is_refused(env, monkeypatch):
    monkeypatch.setattr(env["data"], "MAX_BYTES", 2048)
    c = env["client"]("owner@stanford.edu")
    sess, up = upload(c, volume_bytes(1, shape=(32, 32, 32)))
    r = adopt(c, env["ids"]["project"], sess, up)
    assert r.status_code == 413 and r.get_json()["reason"] == "too_large"


def test_nothing_is_stored_when_the_disk_is_short_of_room(env, monkeypatch):
    monkeypatch.setattr(env["data"], "MIN_FREE_BYTES", 10 ** 18)
    c = env["client"]("owner@stanford.edu")
    sess, up = upload(c, volume_bytes(1))
    r = adopt(c, env["ids"]["project"], sess, up)
    assert r.status_code == 503 and r.get_json()["reason"] == "no_room"
    assert c.get(f"/api/projects/{env['ids']['project']}/scans").get_json()["scans"] == []


def test_a_project_stops_at_its_scan_limit(env, monkeypatch):
    add_scan(env, 1)
    monkeypatch.setattr(env["data"], "MAX_SCANS", 1)
    c = env["client"]("owner@stanford.edu")
    sess, up = upload(c, volume_bytes(2))
    r = adopt(c, env["ids"]["project"], sess, up)
    assert r.status_code == 400 and r.get_json()["reason"] == "project_full"


def test_uploads_say_so_when_the_server_has_no_dataset_folder(env, monkeypatch):
    c = env["client"]("owner@stanford.edu")
    sess, up = upload(c, volume_bytes(1))
    monkeypatch.delenv("PROJECT_DATASET_PATH")
    r = adopt(c, env["ids"]["project"], sess, up)
    assert r.status_code == 503 and r.get_json()["reason"] == "not_configured"
    assert c.get(f"/api/projects/{env['ids']['project']}/scans").get_json()["configured"] is False


@pytest.mark.parametrize("who", ["collab@stanford.edu", "stranger@x.org", "owner@mit.edu", "admin@x.org", "manager@jhu.edu"])
def test_only_an_owner_of_the_project_can_add_or_list_or_delete_its_scans(env, who):
    mine = add_scan(env, 3)
    c = env["client"](who)
    sess, up = upload(c, volume_bytes(11))
    assert adopt(c, env["ids"]["project"], sess, up).status_code == 403
    assert c.get(f"/api/projects/{env['ids']['project']}/scans").status_code == 403
    assert c.delete(f"/api/projects/{env['ids']['project']}/scans/{mine['number']}").status_code == 403
    assert len(env["client"]("owner@stanford.edu").get(f"/api/projects/{env['ids']['project']}/scans").get_json()["scans"]) == 1


def test_nothing_is_added_to_the_shared_library_from_here(env):
    c = env["client"]("manager@jhu.edu")
    sess, up = upload(c, volume_bytes(1))
    r = adopt(c, "jhu", sess, up)
    assert r.status_code == 403 and r.get_json()["reason"] == "library_project"


def test_an_upload_belongs_to_the_account_that_made_it(env):
    sess, up = upload(env["client"]("owner@mit.edu"), volume_bytes(12))
    r = adopt(env["client"]("owner@stanford.edu"), env["ids"]["project"], sess, up)
    assert r.status_code == 404 and r.get_json()["reason"] == "no_such_upload"


@pytest.mark.parametrize("uploaded", ["../../etc/passwd", "/etc/passwd", "nope/ct.nii.gz", "", "..", "x/../../y"])
def test_an_upload_that_is_not_there_is_not_found(env, uploaded):
    c = env["client"]("owner@stanford.edu")
    sess, _ = upload(c, volume_bytes(13))
    r = adopt(c, env["ids"]["project"], sess, uploaded)
    assert r.status_code == 404 and r.get_json()["reason"] == "no_such_upload"


@pytest.mark.parametrize("body", [{}, {"session_id": 5, "uploaded_filename": "x"}, {"session_id": "a", "uploaded_filename": None}])
def test_a_malformed_request_is_refused(env, body):
    c = env["client"]("owner@stanford.edu")
    r = c.post(f"/api/projects/{env['ids']['project']}/scans", json={**body, "modality": "ct"})
    assert r.status_code == 404 and r.get_json()["reason"] == "no_such_upload"


def test_several_uploads_at_once_get_distinct_numbers(env):
    contents = [volume_bytes(100 + i) for i in range(6)]
    staged = []
    c0 = env["client"]("owner@stanford.edu")
    for content in contents:
        staged.append(upload(c0, content))
    results = []

    def go(sess, up):
        results.append(adopt(env["client"]("owner@stanford.edu"), env["ids"]["project"], sess, up))

    threads = [threading.Thread(target=go, args=s) for s in staged]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(r.status_code for r in results) == [201] * 6
    assert sorted(r.get_json()["number"] for r in results) == [1, 2, 3, 4, 5, 6]


def test_deleting_a_scan_removes_it_and_its_file_and_keeps_the_others_numbers(env):
    a, b, c = (add_scan(env, s) for s in (21, 22, 23))
    owner = env["client"]("owner@stanford.edu")
    path = env["data"].ct_path(b["case_id"])
    assert path
    assert owner.delete(f"/api/projects/{env['ids']['project']}/scans/{b['number']}").status_code == 200
    assert not os.path.exists(path)
    assert [s["number"] for s in owner.get(f"/api/projects/{env['ids']['project']}/scans").get_json()["scans"]] == [1, 3]
    assert owner.delete(f"/api/projects/{env['ids']['project']}/scans/{b['number']}").status_code == 404
    # the file removed may be uploaded again
    assert add_scan(env, 22)["modality"] == "ct"



@pytest.mark.skipif(os.name == "nt", reason="file modes are a POSIX matter")
def test_a_stored_scan_is_readable_by_the_sites_own_account_only(env):
    old = os.umask(0o002)          # a group-friendly umask, as on the server: the scan must not follow it
    try:
        scan = add_scan(env, 51)
    finally:
        os.umask(old)
    file = env["data"].ct_path(scan["case_id"])
    case_dir = os.path.dirname(file)
    for path in (file, os.path.join(case_dir, "metadata.json"), case_dir, os.path.dirname(case_dir), os.path.dirname(os.path.dirname(case_dir))):
        assert os.stat(path).st_mode & 0o077 == 0, (path, oct(os.stat(path).st_mode))


# ---- opening a scan in the viewer ----------------------------------------------------------------------------------

def test_the_projects_own_people_open_its_scan(env):
    scan = add_scan(env, 31)
    stored = env["data"].ct_path(scan["case_id"])
    for who in ("owner@stanford.edu", "collab@stanford.edu"):
        r = env["client"](who).get(f"/api/get-main-nifti/{scan['case_id']}.nii.gz")
        assert r.status_code == 200, who
        assert r.get_data() == open(stored, "rb").read()
        cache = r.headers["Cache-Control"]
        assert "private" in cache and "public" not in cache and "immutable" not in cache


@pytest.mark.parametrize("who", ["stranger@x.org", "owner@mit.edu", "annotator@jhu.edu", "manager@jhu.edu", "admin@x.org"])
def test_nobody_outside_the_project_can_tell_the_scan_exists(env, who):
    scan = add_scan(env, 32)
    c = env["client"](who)
    cid = scan["case_id"]
    missing = c.get(f"/api/get-main-nifti/PRJ_{env['ids']['project'][:8]}_00000099.nii.gz")
    for url in (
        f"/api/get-main-nifti/{cid}.nii.gz", f"/api/get-main-nifti/{cid.lower()}.nii.gz", f"/api/get-main-nifti/{cid}.nii.gz?res=low",
        f"/api/get-segmentations/{cid}.nii.gz", f"/api/get_image_preview/{cid}", f"/api/cases/{cid}/mesh-manifest",
        f"/api/get-report-data/{cid}", f"/api/segmentation-metadata/{cid}", f"/api/cases/{cid}/organ-stats",
    ):
        r = c.get(url)
        assert r.status_code == 404 and r.get_json() == {"error": "Not found"}, (who, url, r.status_code)
    assert missing.status_code == 404 and missing.get_json() == {"error": "Not found"}


def test_a_signed_out_request_for_a_project_scan_is_refused(env):
    scan = add_scan(env, 33)
    r = env["app"].test_client().get(f"/api/get-main-nifti/{scan['case_id']}.nii.gz")
    assert r.status_code == 401


def test_a_scan_with_no_file_on_disk_is_a_clean_404_for_its_own_people(env):
    scan = add_scan(env, 34)
    os.remove(env["data"].ct_path(scan["case_id"]))
    r = env["client"]("owner@stanford.edu").get(f"/api/get-main-nifti/{scan['case_id']}.nii.gz")
    assert r.status_code == 404 and r.get_json() == {"error": "Could not find filepath"}


def test_a_project_scan_opens_without_a_mask_or_a_thumbnail(env):
    scan = add_scan(env, 35)
    c = env["client"]("collab@stanford.edu")
    seg = c.get(f"/api/get-segmentations/{scan['case_id']}.nii.gz")
    assert seg.status_code == 200 and seg.get_json() == {"masks_available": False}
    assert c.get(f"/api/get_image_preview/{scan['case_id']}").status_code == 404


def test_removing_someone_from_the_project_closes_its_scans_to_them(env):
    scan = add_scan(env, 36)
    url = f"/api/get-main-nifti/{scan['case_id']}.nii.gz"
    assert env["client"]("collab@stanford.edu").get(url).status_code == 200
    env["store"].remove_member(env["ids"]["project"], env["ids"]["collab"], acting_user_id=env["ids"]["owner"], acting_is_admin=False)
    try:
        assert env["client"]("collab@stanford.edu").get(url).status_code == 404
    finally:
        env["store"].add_member(env["ids"]["project"], env["ids"]["collab"], "collaborator",
                                acting_user_id=env["ids"]["owner"], acting_is_admin=False)


def test_the_shared_librarys_ids_are_untouched(env):
    # a numeric PanTS id and a CV id still go to their own code, and never to the project check
    c = env["client"]("stranger@x.org")
    assert c.get("/api/get-main-nifti/CV_00000001.nii.gz").status_code != 401
    assert c.get("/api/get-main-nifti/17.nii.gz").get_json() != {"error": "Not found"}


# ---- training -------------------------------------------------------------------------------------------------------

def test_only_projects_that_allow_training_are_listed_for_it(env):
    a = add_scan(env, 41)
    b = add_scan(env, 42, who="owner@mit.edu", project=env["ids"]["other"])
    assert env["data"].training_manifest() == []
    admin = env["client"]("admin@x.org")
    assert admin.patch(f"/api/projects/{env['ids']['project']}", json={"allow_training": True}).status_code == 200
    try:
        manifest = env["data"].training_manifest()
        assert [(m["project"], m["case_id"], m["modality"]) for m in manifest] == [("Stanford Lab", a["case_id"], "ct")]
        assert manifest[0]["file"] == env["data"].ct_path(a["case_id"])
        assert b["case_id"] not in [m["case_id"] for m in manifest]
    finally:
        admin.patch(f"/api/projects/{env['ids']['project']}", json={"allow_training": False})
    assert env["data"].training_manifest() == []
