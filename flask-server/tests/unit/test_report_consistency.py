"""Synthetic consistency regressions; no patient data, masks or API imports."""
from __future__ import annotations

import importlib.util
import re
from pathlib import Path

import pytest

SERVER = Path(__file__).resolve().parents[2]


def load(name):
    spec = importlib.util.spec_from_file_location(name, SERVER / f"services/{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


consistency = load("report_consistency")
evidence = load("report_evidence")

SYNTHETIC_FINDINGS = """Synthetic source - not patient data.
Spleen:
Synthetic size wording (volume: 100.0 cc).
Mean HU value: 40.0 +/- 10.0.

Liver:
Synthetic size wording (volume: 1000.0 cc).

Pancreas:
Synthetic size wording (volume: 50.0 cc).

Kidney:
Synthetic (right kidney volume: 150.0 cc; left kidney volume: 160.0 cc; total kidney volume: 310.0 cc).

Stomach:
Synthetic wording mentioning a volume: 999.0 cc that belongs to no checked structure.
"""


def organs(**volumes):
    return {name: {"volume": value, "mean_hu": 40.0} for name, value in volumes.items()}


def checks_of(result, kind):
    return [check for check in result["checks"] if check["kind"] == kind]


def test_reads_only_volumes_stated_in_each_structure_section():
    stated = consistency.source_stated_volumes(SYNTHETIC_FINDINGS)
    assert stated == {"spleen": 100.0, "liver": 1000.0, "pancreas": 50.0,
                      "kidney_right": 150.0, "kidney_left": 160.0}


def test_plural_section_heading_and_missing_text_are_handled():
    assert consistency.source_stated_volumes("Kidneys:\nright kidney volume: 12.5 cc") == {"kidney_right": 12.5}
    assert consistency.source_stated_volumes("") == {}
    assert consistency.source_stated_volumes(None) == {}
    # A volume outside any structure heading is never attributed.
    assert consistency.source_stated_volumes("Spleen volume: 100 cc") == {}


def test_source_volume_discrepancy_is_flagged_without_choosing_a_source():
    result = consistency.report_consistency(organs(spleen=440.0, liver=1020.0), SYNTHETIC_FINDINGS)
    by_structure = {check["structures"][0]: check for check in checks_of(result, "source_volume")}
    assert by_structure["spleen"]["status"] == "discrepancy"
    assert by_structure["spleen"]["difference_percent"] == 340.0
    assert by_structure["liver"]["status"] == "consistent"
    # Structures without a measurement are not compared.
    assert "pancreas" not in by_structure
    assert result["discrepancy_count"] == 1


def test_whole_structure_missing_while_parts_are_measured():
    result = consistency.report_consistency(organs(pancreas_head=56.0, pancreas_body=28.0, pancreas_tail=29.0))
    [check] = checks_of(result, "parts_whole")
    assert check["status"] == "discrepancy"
    assert check["whole_volume"] is None and check["parts_volume"] == 113.0
    assert "No pancreas measurement is available" in check["message"]


@pytest.mark.parametrize("whole, status", [(75.5, "consistent"), (60.0, "discrepancy")])
def test_whole_structure_compared_with_sum_of_parts(whole, status):
    result = consistency.report_consistency(
        organs(pancreas=whole, pancreas_head=46.7, pancreas_body=14.5, pancreas_tail=14.3))
    [check] = checks_of(result, "parts_whole")
    assert check["status"] == status


def test_parts_check_needs_every_part():
    result = consistency.report_consistency(organs(pancreas_head=56.0, pancreas_body=28.0))
    assert checks_of(result, "parts_whole") == []


@pytest.mark.parametrize("sex, expected", [
    ("F", "discrepancy"), ("female", "discrepancy"), ("M", "consistent"), ("N/A", None), (None, None),
])
def test_sex_specific_structure_compared_with_recorded_sex(sex, expected):
    result = consistency.report_consistency(organs(prostate=144.5), patient={"sex": sex})
    found = checks_of(result, "recorded_sex")
    assert [check["status"] for check in found] == ([expected] if expected else [])


def test_specks_do_not_count_as_a_present_structure():
    result = consistency.report_consistency(organs(prostate=0.4), patient={"sex": "F"})
    assert checks_of(result, "recorded_sex") == []


def test_messages_make_no_clinical_claims_and_use_no_em_dashes():
    result = consistency.report_consistency(
        organs(spleen=440.0, liver=1000.0, prostate=144.5,
               pancreas_head=56.0, pancreas_body=28.0, pancreas_tail=29.0),
        SYNTHETIC_FINDINGS, {"sex": "F"})
    text = " ".join(check["message"] for check in result["checks"]) + result["explanation"]
    assert result["discrepancy_count"] == 3
    for word in ("normal", "abnormal", "enlarged", "healthy", "tumor", "cancer", "diagnos"):
        assert not re.search(rf"\b{word}", " ".join(c["message"] for c in result["checks"]), re.I)
    assert "—" not in text


def test_report_payload_carries_consistency_and_keeps_scope():
    raw = "FINDINGS:\n" + SYNTHETIC_FINDINGS + "\nIMPRESSION:\nSynthetic impression."
    data = evidence.report_payload("7", raw, organ_volumes=organs(spleen=440.0), patient={"sex": "F"})
    assert data["consistency"]["discrepancy_count"] == 1
    assert data["consistency"]["checks"][0]["structures"] == ["spleen"]
    assert data["assessment_scope"]["disease_assessment"] == "not_supported"
    assert data["comments"] == "" and data["impression"] == []
    assert data["organ_volumes"]["spleen"]["status"] == "not_assessed"


def test_report_payload_without_source_or_masks_has_no_checks():
    data = evidence.report_payload("7", "")
    assert data["consistency"]["checks"] == []
    assert data["consistency"]["discrepancy_count"] == 0
