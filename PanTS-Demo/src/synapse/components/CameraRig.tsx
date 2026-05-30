import { useFrame, useThree } from '@react-three/fiber';
import { useRef, useImperativeHandle, forwardRef } from 'react';
import { Vector3 } from 'three';
import type { RefObject } from 'react';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';

export interface CameraRigHandle {
  flyTo(camPos: [number, number, number], target: [number, number, number], duration?: number): void;
}

interface AnimState {
  t: number;
  duration: number;
  p0: Vector3;
  p1: Vector3;
  g0: Vector3;
  g1: Vector3;
}

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

interface Props {
  controlsRef: RefObject<OrbitControlsImpl | null>;
}

const CameraRig = forwardRef<CameraRigHandle, Props>(function CameraRig({ controlsRef }, ref) {
  const { camera } = useThree();
  const anim = useRef<AnimState | null>(null);

  useImperativeHandle(ref, () => ({
    flyTo(camPos, target, duration = 1.1) {
      anim.current = {
        t: 0,
        duration,
        p0: camera.position.clone(),
        p1: new Vector3(...camPos),
        g0: controlsRef.current ? controlsRef.current.target.clone() : new Vector3(),
        g1: new Vector3(...target),
      };
    },
  }));

  useFrame((_, dt) => {
    if (!anim.current) return;
    const a = anim.current;
    a.t = Math.min(1, a.t + dt / a.duration);
    const e = easeInOutCubic(a.t);
    camera.position.lerpVectors(a.p0, a.p1, e);
    if (controlsRef.current) {
      controlsRef.current.target.lerpVectors(a.g0, a.g1, e);
      controlsRef.current.update();
    }
    if (a.t >= 1) anim.current = null;
  });

  return null;
});

export default CameraRig;
