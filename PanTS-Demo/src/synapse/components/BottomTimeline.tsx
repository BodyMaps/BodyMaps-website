import { useEffect } from 'react';
import { IconPlayerPlayFilled, IconPlayerPauseFilled } from '@tabler/icons-react';
import { SCAN_SUMMARY, TIMELINE_LABELS } from '../data/scanData';
import type { SliceState } from '../hooks/useAnatomySelection';

const TOTAL = SCAN_SUMMARY.images;

interface Props {
  slices: SliceState;
  setSlices: React.Dispatch<React.SetStateAction<SliceState>>;
  play: boolean;
  setPlay: (v: boolean) => void;
}

export default function BottomTimeline({ slices, setSlices, play, setPlay }: Props) {
  // drive axial advancement when playing
  useEffect(() => {
    if (!play) return;
    const id = setInterval(() => {
      setSlices((s) => {
        const next = s.axial + 1;
        return { ...s, axial: next > TOTAL ? 1 : next };
      });
    }, 28);
    return () => clearInterval(id);
  }, [play, setSlices]);

  const fillPct = (slices.axial / TOTAL) * 100;
  const currentBucket = Math.min(
    TIMELINE_LABELS.length - 1,
    Math.floor((slices.axial / TOTAL) * TIMELINE_LABELS.length)
  );

  return (
    <div className="syn-timeline syn-fadeup-strong" style={{ ['--syn-delay' as any]: '0.35s' }}>
      <button
        className="syn-tl-play"
        onClick={() => setPlay(!play)}
        title={play ? 'Pause sweep' : 'Play sweep'}
      >
        {play ? <IconPlayerPauseFilled size={14} /> : <IconPlayerPlayFilled size={14} />}
      </button>
      <div className="syn-tl-label">Volume Sweep</div>
      <div className="syn-tl-track">
        <input
          type="range"
          min={1}
          max={TOTAL}
          value={slices.axial}
          style={{ ['--fill' as any]: `${fillPct}%` }}
          onChange={(e) =>
            setSlices((s) => ({ ...s, axial: Number(e.target.value) }))
          }
        />
        <div className="syn-tl-marks">
          {TIMELINE_LABELS.map((label, i) => (
            <span key={label} className={i === currentBucket ? 'cur' : ''}>
              {label}
            </span>
          ))}
        </div>
      </div>
      <div className="syn-tl-readout">
        <div className="big">
          {String(slices.axial).padStart(3, '0')}/{TOTAL}
        </div>
        <div className="sm">Axial Slice</div>
      </div>
    </div>
  );
}
