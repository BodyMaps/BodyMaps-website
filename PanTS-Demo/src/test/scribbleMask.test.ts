import { describe, expect, it } from "vitest";
import { rasterizeScribbleStroke } from "../helpers/viewer/scribbleMask";

describe("nnInteractive scribble rasterization", () => {
	it("creates a thin connected stroke in an axis-0-fastest crop", () => {
		const result = rasterizeScribbleStroke([[3, 4], [7, 4]], 2, 2, 8, 6, 1);
		expect(result).not.toBeNull();
		const { mask, width, height } = result!;
		const voxels: Array<[number, number]> = [];
		for (let b = 0; b < height; b++) {
			for (let a = 0; a < width; a++) {
				if (mask[a + b * width]) voxels.push([a + 2, b + 2]);
			}
		}
		expect(voxels.length).toBeGreaterThan(0);
		expect(Math.min(...voxels.map(([a]) => a))).toBe(2);
		expect(Math.max(...voxels.map(([a]) => a))).toBe(8);
		expect(Math.min(...voxels.map(([, b]) => b))).toBe(3);
		expect(Math.max(...voxels.map(([, b]) => b))).toBe(5);
		// The same crop convention is decoded server-side with NumPy order='F':
		// a (x/in-plane axis 0) increments before b (axis 1).
		expect(mask[1 + 2 * width]).toBe(1); // voxel (3,4)
		expect(mask[5 + 2 * width]).toBe(1); // voxel (7,4)
	});

	it("returns null for an empty stroke or invalid crop", () => {
		expect(rasterizeScribbleStroke([], 0, 0, 1, 1)).toBeNull();
		expect(rasterizeScribbleStroke([[1, 1]], 2, 2, 1, 1)).toBeNull();
	});
});
