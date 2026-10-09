"""CancerVerse -> PanTS-schema normalization, tumor types and path resolution."""
import numpy as np
import pandas as pd
import pytest

from services import cancerverse_catalog as cv


def raw_frame():
    return pd.DataFrame({
        "CancerVerse ID": ["CV_00000001", "CV_00000002", "CV_00000003", "CV_00000004", "CV_00000005"],
        "Patient ID": ["P1", "P1", "P2", "P3", ""],
        "sex": ["M", "M", "F", "", "F"],
        "age": ["85", "86", "above 89", "", "40"],
        "phase": ["portal_venous", "non-contrast", "arterial_late", "", "venous"],
        "exam_date": ["07-30-2022", "08-01-2022", "", "01-02-2019", "03-04-2020"],
        "scanner": ["Siemens", "", "", "", "Philips"],
        "icd10_code": ["C22.0", "", "", "", ""],
        "report": ["secret text"] * 5,
        "Encrypted Accession Number": ["A"] * 5,
    })


def index():
    return {
        "CV_00000001": {"tumors": {"liver": 12.5, "kidney": 0.4}, "shape": [512, 512, 120], "spacing": [0.78, 0.78, 1.25]},
        "CV_00000002": {"tumors": {}},          # P1's other scan: no tumor annotated on it
        "CV_00000003": {"tumors": {}},          # P2: no tumor on any of its scans
        "CV_00000004": {"tumors": {}},
        # CV_00000005 is not indexed at all
    }


@pytest.mark.parametrize("raw,expected", [
    ("portal_venous", "Venous"), ("venous", "Venous"), ("arterial", "Arterial"),
    ("arterial_early", "Arterial"), ("arterial_late", "Arterial"), ("non-contrast", "Non-contrast"),
    ("Non-Contrast", "Non-contrast"), ("delayed", "Delay"), ("", ""), (None, ""), (float("nan"), ""),
    ("unknown", ""), ("mystery_phase", "Mystery Phase"),
])
def test_canonical_phase(raw, expected):
    assert cv.canonical_phase(raw) == expected


@pytest.mark.parametrize("raw,expected", [("85", 85.0), ("above 89", 90.0), ("", None), (None, None), ("x", None)])
def test_parse_age(raw, expected):
    got = cv.parse_age(raw)
    assert (np.isnan(got) if expected is None else got == expected)


def test_normalized_columns_use_pants_vocabulary_and_drop_private_fields():
    out = cv.normalize_metadata(raw_frame(), index())
    assert list(out["ct phase"]) == ["Venous", "Non-contrast", "Arterial", "", "Venous"]
    assert list(out["study year"].fillna(0).astype(int)) == [2022, 2022, 0, 2019, 2020]
    assert out["age"].iloc[2] == 90.0
    assert out["manufacturer"].iloc[0] == "Siemens"
    assert (out["dataset"] == "CancerVerse").all()
    for private in ("Patient ID", "report", "Encrypted Accession Number"):
        assert private not in out.columns


def test_tumor_status_comes_from_masks_and_never_calls_an_unannotated_scan_healthy():
    out = cv.normalize_metadata(raw_frame(), index())
    status = dict(zip(out["CancerVerse ID"], out["tumor?"]))
    assert status["CV_00000001"] == 1.0                      # annotated lesions
    assert status["CV_00000003"] == 0.0                      # indexed, patient has no tumor anywhere
    assert status["CV_00000004"] == 0.0
    assert np.isnan(status["CV_00000002"])                   # same patient as a tumor scan: unknown
    assert np.isnan(status["CV_00000005"])                   # not indexed: unknown
    types = dict(zip(out["CancerVerse ID"], out["tumor type"]))
    assert types["CV_00000001"] == "liver;kidney"            # largest volume first
    assert types["CV_00000003"] == ""


def test_without_an_index_tumor_status_is_unknown_not_none():
    out = cv.normalize_metadata(raw_frame(), None)
    assert out["tumor?"].isna().all()
    assert (out["tumor type"] == "").all()


