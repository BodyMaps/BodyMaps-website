"""Synthetic report regressions; never import the GPU/data-loading API module."""
from __future__ import annotations

import ast
import importlib.util
import os
import re
import tempfile
import uuid
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace

import pytest

SERVER = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("report_evidence", SERVER / "services/report_evidence.py")
evidence = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(evidence)

SYNTHETIC = """Synthetic source - not patient data.
FINDINGS:
Pleura:
Synthetic loculated left pleural effusion.
Pancreas:
No mass. Not enlarged. No pancreatic lesion.
Nodes:
Synthetic bulky inguinal nodes.
IMPRESSION:
1. Synthetic pleural and nodal findings require review.
2. This fixture is not a diagnosis.
""".strip()


def api_functions(*names, **namespace):
    tree = ast.parse((SERVER / "api/api_blueprint.py").read_text(encoding="utf-8"))
    selected = []
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name in names:
            node.decorator_list = []
            selected.append(node)
    assert len(selected) == len(names)
    exec(compile(ast.Module(body=selected, type_ignores=[]), "isolated_report_api", "exec"), namespace)
    return namespace


@pytest.mark.parametrize("raw", ["", "FINDINGS:\nPancreas:\nNo mass. Not enlarged.", "FINDINGS:\nPancreas enlarged."])
@pytest.mark.parametrize("hu,volume", [(60, 85), (900, 9000), (-900, 0)])
def test_measurements_and_keywords_never_establish_clinical_status(raw, hu, volume):
    data = evidence.report_payload("7", raw, organ_volumes={
        "pancreas": {"mean_hu": hu, "volume": volume, "status": "normal"},
        "lung_left": {"mean_hu": -600, "volume": 100, "status": "check"},
    })
    assert {value["status"] for value in data["organ_volumes"].values()} == {"not_assessed"}
    assert data["source_report"]["text"] == raw
    assert data["coverage"]["status"] == "limited"
    assert data["coverage"]["measured_structures"] == 2
    assert data["provenance"]["image_review_performed"] is False
    assert data["report_schema_version"] == "2"


def test_full_source_survives_missing_masks_unrecognized_sections_and_lesion_formats():
    raw = SYNTHETIC + "\nPancreas lesions:\nUnstructured source text that old regex discarded."
    data = evidence.report_payload("7", raw)
    assert data["masks_available"] is False
    assert data["source_report"]["text"] == raw
    assert "bulky inguinal nodes" in data["comments"]
    assert "require review" in data["impression"][0]
    assert data["lesions"] == {}
    assert "not assessed" in " ".join(data["coverage"]["limitations"])


def test_case_insensitive_sections_preserve_decimals_numbering_and_preamble():
    raw = "Preamble_x000D_Findings:\r\nSynthetic 1.5 cm finding.\rImpression:\n1. Review 1.5 cm finding."
    parsed = evidence.source_report(raw)
    assert parsed["text"].startswith("Preamble\nFindings:")
    assert parsed["findings"] == "Synthetic 1.5 cm finding."
    assert parsed["impression"] == ["1. Review 1.5 cm finding."]
    assert evidence.source_report("unstructured source")["findings"] == "unstructured source"


def test_html_preserves_full_source_escapes_markup_and_never_reassures():
    data = evidence.report_payload("7", SYNTHETIC + "\n<script>alert('x')</script>",
                                   organ_volumes={"pancreas": {"volume": 95, "mean_hu": 60}})
    html = evidence.render_report_html(data, api_prefix="/mounted/api")
    assert "Synthetic loculated left pleural effusion." in html
    assert "Synthetic bulky inguinal nodes." in html
    assert "No mass. Not enlarged." in html
    assert "&lt;script&gt;" in html and "<script>" not in html
    assert "Clinical assessment" in html and "Not assessed" in html
    assert '/mounted/api/generate-report-pdf/7' in html
    for unsupported in ("Everything else looked normal", "All clear", "Organs reviewed", "None detected", "Your scan found"):
        assert unsupported not in html


