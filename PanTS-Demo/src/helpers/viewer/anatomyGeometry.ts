import type { Vec3 } from "../utils";

/** Inverse of the mesh export's LPS -> centered Three coordinate transform. */
export function threeToLps(point: Vec3, center: Vec3): Vec3 {
  return [-(point[0] + center[0]), point[2] + center[2], point[1] + center[1]];
}

/** Orthogonal patient-space axes for an axial plane tilted around L and P. */
export function obliqueAxes(pitchDegrees: number, rollDegrees: number) {
  const p = pitchDegrees * Math.PI / 180;
  const r = rollDegrees * Math.PI / 180;
  const rotate = ([x, y, z]: Vec3): Vec3 => {
    const yy = y * Math.cos(p) - z * Math.sin(p);
    const zz = y * Math.sin(p) + z * Math.cos(p);
    return [x * Math.cos(r) + zz * Math.sin(r), yy, -x * Math.sin(r) + zz * Math.cos(r)];
  };
  return { normal: rotate([0, 0, -1]), up: rotate([0, -1, 0]) };
}

export function obliqueCamera(pitch: number, roll: number, pivot: Vec3, distance: number) {
  const { normal, up } = obliqueAxes(pitch, roll);
  return {
    focalPoint: [...pivot] as Vec3,
    position: pivot.map((x, i) => x + normal[i] * distance) as Vec3,
    viewPlaneNormal: normal,
    viewUp: up,
  };
}
