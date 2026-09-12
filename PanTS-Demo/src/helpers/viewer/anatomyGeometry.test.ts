import { describe, expect, it } from "vitest";
import { cornerstoneLpsMmToThree, type Vec3 } from "../utils";
import { obliqueAxes, obliqueCamera, threeToLps } from "./anatomyGeometry";

describe("linked anatomy physical geometry", () => {
  it("round trips picked points with nonzero mesh centering", () => {
    const center: Vec3 = [130, -75, 216];
    for (const point of [[0, 0, 0], [-124, 50, 832], [18.75, -23.4, 7.125]] as Vec3[]) {
      const back = threeToLps(cornerstoneLpsMmToThree(point, center), center);
      back.forEach((x, i) => expect(x).toBeCloseTo(point[i], 10));
    }
  });
  it("places left, posterior, and superior along the exported mesh axes", () => {
    const center: Vec3 = [0, 0, 0];
    expect(cornerstoneLpsMmToThree([1, 0, 0], center)).toEqual([-1, 0, 0]);
    expect(cornerstoneLpsMmToThree([0, 1, 0], center)[2]).toBe(1);
    expect(cornerstoneLpsMmToThree([0, 0, 1], center)[1]).toBe(1);
  });
  it("maintains orthonormal oblique cameras including the control limits", () => {
    for (const pitch of [-75, -35, 0, 25, 75]) for (const roll of [-75, -10, 0, 60, 75]) {
      const { normal, up } = obliqueAxes(pitch, roll);
      expect(Math.hypot(...normal)).toBeCloseTo(1, 12);
      expect(Math.hypot(...up)).toBeCloseTo(1, 12);
      expect(normal.reduce((sum, x, i) => sum + x * up[i], 0)).toBeCloseTo(0, 12);
    }
    expect(obliqueAxes(0, 0).normal[2]).toBe(-1);
    expect(obliqueAxes(0, 0).up[1]).toBe(-1);
  });
  it("rotates about the picked anatomy without displacing the physical slice pivot", () => {
    const pivot: Vec3 = [128.94, -76.37, 299.77];
    const camera = obliqueCamera(30, -20, pivot, 372);
    expect(camera.focalPoint).toEqual(pivot);
    const direction = camera.position.map((x, i) => x - pivot[i]);
    expect(Math.hypot(...direction)).toBeCloseTo(372, 10);
    direction.forEach((x, i) => expect(x / 372).toBeCloseTo(camera.viewPlaneNormal[i], 10));
  });
});
