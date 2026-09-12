import { useGLTF } from "@react-three/drei";
import type { Color } from "@cornerstonejs/core/types";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { segmentation_category_colors } from '../../helpers/constants';
import type { OrganMeshInfo } from "../../types";
type OrganMeshProps = {
  organ: OrganMeshInfo;
  visible: boolean;
  opacity?: number;
  color?: Color;
  onSelect?: () => void;
};

export const rgbToHex = (r: number, g: number, b: number, _a: number) => 
  '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');

export function OrganMesh({ organ, visible, opacity = 1, color, onSelect }: OrganMeshProps) {
  const gltf = useGLTF(organ.url);
  const object = useMemo(() => {
    return gltf.scene.clone(true);
  }, [gltf.scene]);

  useEffect(() => {
    const createdMaterials: THREE.Material[] = [];
    object.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      
      const material = new THREE.MeshStandardMaterial({
        color: new THREE.Color(rgbToHex(...(color ?? segmentation_category_colors[organ.id]))),
        roughness: 0.75,
        metalness: 0.0,
        transparent: opacity < 1,
        opacity,
        depthWrite: opacity >= 1,
        side: THREE.DoubleSide,
      });
      child.material = material;
      createdMaterials.push(material);

      child.frustumCulled = true;
    });
    return () => {
      for (const material of createdMaterials) material.dispose();
    };
  }, [object, organ.id, opacity, color]);

  return <primitive object={object} visible={visible} onClick={(event: import("@react-three/fiber").ThreeEvent<MouseEvent>) => {
    if (event.delta > 3) return;
    event.stopPropagation();
    onSelect?.();
  }} />;
}