def test_missing_source_is_explicit_and_legacy_text_is_preserved():
    data = evidence.report_payload("7", "")
    html = evidence.render_report_html(data)
    assert "No stored source report is available" in html
    assert "Segmentation measurements unavailable" in html
    assert evidence.source_text({"comments": "Pleura: source.", "impression": ["Nodes: source."]}) == (
        "Pleura: source.\n\nIMPRESSION:\nNodes: source."
    )


def test_source_loader_prefers_structured_report_and_observes_workbook_changes(tmp_path):
    import openpyxl

    path = tmp_path / "synthetic.xlsx"
    def write(text):
        workbook = openpyxl.Workbook()
        sheet = workbook.active
        sheet.title = "PanTS_metadata"
        sheet.append(["PanTS ID", "Fusion report", "Structured Report", "age", "sex", "ct phase", "study type"])
        sheet.append(["synthetic-7", "Wrong derived source", text, 40, "F", "portal", "synthetic"])
        workbook.save(path)
        workbook.close()
    functions = api_functions("_load_report_source", "_norm_colname", _metadata_xlsx_path=lambda: str(path))
    write(SYNTHETIC)
    first = functions["_load_report_source"]("synthetic-7")
    assert first[0] == SYNTHETIC
    assert first[3] == "Structured Report"
    assert first[1] == {"age": 40, "sex": "F"}
    assert first[2] == {"study_type": "synthetic", "contrast": "portal"}
    write("Updated synthetic source")
    assert functions["_load_report_source"]("synthetic-7")[0] == "Updated synthetic source"
    write("")
    fallback = functions["_load_report_source"]("synthetic-7")
    assert fallback[0] == "Wrong derived source"
    assert fallback[3] == "Fusion report"


def test_builder_retains_source_when_measurements_fail_and_does_not_log_text(capsys):
    def fail(_):
        raise ValueError("synthetic geometry unavailable")
    functions = api_functions("_build_report_data", report_payload=evidence.report_payload,
                              get_dataset_from_case_id=lambda _: "PanTS", secure_filename=str,
                              get_panTS_id=lambda _: "synthetic-7",
                              _load_report_source=lambda _: (SYNTHETIC, {}, {}, "Structured Report"),
                              _measure_report_structures=fail)
    data = functions["_build_report_data"]("7")
    assert data["source_report"]["text"] == SYNTHETIC
    assert data["masks_available"] is False
    assert "explicitly named masks" in " ".join(data["coverage"]["limitations"])
    assert capsys.readouterr().out == ""


def test_measurement_geometry_is_validated_instead_of_silently_cropped(tmp_path):
    import nibabel as nib
    import numpy as np

    image_dir = tmp_path / "image_only/synthetic-7"
    mask_dir = tmp_path / "mask_only/synthetic-7/segmentations"
    image_dir.mkdir(parents=True)
    mask_dir.mkdir(parents=True)
    ct = np.full((3, 3, 3), 900.0)
    mask = np.full((3, 3, 3), 19, dtype=np.uint8)
    nib.save(nib.Nifti1Image(ct, np.eye(4)), image_dir / "ct.nii.gz")
    nib.save(nib.Nifti1Image(mask, np.eye(4)), mask_dir / "pancreas.nii.gz")
    constants = SimpleNamespace(PANTS_PATH=str(tmp_path), MAIN_NIFTI_FILENAME="ct.nii.gz",
                                COMBINED_LABELS_NIFTI_FILENAME="combined_labels.nii.gz",
                                PREDEFINED_LABELS={0: "background", 19: "pancreas"})
    functions = api_functions("_measure_report_structures", Constants=constants, nib=nib, np=np,
                              os=os, tempfile=tempfile, Path=Path, re=re, get_panTS_id=lambda _: "synthetic-7")
    measure = functions["_measure_report_structures"]
    organs, lesions, imaging = measure("7")
    assert organs["pancreas"]["status"] == "not_assessed"
    assert organs["pancreas"]["mean_hu"] == 900
    assert organs["pancreas"]["mask_source"] == "segmentations/pancreas.nii.gz"
    assert lesions == {}
    assert imaging["shape"] == [3, 3, 3]
    bad_affine = np.eye(4)
    bad_affine[0, 3] = 10
    nib.save(nib.Nifti1Image(mask, bad_affine), mask_dir / "pancreas.nii.gz")
    with pytest.raises(ValueError, match="geometry"):
        measure("7")
    nib.save(nib.Nifti1Image(mask[:2], np.eye(4)), mask_dir / "pancreas.nii.gz")
    with pytest.raises(ValueError, match="geometry"):
        measure("7")


