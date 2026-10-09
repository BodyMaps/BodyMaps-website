// Report text and segmentation measurements are separate evidence sources.
// Neither absent flags nor an in-range measurement establishes clinical normality.
export interface OrganData {
  volume: number | null;
  mean_hu: number | null;
  status?: 'not_assessed' | 'normal' | 'check';
  centroid_mm?: [number, number, number];
  dimensions?: [number, number, number];
}

export interface ReportData {
  case_id: string;
  report_schema_version?: string;
  patient: { age: number | string; sex: string };
  imaging?: { study_type: string; contrast: string; spacing: number[]; shape: number[] };
  organ_volumes: Record<string, OrganData>;
  lesions?: Record<string, { voxels: number; volume: number }>;
  masks_available?: boolean;
  comments: string;
  impression: string[];
  source_report?: {
    available: boolean;
    source: string;
    text: string;
    findings: string;
    impression: string[];
    reviewed_by_clinician: boolean;
  };
  provenance?: {
    report_source: string;
    measurements_source: string;
    image_review_performed: boolean;
  };
  coverage?: { status: string; measured_structures: number; limitations: string[] };
}

const DEFAULT_LIMITATIONS = [
  'Segmentation measurements do not establish whether a structure is normal or abnormal.',
  'This summary does not provide a complete diagnostic review. Findings outside the segmented structures may not be assessed.',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const text = (value: unknown): string => typeof value === 'string' ? value : '';
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
const finite = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;

function triplet(value: unknown): [number, number, number] | undefined {
  return Array.isArray(value) && value.length === 3 && value.every(v => finite(v) !== null)
    ? value as [number, number, number] : undefined;
}

/** Accept source-only reports, and never upgrade missing or legacy status to a clinical assessment. */
export function normalizeReportData(value: unknown): ReportData | null {
  if (!isRecord(value) || 'error' in value) return null;
  if (!('organ_volumes' in value || 'source_report' in value || 'comments' in value || 'impression' in value)) return null;
  const organ_volumes: Record<string, OrganData> = {};
  if (isRecord(value.organ_volumes)) {
    for (const [organ, metrics] of Object.entries(value.organ_volumes)) {
      if (!isRecord(metrics)) continue;
      organ_volumes[organ] = {
        volume: finite(metrics.volume), mean_hu: finite(metrics.mean_hu),
        status: metrics.status === 'check' ? 'check' : 'not_assessed',
        centroid_mm: triplet(metrics.centroid_mm), dimensions: triplet(metrics.dimensions),
      };
    }
  }
  const source = isRecord(value.source_report) ? value.source_report : null;
  const provenance = isRecord(value.provenance) ? value.provenance : null;
  const coverage = isRecord(value.coverage) ? value.coverage : null;
  const patient = isRecord(value.patient) ? value.patient : {};
  return {
    case_id: text(value.case_id), report_schema_version: text(value.report_schema_version),
    patient: { age: typeof patient.age === 'number' ? patient.age : text(patient.age), sex: text(patient.sex) },
    organ_volumes, masks_available: value.masks_available !== false,
    comments: text(value.comments), impression: strings(value.impression),
    source_report: source ? {
      available: source.available === true, source: text(source.source), text: text(source.text),
      findings: text(source.findings), impression: strings(source.impression),
      reviewed_by_clinician: source.reviewed_by_clinician === true,
    } : undefined,
    provenance: provenance ? {
      report_source: text(provenance.report_source), measurements_source: text(provenance.measurements_source),
      image_review_performed: provenance.image_review_performed === true,
    } : undefined,
    coverage: coverage ? {
      status: text(coverage.status), measured_structures: finite(coverage.measured_structures) ?? Object.keys(organ_volumes).length,
      limitations: strings(coverage.limitations),
    } : undefined,
  };
}

export function labelize(organ: string): string {
  return organ.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/** Preserve original wording, including negation, unrecognized headings, and report preamble. */
export function getSourceReportText(data: ReportData): string {
  if (data.source_report?.text.trim()) return data.source_report.text;
  const findings = data.source_report?.findings || data.comments;
  const impressions = data.source_report?.impression.length ? data.source_report.impression : data.impression;
  return [
    findings && findings !== 'Clinical comments unavailable.' ? `FINDINGS:\n${findings}` : '',
    impressions.filter(item => item !== 'No impression available for this case.').length
      ? `IMPRESSION:\n${impressions.filter(item => item !== 'No impression available for this case.').join('\n')}` : '',
  ].filter(Boolean).join('\n\n');
}

export function getCoverageLimitations(data: ReportData): string[] {
  return [...new Set([...DEFAULT_LIMITATIONS, ...(data.coverage?.limitations ?? [])])];
}

export function splitOrgans(data: ReportData | null): {
  all: [string, OrganData][]; flagged: [string, OrganData][]; unassessed: [string, OrganData][];
} {
  const all = Object.entries(data?.organ_volumes ?? {});
  return { all, flagged: all.filter(([, v]) => v.status === 'check'), unassessed: all.filter(([, v]) => v.status !== 'check') };
}

export function formatMeasurement(value: number | null | undefined, unit: string): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${Number(value.toFixed(1))} ${unit}` : 'Not available';
}
