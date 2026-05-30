import {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
  useEffect,
  useCallback,
  Suspense,
} from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Environment } from '@react-three/drei';
import {
  ACESFilmicToneMapping,
  Group,
  Mesh,
  MeshStandardMaterial,
  Color,
} from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';

import FallbackAnatomy from './FallbackAnatomy';
import GLBAnatomy from './GLBAnatomy';
import ScanPlatform from './ScanPlatform';
import SlicePlanes from './SlicePlanes';
import CameraRig, { type CameraRigHandle } from './CameraRig';
import { DEFAULT_CAMERA, type VisMode } from '../data/scanData';
import {
  ANATOMY,
  type OrganId,
  type SubStructure,
  subStructureForMeshName,
} from '../data/anatomyData';
import type { ViewerHandle, SliceState } from '../hooks/useAnatomySelection';

interface Props {
  organId: OrganId;
  mode: VisMode;
  slices: SliceState;
  slicePlay: boolean;
  showPlanes: boolean;
  autoRotate: boolean;
  onPickMesh: (
    meshName: string,
    organId: OrganId,
    sub: { key: string; data: SubStructure } | null
  ) => void;
  onSlicePlayTick: (idx: number) => void;
  onFallbackChange: (usingFallback: boolean) => void;
}

// Verify a GLB is reachable (not just a SPA index.html fallback) before mounting useGLTF.
function useModelExists(url: string) {
  const [state, setState] = useState<'checking' | 'present' | 'absent'>('checking');
  useEffect(() => {
    let alive = true;
    setState('checking');
    fetch(url, { method: 'HEAD' })
      .then((res) => {
        if (!alive) return;
        const type = res.headers.get('content-type') || '';
        const ok = res.ok && !type.includes('text/html');
        setState(ok ? 'present' : 'absent');
      })
      .catch(() => alive && setState('absent'));
    return () => {
      alive = false;
    };
  }, [url]);
  return state;
}