def test_pdf_preserves_long_source_nonorgan_findings_and_final_impression(tmp_path, monkeypatch):
    from reportlab.pdfgen import canvas
    from PyPDF2 import PdfReader

    template = tmp_path / "blank-template.pdf"
    pdf = canvas.Canvas(str(template))
    pdf.showPage()
    pdf.save()
    monkeypatch.setenv("TEMPLATE_PATH", str(template))
    raw = SYNTHETIC + "\n" + "\n".join(f"Synthetic retained line {i}." for i in range(150)) + "\nFINAL SOURCE MARKER"
    data = evidence.report_payload("7", raw, organ_volumes={"pancreas": {"volume": 95, "mean_hu": 60}})
    functions = api_functions("_draw_report_pdf", os=os, source_text=evidence.source_text,
                              report_limitations=evidence.report_limitations,
                              measurement_display=evidence.measurement_display,
                              get_panTS_id=lambda _: "synthetic-7",
                              Constants=SimpleNamespace(PANTS_PATH=str(tmp_path), MAIN_NIFTI_FILENAME="ct.nii.gz",
                                                        COMBINED_LABELS_NIFTI_FILENAME="combined_labels.nii.gz"))
    output = tmp_path / "synthetic-report.pdf"
    functions["_draw_report_pdf"](data, str(tmp_path / "temp.pdf"), str(output))
    reader = PdfReader(str(output))
    assert len(reader.pages) >= 3
    text = "\n".join(page.extract_text() for page in reader.pages)
    for required in ("Synthetic loculated left pleural effusion.", "Synthetic bulky inguinal nodes.",
                     "No mass. Not enlarged.", "FINAL SOURCE MARKER", "Not assessed", "Scope and limitations"):
        assert required.lower() in text.lower()
    assert "Organs Reviewed" not in text
    assert "Everything else looked normal" not in text


@pytest.mark.parametrize("case_id,masks_available", [
    (None, True), ("", True), ("../7", True), (r"..\7", True),
    ("CV_00000007", True), ("CV_00000007", False), ("\u00b2", True), ("7", False),
])
def test_pdf_source_only_or_invalid_image_ids_never_construct_or_probe_image_paths(
    tmp_path, monkeypatch, case_id, masks_available,
):
    from reportlab.pdfgen import canvas
    from PyPDF2 import PdfReader

    template = tmp_path / "blank-template.pdf"
    pdf = canvas.Canvas(str(template))
    pdf.showPage()
    pdf.save()
    monkeypatch.setenv("TEMPLATE_PATH", str(template))

    def unexpected_image_access(*args):
        pytest.fail("A source-only or invalid case ID must not access dataset image paths")

    data = evidence.report_payload("unused", SYNTHETIC, measurements_available=masks_available)
    data["case_id"] = case_id
    functions = api_functions(
        "_draw_report_pdf",
        os=SimpleNamespace(getenv=os.getenv, path=SimpleNamespace(exists=unexpected_image_access)),
        source_text=evidence.source_text, report_limitations=evidence.report_limitations,
        measurement_display=evidence.measurement_display,
        get_panTS_id=unexpected_image_access,
        # Any attempt to construct a dataset path also fails before filesystem IO.
        Constants=SimpleNamespace(),
    )
    output = tmp_path / "source-only.pdf"
    functions["_draw_report_pdf"](data, str(tmp_path / "temp.pdf"), str(output))
    text = "\n".join(page.extract_text() for page in PdfReader(str(output)).pages)
    assert "Synthetic loculated left pleural effusion." in text
    assert "Synthetic bulky inguinal nodes." in text


