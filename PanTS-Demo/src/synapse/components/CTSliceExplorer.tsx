import { SCAN_SUMMARY } from '../data/scanData';
import type { SliceState, SlicePlane } from '../hooks/useAnatomySelection';

const TOTAL = SCAN_SUMMARY.images;
const fill = (idx: number): React.CSSProperties => ({
  ['--fill' as any]: `${(idx / TOTAL) * 100}%`,
});

interface Props {
  slices: SliceState;
  onSlice: (plane: SlicePlane, value: number) => void;
  showPlanes: boolean;
  onTogglePlanes: () => void;
}

export default function CTSliceExplorer({
  slices,
  onSlice,
  showPlanes,
  onTogglePlanes,
}: Props) {
  return (
    <div className="syn-card syn-fadeup" style={{ ['--syn-delay' as any]: '0.2s' }}>
      <div className="syn-ctitle">CT Slice Explorer</div>

      <SliceRow label="Axial" plane="axial" value={slices.axial} onSlice={onSlice} />
      <SliceRow label="Sagittal" plane="sagittal" value={slices.sagittal} onSlice={onSlice} />
      <SliceRow label="Coronal" plane="coronal" value={slices.coronal} onSlice={onSlice} />

      <div className="syn-toggle-row">
        Show slice planes
        <div
          className={'syn-switch' + (showPlanes ? ' on' : '')}
          onClick={onTogglePlanes}
          role="switch"
          aria-checked={showPlanes}
        >
          <i />
        </div>
      </div>
    </div>
  );
}

function SliceRow({
  label,
  plane,
  value,
  onSlice,
}: {
  label: string;
  plane: SlicePlane;
  value: number;
  onSlice: (plane: SlicePlane, value: number) => void;
}) {
  return (
    <div className="syn-slider-block">
      <div className="lab">
        <span>{label}</span>
        <b>
          Slice {value} / {TOTAL}
        </b>
      </div>
      <input
        type="range"
        min={1}
        max={TOTAL}
        value={value}
        style={fill(value)}
        onChange={(e) => onSlice(plane, Number(e.target.value))}
      />
    </div>
  );
}
