import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ReportScreen, { prefetchReportData } from '../components/ReportScreen/ReportScreen';
import SharePatientCard from '../routes/SharePatientCard';

const original = 'Synthetic preamble\nFINDINGS:\nPleural effusion. Inguinal nodes are enlarged.\nPancreas: No mass or lesion.\nIMPRESSION:\nSource findings require review.';
function fixture(id: string, sourceText = original) {
  return {
    case_id: id, report_schema_version: '2', patient: { age: 'Unknown', sex: 'Unknown' },
    organ_volumes: { pancreas: { volume: 240, mean_hu: 40, status: 'normal' } },
    comments: 'Pancreas: No mass or lesion.', impression: ['Source findings require review.'],
    source_report: { available: true, source: 'Synthetic report fixture', text: sourceText, findings: '', impression: [], reviewed_by_clinician: false },
    provenance: { report_source: 'Synthetic report fixture', measurements_source: 'Synthetic CT + segmentation', image_review_performed: false },
    coverage: { status: 'limited', measured_structures: 1, limitations: ['Pleura and lymph nodes are outside this segmentation summary.'] },
  };
}
const response = (payload: unknown) => ({ ok: true, json: async () => payload }) as Response;
const props = { onClose: vi.fn(), onViewChange: vi.fn() };
function NextShare() {
  const navigate = useNavigate();
  return <button onClick={() => navigate('/share/next-synthetic')}>Next shared case</button>;
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('report presentation', () => {
  it('shows the complete report immediately without reassuring from unflagged structures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(fixture('intro'))));
    render(<ReportScreen id="intro" {...props} />);
    expect((await screen.findByTestId('source-report-text')).textContent).toBe(original);
    expect(screen.getByText('Source: Synthetic report fixture')).toBeInTheDocument();
    expect(screen.getByText(/Pleura and lymph nodes are outside/)).toBeInTheDocument();
    expect(screen.queryByText(/looks? healthy|All clear|No findings to review/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/The scan found/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Start walkthrough/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Patient', exact: true }));
    expect(screen.getByText('Clinical status: not assessed')).toBeInTheDocument();
    expect(screen.getByText(/Segmented volume: 240 cc/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Continue', exact: true }));
    expect(screen.getByTestId('source-report-text').textContent).toBe(original);
    expect(screen.queryByText(/All clear/i)).not.toBeInTheDocument();
  });

  it('retains source-only reports in the shared card when masks and organ labels are absent', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ ...fixture('shared'), organ_volumes: undefined, masks_available: false })));
    const view = render(<MemoryRouter initialEntries={['/share/synthetic']}><Routes><Route path="/share/:shareId" element={<SharePatientCard />} /></Routes></MemoryRouter>);
    expect((await screen.findByTestId('source-report-text')).textContent).toBe(original);
    expect(screen.getByText(/Segmentation measurements are unavailable/)).toBeInTheDocument();
    expect(screen.queryByText(/All clear|looked healthy|RADIOLOGY IMPRESSION/i)).not.toBeInTheDocument();
    expect(view.container.querySelector('img[src*="qrserver"]')).toBeNull();
    expect([...view.container.querySelectorAll('img')].every(img => !img.src.includes('/share/'))).toBe(true);
  });

  it('preserves a report without masks in the walkthrough and does not invent missing demographics', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ ...fixture('source-only'), patient: {}, organ_volumes: {}, masks_available: false })));
    render(<ReportScreen id="source-only" {...props} />);
    expect((await screen.findByTestId('source-report-text')).textContent).toBe(original);
    expect(screen.getByText('Case source-only', { exact: true })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Start walkthrough/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Patient', exact: true }));
    expect(screen.getByText(/Segmentation measurements are unavailable/)).toBeInTheDocument();
    expect(screen.queryByText(/All clear|No findings to review/i)).not.toBeInTheDocument();
  });

  it('identifies stored RadGPT wording as unverified AI-generated text rather than clinician conclusions', async () => {
    const data = fixture('radgpt-fixture');
    data.source_report.source = 'RadGPT metadata workbook';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(data)));
    render(<ReportScreen id="radgpt-fixture" {...props} />);
    await screen.findByTestId('source-report-text');
    expect(screen.getByText(/Stored AI-generated report.*not independently verified/)).toBeInTheDocument();
  });

  it('does not retain source text from a previous shared case when the next link fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response(fixture('first-shared'))).mockResolvedValueOnce({ ok: false }));
    render(<MemoryRouter initialEntries={['/share/first-synthetic']}><NextShare /><Routes><Route path="/share/:shareId" element={<SharePatientCard />} /></Routes></MemoryRouter>);
    await screen.findByTestId('source-report-text');
    fireEvent.click(screen.getByRole('button', { name: 'Next shared case' }));
    await screen.findByText("This report link isn't available.");
    expect(screen.queryByTestId('source-report-text')).not.toBeInTheDocument();
  });

  it('does not present missing lesion data as a negative result or source volume as a lesion size', async () => {
    const data = fixture('flagged', 'Pancreas: Enlarged, volume: 999 cc. No lesion reported.');
    data.organ_volumes.pancreas.status = 'check';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(data)));
    render(<ReportScreen id="flagged" {...props} />);
    await screen.findByTestId('source-report-text');
    fireEvent.click(screen.getByRole('button', { name: /Start walkthrough/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Doctor', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Review flags', exact: true }));
    expect(screen.getByText('Segmented volume: 240 cc')).toBeInTheDocument();
    expect(screen.getByText('Lesion assessment: not provided by these measurements.')).toBeInTheDocument();
    expect(screen.getByTestId('source-report-text').textContent).toContain('Enlarged, volume: 999 cc');
    expect(screen.queryByText(/None detected|The scan found|sizable/i)).not.toBeInTheDocument();
  });

  it('clears the previous case while loading and ignores a stale case response', async () => {
    let resolveFirst!: (value: Response) => void;
    const first = new Promise<Response>(resolve => { resolveFirst = resolve; });
    const fetch = vi.fn().mockReturnValueOnce(first).mockResolvedValueOnce(response(fixture('new-case', 'New synthetic report.')));
    vi.stubGlobal('fetch', fetch);
    const view = render(<ReportScreen id="old-pending-case" {...props} />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    view.rerender(<ReportScreen id="new-case" {...props} />);
    expect((await screen.findByTestId('source-report-text')).textContent).toBe('New synthetic report.');
    await act(async () => { resolveFirst(response(fixture('old-pending-case', 'Old synthetic report.'))); await first; });
    expect(screen.getByTestId('source-report-text').textContent).toBe('New synthetic report.');
  });

  it('discards the displayed report and walkthrough step if the next case fails to load', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response(fixture('shown-case'))).mockResolvedValueOnce({ ok: false });
    vi.stubGlobal('fetch', fetch);
    const view = render(<ReportScreen id="shown-case" {...props} />);
    await screen.findByTestId('source-report-text');
    fireEvent.click(screen.getByRole('button', { name: /Start walkthrough/ }));
    view.rerender(<ReportScreen id="failed-case" {...props} />);
    await screen.findByText('Report unavailable.');
    expect(screen.queryByTestId('source-report-text')).not.toBeInTheDocument();
    expect(screen.queryByText('Segmented structures')).not.toBeInTheDocument();
  });

  it('coalesces prefetches but revalidates source data after the cache expires', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
    const fetch = vi.fn().mockResolvedValueOnce(response(fixture('cache-case'))).mockResolvedValueOnce(response(fixture('cache-case', 'Updated synthetic source.')));
    vi.stubGlobal('fetch', fetch);
    const first = prefetchReportData('cache-case');
    expect(prefetchReportData('cache-case')).toBe(first);
    await first;
    await prefetchReportData('cache-case');
    expect(fetch).toHaveBeenCalledTimes(1);
    clock.mockReturnValue(62000);
    const updated = await prefetchReportData('cache-case');
    expect(updated?.source_report?.text).toBe('Updated synthetic source.');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1][1]).toEqual({ cache: 'no-store' });
  });
});
