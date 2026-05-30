import { IconPlayerPlayFilled, IconRotateClockwise, IconRefresh } from '@tabler/icons-react';
import { SCAN_SUMMARY } from '../data/scanData';
import { ANATOMY, ORGAN_ORDER, type OrganId } from '../data/anatomyData';

interface Props {
  autoRotate: boolean;
  activeOrgan: OrganId | null;
  onStartScan: () => void;
  onToggleAuto: () => void;
  onReset: () => void;
  onSelectOrgan: (id: OrganId) => void;
}

const fade = (delay: number): React.CSSProperties => ({ ['--syn-delay' as any]: `${delay}s` });

export default function LeftDashboard({
  autoRotate,
  activeOrgan,
  onStartScan,
  onToggleAuto,
  onReset,
  onSelectOrgan,
}: Props) {
  return (
    <div className="syn-col">
      <div className="syn-card syn-fadeup" style={fade(0.05)}>
        <div className="syn-eyebrow">
          <span className="syn-dot" />
          SCAN ONLINE • CT VOLUME READY
        </div>
        <h1 className="syn-hero">
          Explore the <span>Human Body</span> in 3D.
        </h1>
        <p className="syn-lede">
          AI-assisted volumetric rendering of Visible Human Project anatomical segmentations.
          Click any organ on the focus rail to load its 3D model, then click a sub-structure
          to inspect it.
        </p>
        <div className="syn-btn-row">
          <button className="syn-btn primary" onClick={onStartScan}>
            <IconPlayerPlayFilled size={14} />
            Start Scan
          </button>
          <button className="syn-btn" onClick={onToggleAuto}>
            <IconRotateClockwise size={14} />
            {autoRotate ? 'Stop Rotate' : 'Auto Rotate'}
          </button>
          <button className="syn-btn" onClick={onReset}>
            <IconRefresh size={14} />
            Reset View
          </button>
        </div>
      </div>

      <div className="syn-card syn-fadeup" style={fade(0.12)}>
        <div className="live">
          <i />
          LIVE
        </div>
        <div className="syn-ctitle">Patient Scan Summary</div>
        <Row k="Study" v={SCAN_SUMMARY.study} />
        <Row k="Source" v={SCAN_SUMMARY.source} />
        <Row k="Slice Thickness" v={SCAN_SUMMARY.sliceThickness} />
        <Row k="Images" v={String(SCAN_SUMMARY.images)} />
        <Row k="Scan Quality" v={`${SCAN_SUMMARY.scanQuality}%`} cls="good" />
        <Row k="Contrast" v={SCAN_SUMMARY.contrast} cls="amber" />
        <Row k="Status" v={SCAN_SUMMARY.status} cls="good" />
      </div>

      <div className="syn-card syn-fadeup" style={fade(0.18)}>
        <div className="syn-ctitle">Anatomical Focus</div>
        <div className="syn-mode-grid">
          {ORGAN_ORDER.map((id) => (
            <button
              key={id}
              className={'syn-mode-btn' + (activeOrgan === id ? ' active' : '')}
              onClick={() => onSelectOrgan(id)}
            >
              {ANATOMY[id].name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Row({ k, v, cls = '' }: { k: string; v: string; cls?: string }) {
  return (
    <div className="syn-row">
      <span className="k">{k}</span>
      <span className={'v ' + cls}>{v}</span>
    </div>
  );
}
