import { Bounds, OrbitControls, GizmoHelper, GizmoViewcube, Edges } from "@react-three/drei";
import type { RenderingEngine, Types } from "@cornerstonejs/core";
import { LinkedSlicePlanes, type SliceSource } from "./LinkedSlicePlanes";
import { AnatomyControls, type PlaneMode } from "./AnatomyControls";
import "./anatomy.css";
import { Canvas } from "@react-three/fiber";
import { registerMeshRoot } from "../../helpers/viewer/meshCapture";
import { Suspense, useEffect, useMemo, useState } from "react";
import { APP_CONSTANTS } from "../../helpers/constants";
import { cornerstoneLpsMmToThree, type Vec3 } from "../../helpers/utils";
import type { MeshManifest } from "../../types";
import { OrganMesh } from "./OrganMesh";
import { SceneCrosshair3D } from "./SceneCrosshair3D";
import type { Color } from "@cornerstonejs/core/types";
import { LiveSegmentMesh } from "./LiveSegmentMesh";
import type { CheckBoxData } from "../../types";
import ErrorBoundary from "../ErrorBoundary";

// Stable identity avoids recreating the cube's six canvas textures on every slice change.
const PATIENT_FACES = ["R", "L", "S", "I", "P", "A"];

type SegmentationMeshViewerProps = {
  caseId: string;
  loading: boolean
  checkState: boolean[];
  opacity: number;
  crosshairMm: Vec3 | null
  customOrgans?: CheckBoxData[];
  labelColorMap?: { [key: number]: Color };
  // Uploaded scans have no pre-baked meshes; fetch from the session route, which
  // builds them on demand from the session's combined_labels.
  isSession?: boolean;
  renderingEngine?: RenderingEngine | null;
  onPickPoint?: (point: Vec3) => void;
  onSelectOrgan?: (id: number) => void;
  focusedOrgan?: number | null;
  onClearFocus?: () => void;
};

export async function fetchMeshManifest(caseId: string, isSession = false): Promise<MeshManifest> {
  const base = isSession
    ? `${APP_CONSTANTS.API_ORIGIN}/api/sessions/${caseId}/mesh-manifest`
    : `${APP_CONSTANTS.API_ORIGIN}/api/cases/${caseId}/mesh-manifest`;
  const res = await fetch(base);
  if (!res.ok) throw new Error(`Failed to fetch mesh manifest: ${res.status}`);
  const data = await res.json() as Partial<MeshManifest>;
  if (!Array.isArray(data.organs) || !Array.isArray(data.center)) {
    throw new Error("Mesh manifest response is invalid");
  }
  return data as MeshManifest;
}

