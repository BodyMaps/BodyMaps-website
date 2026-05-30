import { useEffect, useMemo, useRef } from 'react';
import { useGLTF } from '@react-three/drei';
import { Color, Group, Mesh, MeshStandardMaterial } from 'three';
import {
  ANATOMY,
  type OrganId,
  organForMeshName,
  subStructureForMeshName,
} from '../data/anatomyData';

interface Props {
  organId: OrganId;
  onPickMesh: (
    meshName: string,
    organId: OrganId,
    sub: ReturnType<typeof subStructureForMeshName>
  ) => void;
  registerRoot: (group: Group | null) => void;
}

// Colors used in Sections mode — cycled across sub-structures of the loaded organ.
const SECTION_PALETTE = [
  '#54d6ff', '#f0b860', '#5fe3a1', '#ff6b6b', '#9fb6d4',
  '#7fe3ff', '#ffd089', '#b58bff', '#ffa07a', '#86d9c6',
  '#e09bff', '#ffb86c', '#90caff', '#ffd58a', '#a8e6cf',
];

export default function GLBAnatomy({ organId, onPickMesh, registerRoot }: Props) {
  const path = ANATOMY[organId].glbPath;
  const { scene } = useGLTF(path);
  const root = useRef<Group>(null);

  // Clone to isolate from useGLTF's cache (HMR-safe).
  const cloned = useMemo(() => scene.clone(true), [scene]);

  useEffect(() => {
    // Tag every mesh with userData.anatomy + assign a section index for color modes.
    let sectionIdx = 0;
    cloned.traverse((obj) => {
      if (!(obj instanceof Mesh)) return;
      const meshName = obj.name || '';
      const orgFromMesh = organForMeshName(meshName) || organId;
      obj.userData.anatomy = orgFromMesh;
      obj.userData.meshName = meshName;
      obj.userData.sectionColor = SECTION_PALETTE[sectionIdx % SECTION_PALETTE.length];
      sectionIdx++;
      // Re-create material as MeshStandardMaterial we can manipulate freely.
      const oldMat = obj.material as MeshStandardMaterial | MeshStandardMaterial[];
      const sourceColor =
        Array.isArray(oldMat) ? new Color('#c08070') :
        oldMat?.color instanceof Color ? oldMat.color.clone() :
        new Color('#c08070');
      const newMat = new MeshStandardMaterial({
        color: sourceColor,
        roughness: 0.5,
        metalness: 0.08,
        emissive: new Color('#3a1810'),
        emissiveIntensity: 0.18,
        transparent: true,
        opacity: 1,
      });
      newMat.userData.baseColor = sourceColor.clone();
      newMat.userData.baseEmissive = newMat.emissive.clone();
      newMat.userData.baseEmissiveIntensity = newMat.emissiveIntensity;
      newMat.userData.sectionColor = new Color(obj.userData.sectionColor);
      obj.material = newMat;
    });

    if (root.current) registerRoot(root.current);
    return () => registerRoot(null);
  }, [cloned, organId, registerRoot]);

  const handleClick = (e: any) => {
    e.stopPropagation();
    const mesh = e.object as Mesh | undefined;
    if (!mesh) return;
    const meshName = (mesh.userData.meshName as string) || mesh.name || '';
    const orgId = (mesh.userData.anatomy as OrganId) || organId;
    const sub = subStructureForMeshName(orgId, meshName);
    onPickMesh(meshName, orgId, sub);
  };

  return (
    <group ref={root} onClick={handleClick}>
      <primitive object={cloned} />
    </group>
  );
}

// Preload all five so switching is instant after the first paint.
useGLTF.preload('/3d-liver.glb');
useGLTF.preload('/3d-kidney.glb');
useGLTF.preload('/3d-lung.glb');
useGLTF.preload('/3d-pancreas.glb');
useGLTF.preload('/3d-colon.glb');
