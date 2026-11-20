// Source consistency checks (flask-server/services/report_consistency.py).
// Display text is built here from typed fields only; incoming prose is never
// shown, matching how coverage limitations are handled (docs/report-evidence.md).

export type ConsistencyKind = 'source_volume' | 'parts_whole' | 'recorded_sex';
export type ConsistencyStatus = 'discrepancy' | 'consistent';

export interface ConsistencyCheck {
  kind: ConsistencyKind;
  status: ConsistencyStatus;
  structures: string[];
  measured_volume?: number | null;
  source_volume?: number | null;
  parts_volume?: number | null;
  whole_volume?: number | null;
  difference_percent?: number | null;
  recorded_sex?: string | null;
}

export interface ReportConsistency {
  schema_version?: string;
  checks: ConsistencyCheck[];
  discrepancy_count?: number;
}

export interface ConsistencyItem {
  kind: ConsistencyKind;
  status: ConsistencyStatus;
  text: string;
}

export const CONSISTENCY_EXPLANATION =
  'These checks compare the sources this report already holds: segmentation measurements, the stored source '
  + 'reference, and case metadata. A discrepancy means a person should compare the sources. It does not indicate '
  + 'disease, and it does not say which source is correct.';

const KINDS: ConsistencyKind[] = ['source_volume', 'parts_whole', 'recorded_sex'];
const STRUCTURE = /^[a-z][a-z0-9_]*$/;

export function structureLabel(name: string): string {
  const side = /^(.*)_(left|right)$/.exec(name);
  return (side ? `${side[2]} ${side[1]}` : name).replace(/_/g, ' ');
}

function cc(value: unknown): string | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? `${value.toFixed(1)} cc` : null;
}

function describe(check: ConsistencyCheck): string | null {
  const [first, ...rest] = check.structures;
  const name = structureLabel(first);
  if (check.kind === 'source_volume') {
    const measured = cc(check.measured_volume);
    const source = cc(check.source_volume);
    if (!measured || !source) return null;
    return check.status === 'discrepancy'
      ? `Measured ${name} volume (${measured}) and the volume stated in the source reference (${source}) do not match.`
      : `Measured ${name} volume matches the source reference (${measured} vs. ${source}).`;
  }
  if (check.kind === 'parts_whole') {
    const parts = cc(check.parts_volume);
    if (!parts || rest.length === 0) return null;
    const partNames = rest.map(structureLabel).join(', ');
    const whole = cc(check.whole_volume);
    if (check.status === 'discrepancy') {
      return whole
        ? `The ${name} measures ${whole}, but its parts (${partNames}) measure ${parts} in total.`
        : `No ${name} measurement is available, but its parts (${partNames}) measure ${parts} in total.`;
    }
    return whole ? `The ${name} (${whole}) matches the sum of its parts (${parts}).` : null;
  }
  const measured = cc(check.measured_volume);
  const sex = check.recorded_sex === 'F' ? 'female' : check.recorded_sex === 'M' ? 'male' : null;
  if (!measured || !sex) return null;
  return check.status === 'discrepancy'
    ? `A ${name} mask (${measured}) is present, but the case metadata records sex as ${sex}. The metadata, the structure name, or the mask may be wrong.`
    : `The ${name} mask matches the recorded sex.`;
}

const NUMBER_FIELDS = ['measured_volume', 'source_volume', 'parts_volume', 'whole_volume', 'difference_percent'] as const;

/** Keep only typed fields from a server payload; prose such as `message` is discarded. */
export function normalizeConsistency(value: unknown): ReportConsistency | undefined {
  const checks = (value as { checks?: unknown } | null | undefined)?.checks;
  if (!value || typeof value !== 'object' || !Array.isArray(checks)) return undefined;
  const kept: ConsistencyCheck[] = [];
  for (const raw of checks) {
    if (!raw || typeof raw !== 'object') continue;
    const check = raw as Record<string, unknown>;
    const copy: ConsistencyCheck = {
      kind: check.kind as ConsistencyKind,
      status: check.status as ConsistencyStatus,
      structures: Array.isArray(check.structures) ? check.structures.filter(name => typeof name === 'string') : [],
      recorded_sex: typeof check.recorded_sex === 'string' ? check.recorded_sex : null,
    };
    for (const field of NUMBER_FIELDS) {
      const number = check[field];
      copy[field] = typeof number === 'number' && Number.isFinite(number) ? number : null;
    }
    kept.push(copy);
  }
  return { checks: kept };
}

/** Validated display items, discrepancies first. Malformed checks are dropped. */
export function getConsistencyItems(consistency: unknown): ConsistencyItem[] {
  const checks = (consistency as ReportConsistency | null | undefined)?.checks;
  if (!Array.isArray(checks)) return [];
  const items: ConsistencyItem[] = [];
  for (const check of checks as ConsistencyCheck[]) {
    if (!check || !KINDS.includes(check.kind)) continue;
    if (check.status !== 'discrepancy' && check.status !== 'consistent') continue;
    if (!Array.isArray(check.structures) || check.structures.length === 0
      || !check.structures.every(name => typeof name === 'string' && STRUCTURE.test(name))) continue;
    const text = describe(check);
    if (text) items.push({ kind: check.kind, status: check.status, text });
  }
  return items.sort((a, b) => Number(b.status === 'discrepancy') - Number(a.status === 'discrepancy'));
}
