import { useEffect, useMemo, useState } from "react";
import { Enums, type Types } from "@cornerstonejs/core";
import { useThree } from "@react-three/fiber";
import { Html, Line } from "@react-three/drei";
import * as THREE from "three";
import { cornerstoneLpsMmToThree, type Vec3 } from "../../helpers/utils";
import { threeToLps } from "../../helpers/viewer/anatomyGeometry";

export type SliceSource = { name: string; viewport: Types.IVolumeViewport; color: string };

function SlicePlane({ source, center, onPick }: {
  source: SliceSource; center: Vec3; onPick?: (point: Vec3) => void;
}) {
  const invalidate = useThree(state => state.invalidate);
  const [corners, setCorners] = useState<Vec3[] | null>(null);
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    const result = new THREE.CanvasTexture(canvas);
    result.colorSpace = THREE.SRGBColorSpace;
    result.minFilter = THREE.LinearFilter;
    result.generateMipmaps = false;
    return result;
  }, []);
  const geometry = useMemo(() => {
    const result = new THREE.BufferGeometry();
    result.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(12), 3));
    // canvasToWorld uses top-left origin, while texture UVs use bottom-left.
    result.setAttribute("uv", new THREE.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2));
    result.setIndex([0, 1, 2, 0, 2, 3]);
    return result;
  }, []);

  useEffect(() => {
    const viewport = source.viewport;
    let frame = 0;
    const update = () => {
      const canvas = viewport.getCanvas();
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (!width || !height || !canvas.width || !canvas.height) return;
      const points = ([[0, 0], [width, 0], [width, height], [0, height]] as [number, number][])
        .map(p => cornerstoneLpsMmToThree(viewport.canvasToWorld(p) as Vec3, center));
      const target = texture.image as HTMLCanvasElement;
      const scale = Math.min(1, 768 / Math.max(canvas.width, canvas.height));
      const w = Math.max(1, Math.round(canvas.width * scale));
      const h = Math.max(1, Math.round(canvas.height * scale));
      if (target.width !== w || target.height !== h) { target.width = w; target.height = h; }
      target.getContext("2d")?.drawImage(canvas, 0, 0, w, h);
      texture.needsUpdate = true;
      (geometry.getAttribute("position") as THREE.BufferAttribute).copyArray(new Float32Array(points.flat()));
      geometry.getAttribute("position").needsUpdate = true;
      geometry.computeBoundingSphere();
      setCorners(points);
      invalidate();
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    viewport.element.addEventListener(Enums.Events.IMAGE_RENDERED, schedule);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      viewport.element.removeEventListener(Enums.Events.IMAGE_RENDERED, schedule);
    };
  }, [source.viewport, center, texture, geometry, invalidate]);

  useEffect(() => () => { texture.dispose(); geometry.dispose(); }, [texture, geometry]);
  if (!corners) return null;
  return <group>
    <mesh geometry={geometry} onDoubleClick={event => {
      event.stopPropagation();
      onPick?.(threeToLps(event.point.toArray() as Vec3, center));
    }}>
      <meshBasicMaterial map={texture} side={THREE.DoubleSide} toneMapped={false} polygonOffset polygonOffsetFactor={1} polygonOffsetUnits={1} />
    </mesh>
    <Line points={[...corners, corners[0]]} color={source.color} lineWidth={1.5} />
    <Html position={corners[0]} style={{ pointerEvents: "none" }}>
      <span className="anatomy-plane-label" style={{ color: source.color }}>{source.name}</span>
    </Html>
  </group>;
}

export function LinkedSlicePlanes({ sources, center, onPick }: {
  sources: SliceSource[]; center: Vec3; onPick?: (point: Vec3) => void;
}) {
  return sources.map(source => <SlicePlane key={source.viewport.id} source={source} center={center} onPick={onPick} />);
}
