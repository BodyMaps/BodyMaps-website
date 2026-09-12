import { useEffect, useState } from "react";
import { Enums, type Types } from "@cornerstonejs/core";
import { obliqueCamera } from "../../helpers/viewer/anatomyGeometry";
import type { Vec3 } from "../../helpers/utils";

export type PlaneMode = "off" | "axial" | "coronal" | "sagittal" | "all" | "oblique";

export function AnatomyControls({ mode, setMode, axial, activeViewport = axial, onReset, pivot }: {
  mode: PlaneMode; setMode: (mode: PlaneMode) => void;
  axial?: Types.IVolumeViewport; onReset: () => void;
  pivot?: Vec3 | null;
  activeViewport?: Types.IVolumeViewport;
}) {
  const [pitch, setPitch] = useState(0);
  const [roll, setRoll] = useState(0);
  const [slice, setSlice] = useState({ index: 0, count: 1 });
  useEffect(() => {
    if (!activeViewport) return;
    const update = () => setSlice({ index: activeViewport.getSliceIndex(), count: activeViewport.getNumberOfSlices() });
    activeViewport.element.addEventListener(Enums.Events.IMAGE_RENDERED, update);
    update();
    return () => activeViewport.element.removeEventListener(Enums.Events.IMAGE_RENDERED, update);
  }, [activeViewport]);
  const scroll = (delta: number) => { activeViewport?.scroll(delta); activeViewport?.render(); };
  const orient = (p: number, r: number) => {
    if (!axial) return;
    const camera = axial.getCamera();
    const focal = pivot ?? camera.focalPoint;
    if (!focal || !camera.position || !camera.focalPoint) return;
    const distance = Math.hypot(...camera.position.map((x, i) => x - camera.focalPoint![i]));
    axial.setCamera(obliqueCamera(p, r, focal as Vec3, distance));
    axial.render();
  };
  const changeMode = (next: PlaneMode) => {
    if (next === "oblique") orient(pitch, roll);
    else if (mode === "oblique") orient(0, 0);
    setMode(next);
  };
  return <details className="anatomy-controls">
    <summary className="vp-3dbar__btn">CT planes</summary>
    <div className="anatomy-controls__body">
      <label>CT planes <select value={mode} disabled={!axial} onChange={e => changeMode(e.target.value as PlaneMode)}>
        <option value="off">Hidden</option><option value="axial">Axial</option>
        <option value="coronal">Coronal</option><option value="sagittal">Sagittal</option>
        <option value="all">All three</option><option value="oblique">Oblique</option>
      </select></label>
      {mode !== "off" && <div className="anatomy-controls__steps">
        <span>Slice {slice.index + 1}/{slice.count}</span>
        <button aria-label="Previous anatomy slice" disabled={slice.index <= 0} onClick={() => scroll(-1)}>−</button>
        <button aria-label="Next anatomy slice" disabled={slice.index >= slice.count - 1} onClick={() => scroll(1)}>+</button>
      </div>}
      {mode !== "off" && <input aria-label="Anatomy slice position" type="range" min="0" max={Math.max(0, slice.count - 1)} value={slice.index} onChange={e => scroll(Number(e.target.value) - slice.index)} />}
      {mode === "oblique" && <>
        <label>Tilt L/R {pitch}° <input aria-label="Oblique tilt around left-right axis" type="range" min="-75" max="75" value={pitch} onChange={e => {
          const p = Number(e.target.value); setPitch(p); orient(p, roll);
        }} /></label>
        <label>Tilt A/P {roll}° <input aria-label="Oblique tilt around anterior-posterior axis" type="range" min="-75" max="75" value={roll} onChange={e => {
          const r = Number(e.target.value); setRoll(r); orient(pitch, r);
        }} /></label>
      </>}
      <button onClick={() => { setPitch(0); setRoll(0); orient(0, 0); setMode("axial"); onReset(); }}>Reset anatomy view</button>
      <p>Drag to rotate. Click an organ to focus it. Double-click a CT plane to move the linked crosshair. Scroll the CT panes to follow anatomy through the scan.</p>
    </div>
  </details>;
}