@pytest.mark.parametrize("case_id", ["0007", 7])
def test_pdf_canonicalizes_numeric_case_id_before_constructing_image_paths(tmp_path, monkeypatch, case_id):
    from reportlab.pdfgen import canvas

    template = tmp_path / "blank-template.pdf"
    pdf = canvas.Canvas(str(template))
    pdf.showPage()
    pdf.save()
    monkeypatch.setenv("TEMPLATE_PATH", str(template))
    ids, paths = [], []

    def canonical_folder(value):
        assert type(value) is int
        ids.append(value)
        return f"PanTS_{value:08d}"

    def image_exists(path):
        paths.append(path)
        return False

    data = evidence.report_payload("unused", SYNTHETIC, measurements_available=True)
    data["case_id"] = case_id
    functions = api_functions(
        "_draw_report_pdf",
        os=SimpleNamespace(getenv=os.getenv, path=SimpleNamespace(exists=image_exists)),
        source_text=evidence.source_text, report_limitations=evidence.report_limitations,
        measurement_display=evidence.measurement_display, get_panTS_id=canonical_folder,
        Constants=SimpleNamespace(PANTS_PATH=str(tmp_path), MAIN_NIFTI_FILENAME="ct.nii.gz"),
    )
    functions["_draw_report_pdf"](data, str(tmp_path / "temp.pdf"), str(tmp_path / "numeric.pdf"))
    assert ids == [7]
    assert paths == [f"{tmp_path}/image_only/PanTS_00000007/ct.nii.gz"]


def test_json_disables_cache_and_legacy_pdf_uses_shared_builder():
    from flask import Flask, jsonify

    calls = []
    functions = api_functions("get_report_data", "get_report", jsonify=jsonify,
                              _build_report_data=lambda _: evidence.report_payload("7", SYNTHETIC),
                              generate_report_pdf=lambda case: calls.append(case) or "shared PDF")
    app = Flask(__name__)
    with app.test_request_context():
        response = functions["get_report_data"]("7")
        assert "no-store" in response.headers["Cache-Control"]
        assert response.get_json()["source_report"]["text"] == SYNTHETIC
        assert functions["get_report"]("0007") == "shared PDF"
    assert calls == ["7"]


def test_pdf_route_uses_unique_files_and_cleans_both_outputs(tmp_path):
    from flask import Flask, jsonify, send_file

    paths = []
    def draw(data, temporary, output):
        paths.append((temporary, output))
        Path(temporary).write_bytes(b"temporary")
        Path(output).write_bytes(b"synthetic-pdf")
    functions = api_functions("generate_report_pdf", os=os, uuid=uuid, BytesIO=BytesIO,
                              PDF_DIR=str(tmp_path), _is_safe_id=lambda _: True,
                              _resolve_case_id_or_token=lambda value: value,
                              _build_report_data=lambda _: evidence.report_payload("7", SYNTHETIC),
                              _draw_report_pdf=draw, send_file=send_file, jsonify=jsonify)
    app = Flask(__name__)
    with app.test_request_context():
        for _ in range(2):
            response = functions["generate_report_pdf"]("7")
            response.direct_passthrough = False
            assert response.get_data() == b"synthetic-pdf"
            assert "no-store" in response.headers["Cache-Control"]
    assert paths[0] != paths[1]
    assert not list(tmp_path.iterdir())


def test_combined_mask_without_named_structure_identity_is_not_measured(tmp_path):
    import nibabel as nib
    import numpy as np

    directory = tmp_path / "mask_only/synthetic-7"
    directory.mkdir(parents=True)
    # Numeric 19 has multiple incompatible meanings in existing label maps.
    nib.save(nib.Nifti1Image(np.full((2, 2, 2), 19, dtype=np.uint8), np.eye(4)),
             directory / "combined_labels.nii.gz")
    functions = api_functions("_measure_report_structures", os=os, Path=Path, re=re,
                              Constants=SimpleNamespace(PANTS_PATH=str(tmp_path), MAIN_NIFTI_FILENAME="ct.nii.gz"),
                              get_panTS_id=lambda _: "synthetic-7")
    with pytest.raises(ValueError, match="explicit structure mask names"):
        functions["_measure_report_structures"]("7")
