import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { DoubleSide } from 'three';
import { SCAN_SUMMARY } from '../data/scanData';
import type { SliceState } from '../hooks/useAnatomySelection';

const TOTAL = SCAN_SUMMARY.images;
const axialY = (idx: number) => 1.3 - (idx / TOTAL) * 2.8;
const sagX = (idx: number) => (idx / TOTAL - 0.5) * 1.4;
const corZ = (idx: number) => (idx / TOTAL - 0.5) * 1.0;

interface Props {
  visible: boolean;
  slices: SliceState;
  play: boolean;
  onPlayTick: (idx: number) => void;
}

export default function SlicePlanes({ visible, slices, play, onPlayTick }: Props) {
  const playRef = useRef(play);
  playRef.current = play;
  const idxRef = useRef(slices.axial);
  idxRef.current = slices.axial;

  useFrame((_, dt) => {
    if (!visible) return;
    if (playRef.current) {
      let next = idxRef.current + dt * 90;
      if (next > TOTAL) next = 1;
      onPlayTick(Math.round(next));
    }
  });

  if (!visible) return null;

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, axialY(slices.axial), 0]}>
        <planeGeometry args={[2.0, 1.6]} />
        <meshBasicMaterial color="#54d6ff" transparent opacity={0.16} side={DoubleSide} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, axialY(slices.axial), 0.001]}>
        <ringGeometry args={[0.95, 1.0, 48]} />
        <meshBasicMaterial color="#7fe3ff" transparent opacity={0.6} side={DoubleSide} />
      </mesh>
      <mesh rotation={[0, Math.PI / 2, 0]} position={[sagX(slices.sagittal), 0.2, 0]}>
        <planeGeometry args={[1.4, 3.4]} />
        <meshBasicMaterial color="#54d6ff" transparent opacity={0.12} side={DoubleSide} />
      </mesh>
      <mesh position={[0, 0.2, corZ(slices.coronal)]}>
        <planeGeometry args={[2.0, 3.4]} />
        <meshBasicMaterial color="#54d6ff" transparent opacity={0.12} side={DoubleSide} />
      </mesh>
    </group>
  );
}
