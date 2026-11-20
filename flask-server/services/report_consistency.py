"""Consistency checks between the sources a report already holds.

A report combines three sources: measurements from named segmentation masks,
the stored (unverified) source report, and case metadata. When two of them give
different values for the same thing, a reader cannot tell which to trust. These
checks only point that out. They never assess disease, never decide which source
is correct, and never classify report wording. The only thing read from source
text is a volume the source states for a named structure, so it can be put next
to the measured volume.

Every threshold is a placeholder for review with the team, not a clinical cutoff.
"""
from __future__ import annotations

import math
import re

CONSISTENCY_SCHEMA_VERSION = "1"
CONSISTENCY_EXPLANATION = (
    "These checks compare the sources this report already holds: segmentation "
    "measurements, the stored source report, and case metadata. A discrepancy means "
    "a person should compare the sources. It does not indicate disease, and it does "
    "not say which source is correct."
)

# Stored source reports state volumes computed from masks of the same case
# (services/label_scheme.py notes that the dataset spleen label matches the stored
# spleen volume in every local case), so matching sources agree closely.
SOURCE_VOLUME_TOLERANCE = 0.05
# The whole structure is the union of its parts, so the sum should match closely.
PARTS_TOLERANCE = 0.05
# Ignore specks: a structure must measure at least this much to count as present.
MIN_PRESENT_CC = 1.0

# Source report section heading -> {mask name: pattern for the stated volume}.
_NUMBER = r"([0-9]+(?:\.[0-9]+)?)\s*(?:cc|cm3|cm\^3|ml)\b"
SOURCE_VOLUME_PATTERNS = {
    "spleen": {"spleen": rf"(?<![a-z ])volume:\s*{_NUMBER}"},
    "liver": {"liver": rf"(?<![a-z ])volume:\s*{_NUMBER}"},
    "pancreas": {"pancreas": rf"(?<![a-z ])volume:\s*{_NUMBER}"},
    "kidney": {
        "kidney_right": rf"right kidney volume:\s*{_NUMBER}",
        "kidney_left": rf"left kidney volume:\s*{_NUMBER}",
    },
}
_SECTION_HEADING = re.compile(r"(?im)^\s*([a-z][a-z ]*?)\s*:\s*$")

# Whole structure -> the parts it is made of (the pancreatic duct lies inside
# the other parts, so it is not added).
STRUCTURE_PARTS = {"pancreas": ("pancreas_head", "pancreas_body", "pancreas_tail")}

# Structure -> the only recorded sex it is expected with.
SEX_SPECIFIC_STRUCTURES = {"prostate": "M"}
_SEX_VALUES = {"m": "M", "male": "M", "f": "F", "female": "F"}


def _volume(organ_volumes, name):
    try:
        value = float((organ_volumes.get(name) or {}).get("volume"))
    except (TypeError, ValueError):
        return None
    return value if math.isfinite(value) else None


def _label(name):
    for side in ("left", "right"):
        if name.endswith(f"_{side}"):
            return f"{side} {name[: -len(side) - 1].replace('_', ' ')}"
    return name.replace("_", " ")


def source_stated_volumes(findings_text):
    """Return {mask name: volume in cc} for volumes the source states plainly.

    Only a value inside the section for that structure is used, so a volume
    mentioned under another heading is never attributed to the wrong organ.
    """
    text = str(findings_text or "")
    headings = list(_SECTION_HEADING.finditer(text))
    stated = {}
    for index, heading in enumerate(headings):
        section = heading.group(1).strip().lower()
        patterns = SOURCE_VOLUME_PATTERNS.get(section) or SOURCE_VOLUME_PATTERNS.get(section.removesuffix("s"))
        if not patterns:
            continue
        end = headings[index + 1].start() if index + 1 < len(headings) else len(text)
        body = text[heading.end():end]
        for name, pattern in patterns.items():
            match = re.search(pattern, body, re.IGNORECASE)
            if match and name not in stated:
                stated[name] = float(match.group(1))
    return stated


def _relative_difference(a, b):
    return abs(a - b) / b if b else math.inf


