import { IconCheck } from '@tabler/icons-react';
import { ANATOMY, type OrganId, type SubStructure } from '../data/anatomyData';

interface Props {
  organId: OrganId | null;
  subData: SubStructure | null;
}

export default function SelectedAnatomyCard({ organId, subData }: Props) {
  const a = organId ? ANATOMY[organId] : null;

  return (
    <div className="syn-card syn-selinfo syn-fadeup" style={{ ['--syn-delay' as any]: '0.15s' }}>
      <div className="live">
        <i />
        LIVE
      </div>
      <div className="syn-ctitle">Selected Anatomy</div>

      {!a ? (
        <p style={{ color: 'var(--syn-text-faint)', fontSize: 12, lineHeight: 1.6 }}>
          No structure selected. Click an organ on the focus rail, then click a
          sub-structure on the model to inspect it.
        </p>
      ) : (
        <>
          <div className="name">{a.name}</div>
          <div className="sys">
            {a.system} • {a.location}
          </div>
          {subData && (
            <>
              <div className="sub-name">{subData.displayName}</div>
              <p>{subData.description}</p>
            </>
          )}
          {!subData && <p>{a.description}</p>}
          <div className="syn-finding">
            <IconCheck size={14} color="#5fe3a1" />
            {a.finding}
          </div>
          <div className="syn-row">
            <span className="k">AI Status</span>
            <span className="v good">No abnormalities</span>
          </div>
          <div className="syn-row">
            <span className="k">Segmentation Confidence</span>
            <span className="v">{a.confidence}%</span>
          </div>
        </>
      )}
    </div>
  );
}
