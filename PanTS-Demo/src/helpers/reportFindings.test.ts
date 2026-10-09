import { describe, expect, it } from 'vitest';
import { formatMeasurement, getSourceReportText, normalizeReportData, splitOrgans } from './reportFindings';

describe('report evidence boundaries', () => {
  it('does not turn legacy normal, missing flags, or small segmentation labels into normal assessments', () => {
    const data = normalizeReportData({ organ_volumes: {
      liver: { volume: 1300, mean_hu: 45, status: 'normal' },
      pancreas: { volume: 240, mean_hu: 60 },
      kidney_left: { volume: 2, mean_hu: 30, status: 'check' },
      kidney_right: { volume: 3, mean_hu: 28, status: 'check' },
    } })!;
    expect(data.organ_volumes.liver.status).toBe('not_assessed');
    expect(data.organ_volumes.pancreas.status).toBe('not_assessed');
    const { all, flagged, unassessed } = splitOrgans(data);
    expect(all).toHaveLength(4);
    expect(flagged.map(([name]) => name)).toEqual(['kidney_left', 'kidney_right']);
    expect(unassessed).toHaveLength(2);
  });

  it('preserves complete source text, negation, and findings outside segmentation labels even without masks', () => {
    const original = 'Synthetic report preamble\nFINDINGS:\nPleural effusion. Inguinal nodes are enlarged.\nPancreas: No mass or lesion.\nIMPRESSION:\nSee documented findings.';
    const data = normalizeReportData({ masks_available: false, source_report: {
      available: true, source: 'Synthetic fixture', text: original,
      findings: 'Shorter parsed field', impression: [], reviewed_by_clinician: false,
    } })!;
    expect(getSourceReportText(data)).toBe(original);
    expect(splitOrgans(data).all).toEqual([]);
  });

  it('retains legacy source findings and impressions without synthesizing diagnoses', () => {
    const data = normalizeReportData({
      comments: 'Pancreas: No enlarged area. No mass. Volume: 500 cc.\nPleura: Effusion.',
      impression: ['Inguinal lymph nodes described in the source.'], organ_volumes: {},
    })!;
    expect(getSourceReportText(data)).toBe('FINDINGS:\nPancreas: No enlarged area. No mass. Volume: 500 cc.\nPleura: Effusion.\n\nIMPRESSION:\nInguinal lymph nodes described in the source.');
    expect(getSourceReportText(data)).not.toContain('The scan found');
  });

  it('keeps absent, invalid, and zero measurements distinct', () => {
    const data = normalizeReportData({ organ_volumes: {
      liver: { volume: '1300', mean_hu: NaN }, pancreas: { volume: 0, mean_hu: 0 },
    } })!;
    expect(formatMeasurement(data.organ_volumes.liver.volume, 'cc')).toBe('Not available');
    expect(formatMeasurement(data.organ_volumes.liver.mean_hu, 'HU')).toBe('Not available');
    expect(formatMeasurement(data.organ_volumes.pancreas.volume, 'cc')).toBe('0 cc');
  });

  it('does not represent unavailable report placeholders as source evidence', () => {
    const data = normalizeReportData({ comments: 'Clinical comments unavailable.', impression: ['No impression available for this case.'] })!;
    expect(getSourceReportText(data)).toBe('');
    expect(normalizeReportData({ error: 'Unavailable' })).toBeNull();
    expect(normalizeReportData({ unrelated: true })).toBeNull();
  });
});