def test_shape_and_spacing_use_the_pants_string_format():
    out = cv.normalize_metadata(raw_frame(), index())
    assert out["shape"].iloc[0] == "(512, 512, 120)"
    assert out["spacing"].iloc[0] == "(0.78, 0.78, 1.25)"
    assert out["shape"].iloc[1] == ""


def test_a_scan_without_patient_id_is_its_own_patient():
    raw = raw_frame().iloc[[4]].copy()
    out = cv.normalize_metadata(raw, {"CV_00000005": {"tumors": {}}})
    assert out["tumor?"].iloc[0] == 0.0


def test_tumor_type_helpers():
    assert cv.split_tumor_types("liver; kidney;;") == ("liver", "kidney")
    assert cv.split_tumor_types(None) == () and cv.split_tumor_types(float("nan")) == ()
    assert cv.tumor_type_label("adrenal gland") == "Adrenal gland"
    assert cv.tumor_types_for_case({"tumors": {"a": 0, "liver": 3, "colon": 5}}) == ("colon", "liver")   # {organ: mL}
    assert cv.tumor_types_for_case({"tumors": ["liver", "kidney", "liver"]}) == ("liver", "kidney")    # ordered list
    assert cv.tumor_types_for_case({"tumors": []}) == () and cv.tumor_types_for_case(None) == ()


def test_load_case_index_tolerates_missing_and_broken_files(tmp_path):
    assert cv.load_case_index(None) is None
    assert cv.load_case_index(str(tmp_path / "nope.json")) is None
    bad = tmp_path / "bad.json"
    bad.write_text("{not json")
    assert cv.load_case_index(str(bad)) is None
    good = tmp_path / "good.json"
    good.write_text('{"version": 1, "cases": {"CV_00000001": {"tumors": {}}}}')
    assert cv.load_case_index(str(good)) == {"CV_00000001": {"tumors": {}}}


def _touch(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"x")
    return str(path)


def test_ct_resolution_prefers_overlay_then_either_dataset_layout(tmp_path):
    root, overlay = tmp_path / "CancerVerse", tmp_path / "overlay"
    flat = _touch(root / "CV_00000001" / "ct.nii.gz")
    nested = _touch(root / "image_only" / "CV_00000002" / "ct.nii.gz")
    updated = _touch(overlay / "image_only" / "CV_00000002" / "ct.nii.gz")
    assert cv.resolve_ct_path("CV_00000001", str(root), str(overlay)) == flat
    assert cv.resolve_ct_path("CV_00000002", str(root), None) == nested
    assert cv.resolve_ct_path("CV_00000002", str(root), str(overlay)) == updated   # newer scan wins
    missing = cv.resolve_ct_path("CV_00000009", str(root), str(overlay))
    assert missing.endswith("image_only/CV_00000009/ct.nii.gz") or missing.endswith("image_only\\CV_00000009\\ct.nii.gz")
    assert cv.resolve_ct_path("CV_00000009", None, None) == ""


def test_metadata_and_index_resolution_order(tmp_path):
    root, overlay = tmp_path / "data" / "CancerVerse", tmp_path / "overlay"
    root.mkdir(parents=True)
    beside = _touch(tmp_path / "data" / cv.METADATA_CSV)
    assert cv.resolve_metadata_file(None, None, str(root)) == beside
    new_csv = _touch(overlay / cv.METADATA_CSV)
    assert cv.resolve_metadata_file(None, str(overlay), str(root)) == new_csv      # overlay beats legacy
    explicit = _touch(tmp_path / "explicit.csv")
    assert cv.resolve_metadata_file(explicit, str(overlay), str(root)) == explicit
    assert cv.resolve_metadata_file(None, None, None) is None
    idx = _touch(overlay / cv.INDEX_JSON)
    assert cv.resolve_index_file(None, str(overlay)) == idx
    assert cv.resolve_index_file(None, None) is None
