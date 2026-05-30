import { VIS_MODES, type VisMode } from '../data/scanData';

interface Props {
  mode: VisMode;
  onMode: (m: VisMode) => void;
}

export default function VisualizationModePanel({ mode, onMode }: Props) {
  return (
    <div className="syn-card syn-fadeup" style={{ ['--syn-delay' as any]: '0.05s' }}>
      <div className="syn-ctitle">Visualization Mode</div>
      <div className="syn-mode-grid">
        {VIS_MODES.map((m) => (
          <button
            key={m.id}
            className={'syn-mode-btn' + (mode === m.id ? ' active' : '')}
            onClick={() => onMode(m.id)}
            title={m.hint}
          >
            <span
              className="sw"
              style={{ background: m.color, boxShadow: `0 0 8px ${m.color}` }}
            />
            {m.label}
          </button>
        ))}
      </div>
    </div>
  );
}
