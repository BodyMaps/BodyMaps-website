import { getCoverageLimitations, getSourceReportText } from '../../helpers/reportFindings';
import type { ReportData } from '../../helpers/reportFindings';

export default function SourceReportDetails({ data, dark = false }: { data: ReportData; dark?: boolean }) {
  const sourceText = getSourceReportText(data);
  const source = data.source_report?.source || data.provenance?.report_source || 'Source not recorded';
  return (
    <section aria-label="Source report and assessment coverage" style={{ textAlign: 'left', fontSize: 14, lineHeight: 1.6, color: dark ? 'rgba(255,255,255,0.84)' : '#26344d' }}>
      <h2 style={{ fontSize: 21, margin: '20px 0 8px' }}>Original source report</h2>
      <p style={{ margin: '0 0 8px' }}>Source: {source}</p>
      <p style={{ margin: '0 0 14px' }}>
        {data.source_report?.reviewed_by_clinician === true
          ? 'The source records clinician review.'
          : /radgpt/i.test(source)
            ? 'Stored AI-generated report. This summary has not independently verified it; clinician review is not documented.'
            : 'Clinician review of this source report is not documented.'}
      </p>
      {sourceText ? (
        <div data-testid="source-report-text" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', padding: 16, borderRadius: 12, border: `1px solid ${dark ? 'rgba(255,255,255,0.16)' : '#d9e0eb'}`, background: dark ? 'rgba(255,255,255,0.04)' : '#f5f7fb' }}>{sourceText}</div>
      ) : <p>Source report text is unavailable. No diagnostic conclusion can be drawn from its absence.</p>}
      <h3 style={{ margin: '18px 0 6px', fontSize: 15 }}>Assessment coverage: limited</h3>
      <p style={{ margin: '0 0 8px' }}>
        Measurement source: {data.provenance?.measurements_source || 'Not recorded'}.
        {data.provenance?.image_review_performed !== true && ' This summary has not performed a diagnostic image review.'}
      </p>
      <ul style={{ paddingLeft: 20, margin: '8px 0 18px' }}>
        {getCoverageLimitations(data).map(limitation => <li key={limitation}>{limitation}</li>)}
      </ul>
    </section>
  );
}
