import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { _roots } from '@react-three/fiber';
import type { RenderingEngine } from '@cornerstonejs/core';
import { SegmentationMeshViewer } from '../../src/components/viewer/MeshViewer';
import { renderVisualization, moveCornerstoneCrosshairToMm, subscribeToCrosshairChanges } from '../../src/helpers/CornerstoneNifti2';
import { segmentation_category_colors } from '../../src/helpers/constants';
import { captureMeshCanvas } from '../../src/helpers/viewer/meshCapture';
import type { MeshManifest } from '../../src/types';
import type { Vec3 } from '../../src/helpers/utils';

const api = 'http://127.0.0.1:5001';
function Scan({ caseId }: { caseId: string }) {
  const axial = useRef<HTMLDivElement>(null);
  const sagittal = useRef<HTMLDivElement>(null);
  const coronal = useRef<HTMLDivElement>(null);
  const [engine, setEngine] = useState<RenderingEngine | null>(null);
  const [point, setPoint] = useState<Vec3 | null>(null);
  const [center, setCenter] = useState<Vec3 | null>(null);
  const [error, setError] = useState('');
  const jump = (p: Vec3) => { moveCornerstoneCrosshairToMm(p); setPoint(p); };
  useEffect(() => {
    const controller = new AbortController();
    let dispose: (() => void) | undefined;
    const unsub = subscribeToCrosshairChanges(p => setPoint(p as Vec3));
    async function start() {
      const manifest: MeshManifest = await fetch(`${api}/${caseId}/manifest.json`, { signal: controller.signal }).then(r => r.json());
      const result = await renderVisualization(axial.current!, sagittal.current!, coronal.current!, Object.values(segmentation_category_colors), `${api}/${caseId}/ct.nii.gz`, undefined, () => {}, { signal: controller.signal });
      dispose = result.dispose;
      const centroid: Vec3 = [-manifest.center[0], manifest.center[2], manifest.center[1]];
      setEngine(result.renderingEngine); setCenter(centroid); jump(centroid);
      // Test-only diagnostics of the real renderers, never included in the app build.
      Object.assign(window, { anatomyTest: {
        engine: result.renderingEngine, jump, center: centroid, captureMeshCanvas,
        mesh: () => _roots.get(document.querySelector('canvas[data-bodymaps-3d]') as HTMLCanvasElement)?.store.getState(),
      } });
    }
    start().catch(e => { if (!controller.signal.aborted) setError(String(e)); });
    return () => { controller.abort(); unsub(); dispose?.(); };
  }, [caseId]);
  return <>
    <header style={{ padding: 10 }}>BodyMaps · Real CT / organ geometry verification <strong role="alert">{error}</strong> <output>{point?.map(x => x.toFixed(1)).join(', ')}</output></header>
    <main style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '43vh 43vh', gap: 4 }}>
      <div style={{ position: 'relative', minHeight: 0 }}><SegmentationMeshViewer caseId={caseId} loading={!engine} checkState={Array(40).fill(true)} opacity={85} crosshairMm={point} renderingEngine={engine} onPickPoint={jump} onSelectOrgan={() => { if (center) jump(center); }} /></div>
      <div ref={axial} style={{ position: 'relative' }} /><div ref={sagittal} style={{ position: 'relative' }} /><div ref={coronal} style={{ position: 'relative' }} />
    </main>
  </>;
}
function App() {
  const [caseId, setCaseId] = useState('fixture');
  return <><button onClick={() => setCaseId(id => id === 'fixture' ? 'fixture-b' : 'fixture')}>Switch fixture case</button><Scan key={caseId} caseId={caseId} /></>;
}
createRoot(document.getElementById('root')!).render(<App />);
