import { useEffect, useRef } from 'react';
import { Group } from 'three';
import type { OrganId } from '../data/anatomyData';

interface Props {
  organId: OrganId;
  registerRoot: (group: Group | null) => void;
}

// Minimal placeholder. With his GLBs in /public/ this should rarely render.
export default function FallbackAnatomy({ organId: _organId, registerRoot }: Props) {
  const root = useRef<Group>(null);
  useEffect(() => {
    if (root.current) registerRoot(root.current);
    return () => registerRoot(null);
  }, [registerRoot]);

  return (
    <group ref={root}>
      <mesh>
        <sphereGeometry args={[1, 32, 32]} />
        <meshStandardMaterial
          color="#8a3b30"
          roughness={0.5}
          metalness={0.1}
          emissive="#3a1810"
          emissiveIntensity={0.25}
          transparent
        />
      </mesh>
      <mesh position={[0, -1.2, 0]}>
        <boxGeometry args={[0.6, 0.05, 0.6]} />
        <meshBasicMaterial color="#54d6ff" transparent opacity={0.3} />
      </mesh>
    </group>
  );
}