export function SegmentationMeshViewer({ caseId, checkState, loading, opacity, crosshairMm, customOrgans = [], labelColorMap = {}, isSession = false, renderingEngine, onPickPoint, onSelectOrgan, focusedOrgan, onClearFocus }: SegmentationMeshViewerProps) {
  const [manifest, setManifest] = useState<MeshManifest | null>(null);
  const [manifestError, setManifestError] = useState(false);
  const [loaded, setLoaded] = useState<Record<number, boolean>>({});
  const [planeMode, setPlaneMode] = useState<PlaneMode>("axial");
  const [localFocus, setSelectedOrgan] = useState<number | null>(null);
  const selectedOrgan = focusedOrgan === undefined ? localFocus : focusedOrgan;
  const clearFocus = () => { setSelectedOrgan(null); onClearFocus?.(); };
  const [resetCount, setResetCount] = useState(0);
  const sources = useMemo(() => {
    if (!renderingEngine || loading) return [];
    return [
      ["CT_NIFTI_AXIAL", "Axial", "#75d8cc"],
      ["CT_NIFTI_CORONAL", "Coronal", "#edbc71"],
      ["CT_NIFTI_SAGITTAL", "Sagittal", "#a8b9ff"],
    ].flatMap(([id, name, color]) => {
      const viewport = renderingEngine.getViewport(id) as Types.IVolumeViewport | undefined;
      return viewport ? [{ name, color, viewport }] : [];
    });
  }, [renderingEngine, loading]);
  const volumeBox = useMemo(() => {
    if (!manifest || !sources[0]) return null;
    const b = sources[0].viewport.getBounds();
    if (b.length !== 6 || !b.every(Number.isFinite)) return null;
    const a = cornerstoneLpsMmToThree([b[0], b[2], b[4]], manifest.center);
    const z = cornerstoneLpsMmToThree([b[1], b[3], b[5]], manifest.center);
    return { position: a.map((v, i) => (v + z[i]) / 2) as Vec3, size: a.map((v, i) => Math.abs(z[i] - v)) as Vec3 };
  }, [manifest, sources]);
  const activeSource = sources.find(source => source.name.toLowerCase() === planeMode) ?? sources[0];
  const visibleSources: SliceSource[] = planeMode === "off" ? [] : planeMode === "all" ? sources : activeSource ? [{ ...activeSource, name: planeMode === "oblique" ? "Oblique" : activeSource.name }] : [];

  // Drop the renderer handle when this pane goes away, so a capture can never
  // reach into a disposed WebGL context.
  useEffect(() => () => registerMeshRoot(null), []);

  const crosshairPosition = useMemo(() => {
    if (!manifest || !crosshairMm) return null;
    return cornerstoneLpsMmToThree(crosshairMm, manifest.center);
  }, [manifest, crosshairMm]);

  useEffect(() => {
    let alive = true;
    setManifest(null);
    setManifestError(false);
    fetchMeshManifest(caseId, isSession)
      .then((data) => {
        if (!alive) return;
        setManifest(data);
        const initialLoaded: Record<number, boolean> = {};
        for (const organ of data.organs) initialLoaded[organ.id] = true;
        setLoaded(initialLoaded);
      })
      .catch(() => { if (alive) setManifestError(true); });
    return () => { alive = false; };
  }, [caseId, isSession]);

  const organs = useMemo(() => manifest?.organs ?? [], [manifest]);

  if (manifestError) return <div role="alert">3D segmentation unavailable.</div>;
  if (!manifest || loading || !checkState || checkState.length === 0) {
    return <div>Loading 3D segmentation...</div>;
  }
  return (
    <div style={{ display: "flex", width: "100%", height: "100%", position: "relative" }}>
      <AnatomyControls mode={planeMode} setMode={setPlaneMode} axial={sources[0]?.viewport} activeViewport={activeSource?.viewport} pivot={crosshairMm} onReset={() => { clearFocus(); setResetCount(n => n + 1); }} />
      {selectedOrgan !== null && <div className="anatomy-focus" role="status">
        {organs.find(o => o.id === selectedOrgan)?.name ?? customOrgans.find(o => o.id === selectedOrgan)?.label}
        <button onClick={clearFocus}>Clear focus</button>
      </div>}
      <main style={{ flex: 1, minWidth: 0 }}>
        {/*
          preserveDrawingBuffer is REQUIRED for the AI assistant's snapshots.
          WebGL clears the drawing buffer as soon as the frame is composited, so
          without it canvas.toDataURL() reads an already-cleared buffer and the
          captured "3D view" is a black rectangle. data-bodymaps-3d marks the
          canvas so the capture helper picks this one and never an unrelated
          canvas that happens to sit in the same pane.
        */}
        <ErrorBoundary fallback={<div className="vp-3d-empty">3D segmentation unavailable.</div>}>
        <Canvas
          key={resetCount}
          camera={{ position: [0, 250, 650], fov: 45, near: 0.1, far: 5000 }}
          gl={{ preserveDrawingBuffer: true, antialias: true }}
          frameloop="always"
          onCreated={(state) => {
            registerMeshRoot(state);
            state.gl.domElement.setAttribute("data-bodymaps-3d", "1");
          }}
        >
          <color attach="background" args={["#050505"]} />
          <ambientLight intensity={0.7} />
          <directionalLight position={[300, 500, 300]} intensity={1.2} />
          <Suspense fallback={null}>
            <Bounds fit clip observe margin={1.2}>
              <group>
                {volumeBox && <mesh position={volumeBox.position} raycast={() => null}>
                  <boxGeometry args={volumeBox.size} />
                  <meshBasicMaterial transparent opacity={0} depthWrite={false} />
                  <Edges color="#608391" transparent opacity={0.3} />
                </mesh>}
                {organs.map((organ) => {
                  if (!loaded[organ.id]) return null;
                  // Always render the pre-baked GLB, even after this organ
                  // has been edited. Switching to a live marching-cubes
                  // mesh (LiveSegmentMesh) the instant an edit lands was
                  // both expensive (isosurface extraction on the stroke
                  // that triggers the switch — visible as a lag spike
                  // right on the first brush stroke) and unnecessary: the
                  // 3D pane is meant to show the original mesh, not a
                  // live reconstruction of in-progress annotations, so
                  // there's nothing gained by ever recomputing it here.
                  // Custom classes (no baked GLB to fall back to) still go
                  // through LiveSegmentMesh below, since that's the only
                  // way they can be shown in 3D at all.
                  return (
                    <OrganMesh
                      key={organ.id}
                      organ={organ}
                      visible={!!checkState[organ.id]}
                      opacity={selectedOrgan === null ? opacity/100 : selectedOrgan === organ.id ? 1 : Math.min(opacity/100, 0.12)}
                      color={labelColorMap[organ.id]}
                      onSelect={() => { setSelectedOrgan(organ.id); onSelectOrgan?.(organ.id); }}
                    />
                  );
                })}
                {customOrgans.map((organ) => (
                  <LiveSegmentMesh
                    key={organ.id}
                    segmentIndex={organ.id}
                    color={labelColorMap[organ.id] ?? [255, 255, 255, 255]}
                    visible={!!checkState[organ.id]}
                    opacity={selectedOrgan === null ? opacity / 100 : selectedOrgan === organ.id ? 1 : Math.min(opacity / 100, 0.12)}
                    onSelect={() => { setSelectedOrgan(organ.id); onSelectOrgan?.(organ.id); }}
                    manifestCenter={manifest.center as [number, number, number]}
                  />
                ))}
              </group>
            </Bounds>
            <LinkedSlicePlanes sources={visibleSources} center={manifest.center} onPick={onPickPoint} />
            {crosshairPosition && manifest.bounds && (
              <SceneCrosshair3D position={crosshairPosition} bounds={manifest.bounds} />
            )}
          </Suspense>
          <OrbitControls makeDefault />
          <GizmoHelper alignment="bottom-right" margin={[50, 80]}>
            <GizmoViewcube faces={PATIENT_FACES} />
          </GizmoHelper>
        </Canvas>
        </ErrorBoundary>
      </main>
    </div>
  );
}
