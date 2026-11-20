import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ReportScreen from '../components/ReportScreen/ReportScreen';
import SourceReportDetails from '../components/ReportScreen/SourceReportDetails';
import { getConsistencyItems, structureLabel } from '../helpers/reportConsistency';
import { normalizeReportData } from '../helpers/reportFindings';
import type { ReportData } from '../helpers/reportFindings';

// Synthetic values only; no patient data.
const checks = [
  { kind: 'source_volume', status: 'consistent', structures: ['liver'], measured_volume: 1020, source_volume: 1000, difference_percent: 2 },
  { kind: 'source_volume', status: 'discrepancy', structures: ['spleen'], measured_volume: 440, source_volume: 100, difference_percent: 340 },
  { kind: 'parts_whole', status: 'discrepancy', structures: ['pancreas', 'pancreas_head', 'pancreas_body', 'pancreas_tail'], parts_volume: 113, whole_volume: null },
  { kind: 'recorded_sex', status: 'discrepancy', structures: ['prostate'], measured_volume: 144.5, recorded_sex: 'F' },
];

function report(consistency: unknown): ReportData {
  return {
    case_id: 'synthetic-7', patient: { age: 'Unknown', sex: 'Unknown' }, organ_volumes: {},
    comments: '', impression: [], consistency: consistency as ReportData['consistency'],
    source_report: { available: true, source: 'Synthetic report fixture', text: 'Synthetic source.', findings: '', impression: [], reviewed_by_clinician: false },
  };
}

describe('source consistency helper', () => {
  it('labels sided structures readably', () => {
    expect(structureLabel('kidney_left')).toBe('left kidney');
    expect(structureLabel('adrenal_gland_right')).toBe('right adrenal gland');
    expect(structureLabel('pancreas_head')).toBe('pancreas head');
  });

  it('builds text from typed fields, discrepancies first, and ignores incoming prose', () => {
    const items = getConsistencyItems({ checks: checks.map(check => ({ ...check, message: 'All organs healthy.' })) });
    expect(items.map(item => item.status)).toEqual(['discrepancy', 'discrepancy', 'discrepancy', 'consistent']);
    expect(items[0].text).toBe('Measured spleen volume (440.0 cc) and the volume stated in the source reference (100.0 cc) do not match.');
    expect(items[1].text).toBe('No pancreas measurement is available, but its parts (pancreas head, pancreas body, pancreas tail) measure 113.0 cc in total.');
    expect(items.map(item => item.text).join(' ')).not.toMatch(/healthy/);
  });

  it('drops malformed or unknown checks', () => {
    expect(getConsistencyItems(undefined)).toEqual([]);
    expect(getConsistencyItems({ checks: 'nope' })).toEqual([]);
    expect(getConsistencyItems({ checks: [
      { kind: 'diagnosis', status: 'discrepancy', structures: ['spleen'], measured_volume: 1, source_volume: 2 },
      { kind: 'source_volume', status: 'abnormal', structures: ['spleen'], measured_volume: 1, source_volume: 2 },
      { kind: 'source_volume', status: 'discrepancy', structures: ['<script>'], measured_volume: 1, source_volume: 2 },
      { kind: 'source_volume', status: 'discrepancy', structures: ['spleen'], measured_volume: Number.NaN, source_volume: 2 },
      { kind: 'recorded_sex', status: 'discrepancy', structures: ['prostate'], measured_volume: 5, recorded_sex: 'unknown' },
    ] })).toEqual([]);
  });

  it('uses no clinical wording or em-dashes', () => {
    const text = getConsistencyItems({ checks }).map(item => item.text).join(' ');
    expect(text).not.toMatch(/\b(normal|abnormal|enlarged|healthy|tumou?r|cancer|diagnos)/i);
    expect(text).not.toContain('—');
  });
});

describe('source consistency from a fetched report', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('survives normalization without keeping incoming prose', () => {
    const normalized = normalizeReportData({ ...report({ checks: checks.map(check => ({ ...check, message: 'All organs healthy.' })) }) });
    expect(normalized?.consistency?.checks).toHaveLength(4);
    expect(JSON.stringify(normalized?.consistency)).not.toContain('healthy');
    expect(normalizeReportData({ ...report(undefined) })?.consistency).toBeUndefined();
  });

  it('appears in the report walkthrough loaded from the server', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => report({ checks }) } as Response));
    render(<ReportScreen id="synthetic-consistency" onClose={vi.fn()} onViewChange={vi.fn()} />);
    expect(await screen.findByText('Source consistency: 3 discrepancies to review', { selector: 'summary' })).toBeInTheDocument();
  });
});

describe('source consistency panel', () => {
  it('shows a closed summary that expands to the discrepancies', () => {
    render(<SourceReportDetails data={report({ checks })} />);
    const summary = screen.getByText('Source consistency: 3 discrepancies to review', { selector: 'summary' });
    expect(summary.closest('details')).not.toHaveAttribute('open');
    fireEvent.click(summary);
    expect(screen.getByRole('list', { name: 'Source discrepancies' }).children).toHaveLength(3);
    expect(screen.getByText('1 other check agrees across sources.')).toBeInTheDocument();
    expect(screen.getByText(/does not say which source is correct/)).toBeInTheDocument();
  });

  it('reports agreement when nothing disagrees', () => {
    render(<SourceReportDetails data={report({ checks: [checks[0]] })} />);
    expect(screen.getByText('Source consistency: no discrepancies in 1 check', { selector: 'summary' })).toBeInTheDocument();
  });

  it('renders nothing for older payloads without checks', () => {
    render(<SourceReportDetails data={report(undefined)} />);
    expect(screen.queryByTestId('source-consistency')).not.toBeInTheDocument();
    expect(screen.getByText('Unverified source reference', { selector: 'summary' })).toBeInTheDocument();
  });
});
