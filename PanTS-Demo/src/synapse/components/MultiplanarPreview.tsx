import { useEffect, useRef } from 'react';
import { SCAN_SUMMARY } from '../data/scanData';
import type { SliceState } from '../hooks/useAnatomySelection';

const TOTAL = SCAN_SUMMARY.images;

type Plane = 'axial' | 'sagittal' | 'coronal';

function CTCanvas({ plane, index }: { plane: Plane; index: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const W = (cv.width = 120);
    const H = (cv.height = 120);
    const depth = index / TOTAL;
    const img = ctx.createImageData(W, H);
    const cx = W / 2;
    const cy = H / 2;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const dx = (x - cx) / cx;
        const dy = (y - cy) / cy;
        const r = Math.sqrt(dx * dx + dy * dy);
        let v: number;
        const bodyR = plane === 'axial' ? 0.82 : 0.7;
        if (r < bodyR) {
          v = 28 + 18 * Math.sin((x + depth * 40) * 0.3) * Math.cos(y * 0.25);
          if (r > bodyR - 0.12) v = 150 + Math.random() * 60;
          const ph = depth * 6;
          const b1 = Math.hypot(dx - 0.25 * Math.sin(ph), dy + 0.1);
          const b2 = Math.hypot(dx + 0.3, dy - 0.2 * Math.cos(ph));
          const b3 = Math.hypot(dx - 0.05, dy + 0.3);
          if (b1 < 0.25) v = 90 + 40 * (1 - b1 / 0.25);
          if (b2 < 0.22) v = 70 + 50 * (1 - b2 / 0.22);
          if (b3 < 0.18) v = 110 + 30 * (1 - b3 / 0.18);
          if (plane !== 'axial' && Math.abs(dx) < 0.08 && dy > 0) v = 180 + Math.random() * 40;
          if (plane === 'axial' && Math.hypot(dx, dy + 0.55) < 0.1) v = 190;
          v += Math.random() * 14 - 7;
        } else {
          v = 4 + Math.random() * 4;
        }
        v = Math.max(0, Math.min(255, v));
        const i = (y * W + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    ctx.strokeStyle = 'rgba(84,214,255,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, cy);
    ctx.lineTo(W, cy);
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx, H);
    ctx.stroke();
  }, [plane, index]);
  return <canvas ref={ref} />;
}

interface Props {
  slices: SliceState;
}

export default function MultiplanarPreview({ slices }: Props) {
  return (
    <div className="syn-card syn-fadeup" style={{ ['--syn-delay' as any]: '0.1s' }}>
      <div className="live">
        <i />
        LIVE
      </div>
      <div className="syn-ctitle">Multiplanar CT Preview</div>
      <div className="syn-ct-row">
        <div className="syn-ct-win">
          <CTCanvas plane="axial" index={slices.axial} />
          <span className="lbl">AXIAL</span>
          <span className="sl">{slices.axial}</span>
        </div>
        <div className="syn-ct-win">
          <CTCanvas plane="sagittal" index={slices.sagittal} />
          <span className="lbl">SAGITTAL</span>
          <span className="sl">{slices.sagittal}</span>
        </div>
        <div className="syn-ct-win">
          <CTCanvas plane="coronal" index={slices.coronal} />
          <span className="lbl">CORONAL</span>
          <span className="sl">{slices.coronal}</span>
        </div>
      </div>
    </div>
  );
}
