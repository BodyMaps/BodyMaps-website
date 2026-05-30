import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Mesh, DoubleSide } from 'three';

interface Props {
  yOffset?: number;
}

export default function ScanPlatform({ yOffset = -1.6 }: Props) {
  const ring2 = useRef<Mesh>(null);
  useFrame((_, dt) => {
    if (ring2.current) ring2.current.rotation.z += dt * 0.3;
  });

  return (
    <group position={[0, yOffset, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.0, 1.5, 64]} />
        <meshBasicMaterial color="#54d6ff" transparent opacity={0.12} side={DoubleSide} />
      </mesh>
      <mesh ref={ring2} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]}>
        <ringGeometry args={[1.55, 1.6, 64]} />
        <meshBasicMaterial color="#54d6ff" transparent opacity={0.3} side={DoubleSide} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <circleGeometry args={[1.0, 48]} />
        <meshBasicMaterial color="#0a1828" transparent opacity={0.5} />
      </mesh>
    </group>
  );
}