def _source_volume_checks(organ_volumes, stated):
    checks = []
    for name, source_value in sorted(stated.items()):
        measured = _volume(organ_volumes, name)
        if measured is None:
            continue
        difference = _relative_difference(measured, source_value)
        discrepancy = difference > SOURCE_VOLUME_TOLERANCE
        checks.append({
            "kind": "source_volume",
            "structures": [name],
            "status": "discrepancy" if discrepancy else "consistent",
            "measured_volume": round(measured, 2),
            "source_volume": round(source_value, 2),
            "difference_percent": round(difference * 100, 1) if math.isfinite(difference) else None,
            "message": (
                f"The measured {_label(name)} volume ({measured:.1f} cc) and the volume stated in "
                f"the stored source report ({source_value:.1f} cc) differ by more than "
                f"{SOURCE_VOLUME_TOLERANCE:.0%}."
                if discrepancy else
                f"The measured {_label(name)} volume agrees with the stored source report "
                f"within {SOURCE_VOLUME_TOLERANCE:.0%}."
            ),
        })
    return checks


def _parts_checks(organ_volumes):
    checks = []
    for whole, parts in STRUCTURE_PARTS.items():
        part_volumes = [_volume(organ_volumes, part) for part in parts]
        if any(value is None for value in part_volumes):
            continue
        total = sum(part_volumes)
        if total < MIN_PRESENT_CC:
            continue
        whole_volume = _volume(organ_volumes, whole)
        base = {"kind": "parts_whole", "structures": [whole, *parts],
                "parts_volume": round(total, 2),
                "whole_volume": None if whole_volume is None else round(whole_volume, 2)}
        if whole_volume is None:
            checks.append({**base, "status": "discrepancy", "difference_percent": None, "message": (
                f"No {_label(whole)} measurement is available, but its parts "
                f"({', '.join(_label(part) for part in parts)}) measure {total:.1f} cc in total."
            )})
            continue
        difference = _relative_difference(whole_volume, total)
        discrepancy = difference > PARTS_TOLERANCE
        checks.append({**base, "status": "discrepancy" if discrepancy else "consistent",
                       "difference_percent": round(difference * 100, 1), "message": (
            f"The {_label(whole)} measures {whole_volume:.1f} cc, but its parts measure "
            f"{total:.1f} cc in total."
            if discrepancy else
            f"The {_label(whole)} volume equals the sum of its parts within {PARTS_TOLERANCE:.0%}."
        )})
    return checks


def _recorded_sex_checks(organ_volumes, patient):
    recorded = _SEX_VALUES.get(str((patient or {}).get("sex") or "").strip().lower())
    if recorded is None:
        return []
    checks = []
    for name, expected in sorted(SEX_SPECIFIC_STRUCTURES.items()):
        measured = _volume(organ_volumes, name)
        if measured is None or measured < MIN_PRESENT_CC:
            continue
        discrepancy = recorded != expected
        checks.append({
            "kind": "recorded_sex",
            "structures": [name],
            "status": "discrepancy" if discrepancy else "consistent",
            "measured_volume": round(measured, 2),
            "recorded_sex": recorded,
            "message": (
                f"A {_label(name)} mask ({measured:.1f} cc) is present, but the case metadata "
                f"records sex as {'female' if recorded == 'F' else 'male'}. The metadata, the "
                f"structure name, or the mask may be wrong."
                if discrepancy else
                f"The {_label(name)} mask matches the recorded sex."
            ),
        })
    return checks


def report_consistency(organ_volumes=None, source_findings="", patient=None):
    organ_volumes = organ_volumes or {}
    checks = (
        _source_volume_checks(organ_volumes, source_stated_volumes(source_findings))
        + _parts_checks(organ_volumes)
        + _recorded_sex_checks(organ_volumes, patient)
    )
    return {
        "schema_version": CONSISTENCY_SCHEMA_VERSION,
        "explanation": CONSISTENCY_EXPLANATION,
        "checks": checks,
        "discrepancy_count": sum(check["status"] == "discrepancy" for check in checks),
    }
