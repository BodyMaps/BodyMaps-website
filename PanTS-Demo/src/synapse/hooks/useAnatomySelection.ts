import { useState, useRef, useCallback } from 'react';
import { ANATOMY, type OrganId, type SubStructure } from '../data/anatomyData';
import { VIEW_PRESETS, DEFAULT_CAMERA, type VisMode } from '../data/scanData';

export interface ViewerHandle {
  flyTo(camPos: [number, number, number], target: [number, number, number]): void;
  highlightMesh(meshName: string): void;
  highlightOrgan(): void; // highlights all loaded meshes
  clearHighlight(): void;
}

export interface SliceState {
  axial: number;
  sagittal: number;
  coronal: number;
}

export type SlicePlane = 'axial' | 'sagittal' | 'coronal';

export function useAnatomySelection() {
  const viewerRef = useRef<ViewerHandle | null>(null);

  const [selectedOrgan, setSelectedOrgan] = useState<OrganId | null>('liver'); // start on liver
  const [selectedSubKey, setSelectedSubKey] = useState<string | null>(null);
  const [selectedSubData, setSelectedSubData] = useState<SubStructure | null>(null);
  const [selectedMeshName, setSelectedMeshName] = useState<string | null>(null);

  const [mode, setMode] = useState<VisMode>('solid');
  const [autoRotate, setAutoRotate] = useState(true);
  const [slices, setSlices] = useState<SliceState>({ axial: 248, sagittal: 256, coronal: 256 });
  const [slicePlay, setSlicePlay] = useState(false);
  const [showPlanes, setShowPlanes] = useState(false);

  // Select an organ (loads its GLB) and fly the camera.
  const selectOrgan = useCallback((id: OrganId) => {
    if (!ANATOMY[id]) return;
    setSelectedOrgan(id);
    setSelectedSubKey(null);
    setSelectedSubData(null);
    setSelectedMeshName(null);
    if (viewerRef.current) {
      viewerRef.current.flyTo(ANATOMY[id].focus.cam, ANATOMY[id].focus.target);
    }
  }, []);

  // Called by the viewer when a specific mesh is clicked.
  const selectMesh = useCallback(
    (meshName: string, organId: OrganId, sub: { key: string; data: SubStructure } | null) => {
      setSelectedOrgan(organId);
      setSelectedMeshName(meshName);
      if (sub) {
        setSelectedSubKey(sub.key);
        setSelectedSubData(sub.data);
      } else {
        setSelectedSubKey(null);
        setSelectedSubData(null);
      }
      if (viewerRef.current) viewerRef.current.highlightMesh(meshName);
    },
    []
  );

  const setView = useCallback((viewId: string) => {
    const v = VIEW_PRESETS.find((p) => p.id === viewId);
    if (v && viewerRef.current) viewerRef.current.flyTo(v.cam, v.target);
  }, []);

  const resetView = useCallback(() => {
    if (viewerRef.current) {
      viewerRef.current.flyTo(DEFAULT_CAMERA.cam, DEFAULT_CAMERA.target);
      viewerRef.current.clearHighlight();
    }
    setSelectedSubKey(null);
    setSelectedSubData(null);
    setSelectedMeshName(null);
  }, []);

  const toggleAutoRotate = useCallback(() => setAutoRotate((v) => !v), []);

  const setSlice = useCallback((plane: SlicePlane, value: number) => {
    setSlices((s) => ({ ...s, [plane]: value }));
  }, []);

  return {
    viewerRef,
    selectedOrgan,
    selectedSubKey,
    selectedSubData,
    selectedMeshName,
    mode,
    setMode,
    autoRotate,
    setAutoRotate,
    toggleAutoRotate,
    slices,
    setSlice,
    setSlices,
    slicePlay,
    setSlicePlay,
    showPlanes,
    setShowPlanes,
    selectOrgan,
    selectMesh,
    setView,
    resetView,
  };
}

export type AnatomySelectionState = ReturnType<typeof useAnatomySelection>;