const AnatomyViewer = forwardRef<ViewerHandle, Props>(function AnatomyViewer(props, ref) {
  const {
    organId,
    mode,
    slices,
    slicePlay,
    showPlanes,
    autoRotate,
    onPickMesh,
    onSlicePlayTick,
    onFallbackChange,
  } = props;

  const controlsRef = useRef<OrbitControlsImpl>(null);
  const rigRef = useRef<CameraRigHandle>(null);
  const modelRoot = useRef<Group | null>(null);
  const highlighted = useRef<Mesh[]>([]);

  const glbState = useModelExists(ANATOMY[organId].glbPath);
  const usingFallback = glbState === 'absent';

  useEffect(() => {
    if (glbState !== 'checking') onFallbackChange(usingFallback);
  }, [glbState, usingFallback, onFallbackChange]);

  const registerRoot = useCallback(
    (g: Group | null) => {
      modelRoot.current = g;
      applyMode(mode);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // ---- mode engine ----
  function applyMode(m: VisMode) {
    const root = modelRoot.current;
    if (!root) return;
    root.traverse((obj) => {
      if (!(obj instanceof Mesh)) return;
      const mat = obj.material as MeshStandardMaterial;
      if (!mat || !mat.userData?.baseColor) return;
      const base = mat.userData.baseColor as Color;
      const baseE = mat.userData.baseEmissive as Color;
      const baseEi = mat.userData.baseEmissiveIntensity as number;
      const section = mat.userData.sectionColor as Color;

      mat.wireframe = false;
      mat.color.copy(base);
      mat.emissive.copy(baseE);
      mat.emissiveIntensity = baseEi;
      mat.transparent = true;
      mat.depthWrite = true;
      mat.opacity = 1;
      mat.visible = true;

      if (m === 'solid') {
        // defaults
      } else if (m === 'translucent') {
        mat.opacity = 0.45;
        mat.depthWrite = false;
      } else if (m === 'xray') {
        mat.opacity = 0.35;
        mat.depthWrite = false;
        mat.emissive.copy(base);
        mat.emissiveIntensity = 0.75;
      } else if (m === 'sections') {
        mat.color.copy(section);
        mat.emissive.copy(section);
        mat.emissiveIntensity = 0.25;
      } else if (m === 'slices') {
        mat.opacity = 0.35;
        mat.depthWrite = false;
      } else if (m === 'wireframe') {
        mat.wireframe = true;
        mat.color.copy(section);
        mat.emissive.copy(section);
        mat.emissiveIntensity = 0.4;
      }
      mat.needsUpdate = true;
    });
    // re-apply any active highlight on top of the new base
    highlighted.current.forEach((h) => {
      const m2 = h.material as MeshStandardMaterial;
      m2.emissiveIntensity = 0.95;
    });
  }

  useEffect(() => {
    applyMode(mode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, organId]);

  // ---- highlight ----
  const clearHighlight = useCallback(() => {
    highlighted.current.forEach((m) => {
      const mat = m.material as MeshStandardMaterial;
      if (mat?.userData?.baseEmissiveIntensity !== undefined) {
        mat.emissiveIntensity = mat.userData.baseEmissiveIntensity;
      }
    });
    highlighted.current = [];
  }, []);

  const highlightMesh = useCallback(
    (meshName: string) => {
      clearHighlight();
      if (!modelRoot.current) return;
      const lc = meshName.toLowerCase();
      modelRoot.current.traverse((obj) => {
        if (!(obj instanceof Mesh)) return;
        const mn = (obj.userData.meshName as string)?.toLowerCase() || '';
        if (mn === lc) {
          const mat = obj.material as MeshStandardMaterial;
          mat.emissiveIntensity = 0.95;
          highlighted.current.push(obj);
        }
      });
    },
    [clearHighlight]
  );

  const highlightOrgan = useCallback(() => {
    clearHighlight();
    if (!modelRoot.current) return;
    modelRoot.current.traverse((obj) => {
      if (!(obj instanceof Mesh)) return;
      const mat = obj.material as MeshStandardMaterial;
      mat.emissiveIntensity = 0.6;
      highlighted.current.push(obj);
    });
  }, [clearHighlight]);

  // pulse highlighted meshes
  useEffect(() => {
    let raf: number;
    const loop = () => {
      const t = performance.now() * 0.005;
      highlighted.current.forEach((o) => {
        const mat = o.material as MeshStandardMaterial;
        if (mat) mat.emissiveIntensity = 0.7 + Math.sin(t) * 0.25;
      });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // expose imperative API
  useImperativeHandle(
    ref,
    () => ({
      flyTo: (cam, target) => rigRef.current?.flyTo(cam, target),
      highlightMesh,
      highlightOrgan,
      clearHighlight,
    }),
    [highlightMesh, highlightOrgan, clearHighlight]
  );

  // wrap onPickMesh so the substructure match is computed here (single source of truth)
  const handlePick = useCallback(
    (meshName: string, orgId: OrganId, _sub: ReturnType<typeof subStructureForMeshName>) => {
      const sub = subStructureForMeshName(orgId, meshName);
      onPickMesh(meshName, orgId, sub);
      highlightMesh(meshName);
    },
    [onPickMesh, highlightMesh]
  );

  return (
    <Canvas
      camera={{ position: DEFAULT_CAMERA.cam, fov: 38, near: 0.1, far: 100 }}
      gl={{ antialias: true, alpha: true }}
      onCreated={({ gl }) => {
        gl.toneMapping = ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.15;
      }}
      style={{ position: 'absolute', inset: 0 }}
    >
      <ambientLight intensity={0.6} color="#3a5070" />
      <directionalLight position={[4, 6, 5]} intensity={1.5} color="#bfe4ff" />
      <directionalLight position={[-5, 2, -4]} intensity={1.1} color="#54d6ff" />
      <pointLight position={[-3, -1, 4]} intensity={0.9} color="#f0b860" />
      <pointLight position={[0, 3, -3]} intensity={0.7} color="#4a9eff" />
      <Environment preset="city" />

      <Suspense fallback={null}>
        {glbState === 'present' ? (
          <GLBAnatomy
            key={organId}
            organId={organId}
            onPickMesh={handlePick}
            registerRoot={registerRoot}
          />
        ) : glbState === 'absent' ? (
          <FallbackAnatomy organId={organId} registerRoot={registerRoot} />
        ) : null}
      </Suspense>

      <ScanPlatform />
      <SlicePlanes
        visible={showPlanes || mode === 'slices'}
        slices={slices}
        play={slicePlay}
        onPlayTick={onSlicePlayTick}
      />

      <CameraRig ref={rigRef} controlsRef={controlsRef} />
      <OrbitControls
        ref={controlsRef}
        enableDamping
        dampingFactor={0.06}
        minDistance={1.0}
        maxDistance={12}
        target={DEFAULT_CAMERA.target}
        autoRotate={autoRotate}
        autoRotateSpeed={0.6}
      />
    </Canvas>
  );
});

export default AnatomyViewer;
