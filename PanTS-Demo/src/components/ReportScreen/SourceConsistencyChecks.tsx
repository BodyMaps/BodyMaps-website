import { CONSISTENCY_EXPLANATION, getConsistencyItems } from '../../helpers/reportConsistency';
import type { ReportData } from '../../helpers/reportFindings';

// Where the report's own sources disagree. A discrepancy asks a person to compare
// sources; it is never a finding (docs/report-evidence.md, "Source consistency checks").
export default function SourceConsistencyChecks({ data, dark = false }: { data: ReportData; dark?: boolean }) {
  const items = getConsistencyItems(data.consistency);
  if (items.length === 0) return null;
  const discrepancies = items.filter(item => item.status === 'discrepancy');
  const consistent = items.length - discrepancies.length;
  const border = dark ? 'rgba(255,255,255,0.16)' : '#d9e0eb';
  const summary = discrepancies.length
    ? `Source consistency: ${discrepancies.length} ${discrepancies.length === 1 ? 'discrepancy' : 'discrepancies'} to review`
    : `Source consistency: no discrepancies in ${items.length} ${items.length === 1 ? 'check' : 'checks'}`;
  return (
    <details data-testid="source-consistency" style={{ borderTop: `1px solid ${border}`, paddingTop: 14, marginBottom: 14 }}>
      <summary style={{ cursor: 'pointer', fontSize: 15, fontWeight: 700 }}>{summary}</summary>
      <p style={{ margin: '10px 0 8px', fontSize: 13.5 }}>{CONSISTENCY_EXPLANATION}</p>
      {discrepancies.length > 0 && (
        <ul aria-label="Source discrepancies" style={{ paddingLeft: 20, margin: '0 0 8px' }}>
          {discrepancies.map(item => <li key={item.text} style={{ marginBottom: 4 }}>{item.text}</li>)}
        </ul>
      )}
      {consistent > 0 && (
        <p style={{ margin: 0, fontSize: 13, opacity: 0.8 }}>
          {consistent} other {consistent === 1 ? 'check agrees' : 'checks agree'} across sources.
        </p>
      )}
    </details>
  );
}
