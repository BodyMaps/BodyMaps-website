"""Project scan ids, and the checks a file passes before it is kept."""
import gzip
import os

import nibabel as nib
import numpy as np
import pytest

from services import project_data as pd

PROJECT = "3924f4cb-1111-2222-3333-444455556666"


def test_a_scans_id_is_the_projects_code_and_its_number():
    assert pd.code_for(PROJECT) == "3924f4cb"
    assert pd.case_id_for(PROJECT, 1) == "PRJ_3924f4cb_00000001"
    assert pd.case_id_for(PROJECT, 12345678) == "PRJ_3924f4cb_12345678"


@pytest.mark.parametrize("text, expected", [
    ("PRJ_3924f4cb_00000007", "PRJ_3924f4cb_00000007"),
    ("prj_3924F4CB_00000007", "PRJ_3924f4cb_00000007"),
    ("  PRJ_3924f4cb_00000007 ", "PRJ_3924f4cb_00000007"),
    ("PRJ_3924f4cb_7", None), ("PRJ_3924f4c_00000007", None), ("PRJ_3924f4cbb_00000007", None),
    ("PRJ_zzzzzzzz_00000007", None), ("PRJ_3924f4cb_00000007x", None), ("CV_00000007", None), ("17", None), ("", None), (None, None), (7, None),
])
def test_only_a_well_formed_id_is_a_project_case(text, expected):
    assert pd.canonical(text) == expected


@pytest.mark.parametrize("text, expected", [
    ("PRJ_3924f4cb_00000007", True), ("prj_", True), ("PRJ_anything at all", True), (" PRJ_x", True),
    ("CV_00000001", False), ("BDMAP_00000001", False), ("PanTS_00000017", False), ("17", False), ("", False), (None, False), (5, False),
])
def test_anything_that_starts_like_a_project_id_is_treated_as_one(text, expected):
    assert pd.looks_like_project_case(text) is expected


def volume(path, shape=(16, 18, 20), zooms=(1.5, 1.5, 2.0), dtype=np.int16):
    image = nib.Nifti1Image(np.ones(shape, dtype=dtype), np.diag([*zooms, 1.0]))
    nib.save(image, str(path))
    return str(path)


def test_a_volumes_shape_and_spacing_are_read_from_its_header(tmp_path):
    assert pd._inspect(volume(tmp_path / "a.nii.gz")) == ([16, 18, 20], [1.5, 1.5, 2.0])
    # a trailing length-1 axis is not a dimension
    assert pd._inspect(volume(tmp_path / "b.nii.gz", shape=(16, 18, 20, 1)))[0] == [16, 18, 20]


@pytest.mark.parametrize("shape, zooms, reason", [
    ((16, 18), (1.0, 1.0), "not_a_volume"),
    ((64, 64, 1), (1.0, 1.0, 1.0), "not_a_volume"),
    ((4, 18, 20), (1.0, 1.0, 1.0), "bad_geometry"),
    ((5000, 18, 20), (1.0, 1.0, 1.0), "bad_geometry"),
])
def test_a_volume_of_a_wrong_shape_is_refused(tmp_path, shape, zooms, reason):
    path = tmp_path / "v.nii.gz"
    nib.save(nib.Nifti1Image(np.ones(shape, dtype=np.int16), np.diag([*zooms, 1.0][: len(shape)] + [1.0] * (4 - len(shape)))), str(path))
    with pytest.raises(pd.ProjectDataError) as e:
        pd._inspect(str(path))
    assert e.value.reason == reason


def test_a_file_that_is_not_nifti_is_refused(tmp_path):
    path = tmp_path / "x.nii.gz"
    path.write_bytes(os.urandom(5000))
    with pytest.raises(pd.ProjectDataError) as e:
        pd._inspect(str(path))
    assert e.value.reason == "not_a_volume"


def test_a_cut_off_gzip_is_caught_by_reading_it_through(tmp_path):
    good = volume(tmp_path / "g.nii.gz", shape=(40, 40, 40), dtype=np.float32)
    assert pd._decoded_size_ok(good, [40, 40, 40]) is True
    cut = tmp_path / "c.nii.gz"
    whole = open(good, "rb").read()
    cut.write_bytes(whole[: len(whole) // 2])
    assert pd._decoded_size_ok(str(cut), [40, 40, 40]) is False


def test_an_uncompressed_file_is_checked_for_its_length_too(tmp_path):
    raw = tmp_path / "r.nii"
    nib.save(nib.Nifti1Image(np.ones((20, 20, 20), dtype=np.float32), np.eye(4)), str(raw))
    assert pd._decoded_size_ok(str(raw), [20, 20, 20]) is True
    short = tmp_path / "s.nii"
    short.write_bytes(raw.read_bytes()[:3000])
    assert pd._decoded_size_ok(str(short), [20, 20, 20]) is False


def test_a_file_is_stored_compressed_once(tmp_path):
    raw = tmp_path / "r.nii"
    nib.save(nib.Nifti1Image(np.ones((20, 20, 20), dtype=np.float32), np.eye(4)), str(raw))
    out = tmp_path / "o.nii.gz"
    pd._gzip_copy(str(raw), str(out))
    assert gzip.decompress(out.read_bytes()) == raw.read_bytes()
    again = tmp_path / "o2.nii.gz"
    pd._gzip_copy(str(out), str(again))
    assert again.read_bytes() == out.read_bytes(), "an already compressed file is copied, not compressed again"


def test_the_hash_is_of_the_file(tmp_path):
    import hashlib
    p = tmp_path / "f"
    p.write_bytes(b"abc" * 10)
    assert pd._sha256(str(p)) == hashlib.sha256(b"abc" * 10).hexdigest()


def test_the_dataset_folder_must_exist(tmp_path, monkeypatch):
    monkeypatch.delenv("PROJECT_DATASET_PATH", raising=False)
    assert pd.root() is None
    monkeypatch.setenv("PROJECT_DATASET_PATH", str(tmp_path / "missing"))
    assert pd.root() is None
    monkeypatch.setenv("PROJECT_DATASET_PATH", str(tmp_path))
    assert pd.root() == str(tmp_path)
