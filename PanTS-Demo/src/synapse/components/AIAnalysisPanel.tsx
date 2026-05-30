import { useState, useEffect } from 'react';
import { IconChevronDown } from '@tabler/icons-react';
import { ANALYSIS_STATS } from '../data/scanData';

interface Props {
  defaultOpen?: boolean;
}

export default function AIAnalysisPanel({ defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div
      className="syn-card syn-fadeup"
      style={{ ['--syn-delay' as any]: '0.18s' }}
    >
      <div
        className={'syn-collapse-head' + (open ? ' open' : '')}
        onClick={() => setOpen((v) => !v)}
      >
        <div className="syn-ctitle">AI Analysis</div>
        <IconChevronDown className="chev" size={16} />
      </div>
      <div className={'syn-collapsible' + (open ? ' open' : '')}>
        <div>
          <div className="syn-collapse-body">
            {ANALYSIS_STATS.map((s) => (
              <Conf key={s.id} label={s.label} value={s.value} active={open} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Conf({ label, value, active }: { label: string; value: number; active: boolean }) {
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!active) { setW(0); return; }
    const t = setTimeout(() => setW(value), 200);
    return () => clearTimeout(t);
  }, [value, active]);
  return (
    <div className="syn-conf">
      <div className="top">
        <span>{label}</span>
        <b>{value}%</b>
      </div>
      <div className="syn-bar">
        <i style={{ width: `${w}%` }} />
      </div>
    </div>
  );
}
