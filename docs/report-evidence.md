# Automatic report evidence and coverage

The automatic report combines stored automated report text with measurements
from available CT segmentation masks. It does not perform a new, comprehensive
clinical review of the CT.

## Report contract

Schema version `2` keeps source text separate from measurements. The
`source_report` object preserves the complete stored text, including sections
outside the segmentation label set. Its source and clinician-review status are
explicit. `coverage` and `provenance` describe what was actually available.

The presence of an organ mask, an aggregate attenuation value, or the absence
of an automated warning cannot establish that an organ is healthy. Automatically
measured structures therefore have `status: "not_assessed"`. Similarly, a missing
lesion mask is not evidence that there is no lesion. Source statements remain
attributed to the stored automated report; the presentation must not infer a
new positive diagnosis from keywords, whole-organ size, or an omitted finding.

The viewer, shared report, HTML export and PDF must retain the complete source
text independently of available masks. Legacy payloads without evidence fields
must also avoid inferred normality. A source report remains useful when
measurements are unavailable, provided that limitation is visible.

Measurements use explicitly named, binary structure masks with CT-matching
geometry. Historical combined-label maps have incompatible numeric label
conventions; without verified structure identities they are not used to produce
organ measurements. Combined-only cases therefore retain their source report
but show unavailable measurements.

## What this fixes

- Unsupported counts of normal or healthy organs based on segmentation status.
- Source findings disappearing because their anatomy is not a segmentation label.
- Negated source wording being rewritten as a positive diagnosis.
- Report downloads taking a separate path that asks a language model to diagnose
  from aggregate organ measurements.

## What still requires validation

Preserving source text does not correct errors in that text or detect abnormalities
it never mentioned. Pleural, nodal, and other findings require appropriate image
assessment; no diagnostic sensitivity improvement is claimed by this change.
Suspected incorrect source statements must be reviewed against the study by a
qualified reviewer and corrected in the authoritative source with provenance.
Do not insert case-specific diagnoses into application code.

## Verification

Use synthetic reports and tiny generated masks in regression tests. Cover absent
source text, absent masks, findings outside organ labels, negated wording, stale
legacy payloads, HTML escaping, and PDF text preservation. Do not add patient
reports, scans, credentials or production databases to fixtures or pull requests.

Run `npm test` and `npm run build` in `PanTS-Demo`. In `flask-server`, run
`python -m pytest tests/unit/test_report_evidence.py tests/unit/test_quiz_report_questions.py`.
The backend tests use generated files and isolate report functions from model
services, production data, and database initialization.

The old indefinite report cache is removed so updated source text is read again.
Measurements currently reload local CT/masks per request; profile report latency
on deployment hardware before adding a bounded cache keyed by source-file
identity. Do not restore an unversioned report cache or cache failed lookups.

After an approved release, check the report, its shared view, and both exports.
Confirm that complete source text is available and that measurements carry no
unsupported normal/healthy conclusion. A deployment check is not a clinical
accuracy evaluation.
