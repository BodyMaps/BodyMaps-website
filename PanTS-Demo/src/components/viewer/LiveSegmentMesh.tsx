import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { Color } from "@cornerstonejs/core/types";
import { extractSegmentSurface } from "../../helpers/CornerstoneNifti2";

type LiveSegmentMeshProps = {
  segmentIndex: number;
  /** Settled labelmap revision; changing it rebuilds the live surface once. */
  maskRevision?: number;
  color: Color;
  visible: boolean;
  opacity: number;
  manifestCenter: [number, number, number];
};

// Client-side isosurface for a custom or edited class, rebuilt after a settled
// labelmap edit. Positioned in
// the same Three.js scene space as the pre-baked organ GLBs (see
// extractSegmentSurface's transform comments).
//
// useEditedCatalogIds debounces edits before changing maskRevision, avoiding
// marching-cubes work in the middle of a brush drag while keeping the settled
// 3D surface aligned with the 2D labelmap.
export function LiveSegmentMesh({
  segmentIndex,
  maskRevision = 0,
  color,
  visible,
  opacity,
  manifestCenter,
}: LiveSegmentMeshProps) {
  const surface = useMemo(() => {
    return extractSegmentSurface(segmentIndex, manifestCenter);
  }, [segmentIndex, manifestCenter, maskRevision]);

  const geometry = useMemo(() => {
    if (!surface) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(surface.positions, 3));
    geo.setIndex(new THREE.BufferAttribute(surface.indices, 1));
    geo.computeVertexNormals();
    return geo;
  }, [surface]);

  useEffect(() => () => geometry?.dispose(), [geometry]);

  // Nothing painted yet for this class (extractSegmentSurface returns null
  // when the mask is empty) — nothing to show, but don't throw.
  if (!geometry) return null;

  const [r, g, b, a = 255] = color;

  return (
    <mesh geometry={geometry} visible={visible}>
      <meshStandardMaterial
        color={new THREE.Color(r / 255, g / 255, b / 255)}
        transparent
        opacity={opacity * (a / 255)}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}
