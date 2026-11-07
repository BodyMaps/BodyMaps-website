import { describe, expect, it } from "vitest";
import { buildNifti1Labelmap, labelmapToNiftiGz, segmentationFileName } from "./segmentationFile";

const geometry = {
	dimensions: [3, 2, 2],
	spacing: [0.75, 0.75, 5],
	origin: [-10, -20, 30],
	direction: [1, 0, 0, 0, 1, 0, 0, 0, 1],
};

describe("buildNifti1Labelmap", () => {
	it("writes a NIfTI-1 header a reader accepts", () => {
		const data = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 255];
		const bytes = buildNifti1Labelmap(geometry, data);
		const view = new DataView(bytes.buffer);
		expect(bytes.length).toBe(352 + 12);
		expect(view.getInt32(0, true)).toBe(348);
		expect([40, 42, 44, 46].map((offset) => view.getInt16(offset, true))).toEqual([3, 3, 2, 2]);
		expect(view.getInt16(70, true)).toBe(2); // uint8
		expect(view.getInt16(72, true)).toBe(8);
		expect([80, 84, 88].map((offset) => view.getFloat32(offset, true))).toEqual([0.75, 0.75, 5]);
		expect(view.getFloat32(108, true)).toBe(352);
		expect(String.fromCharCode(...bytes.slice(344, 347))).toBe("n+1");
		expect(Array.from(bytes.slice(352))).toEqual(data);
	});

	it("places the scan like the server does: LPS world axes become the RAS affine", () => {
		const bytes = buildNifti1Labelmap(geometry, new Array(12).fill(0));
		const view = new DataView(bytes.buffer);
		const row = (index: number) => [0, 4, 8, 12].map((offset) => view.getFloat32(280 + 16 * index + offset, true));
		expect(row(0)).toEqual([-0.75, -0, -0, 10]); // x flips, the origin flips with it
		expect(row(1)).toEqual([-0, -0.75, -0, 20]);
		expect(row(2)).toEqual([0, 0, 5, 30]);
		expect(view.getInt16(254, true)).toBe(1); // sform in use
	});

	it("honours a tilted or flipped grid", () => {
		// The slice axis runs the other way (a reversed stack): k-axis = -z.
		const bytes = buildNifti1Labelmap({ ...geometry, direction: [1, 0, 0, 0, 1, 0, 0, 0, -1] }, new Array(12).fill(0));
		const view = new DataView(bytes.buffer);
		expect(view.getFloat32(280 + 16 * 2 + 8, true)).toBe(-5);
	});

	it("refuses a label that does not fit in a byte, a wrong length or bad geometry", () => {
		expect(() => buildNifti1Labelmap(geometry, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 256])).toThrow(/invalid label/);
		expect(() => buildNifti1Labelmap(geometry, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 1.5])).toThrow(/invalid label/);
		expect(() => buildNifti1Labelmap(geometry, [0, 1])).toThrow(/does not match/);
		expect(() => buildNifti1Labelmap({ ...geometry, spacing: [1, Number.NaN, 1] }, new Array(12).fill(0))).toThrow(/geometry/);
		expect(() => buildNifti1Labelmap({ ...geometry, dimensions: [3, 0, 2] }, [])).toThrow(/dimensions/);
	});
});

describe("labelmapToNiftiGz", () => {
	it("gzips the same bytes", async () => {
		const data = Array.from({ length: 12 }, (_, index) => index);
		const compressed = await labelmapToNiftiGz(geometry, data);
		expect(Array.from(compressed.slice(0, 2))).toEqual([0x1f, 0x8b]); // gzip magic
		const source = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(compressed); controller.close(); } });
		const unzipped = new Uint8Array(await new Response(source.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
		expect(Array.from(unzipped)).toEqual(Array.from(buildNifti1Labelmap(geometry, data)));
	});
});

describe("segmentationFileName", () => {
	it.each([
		["35", "segmentation_35.nii.gz"],
		["CV_00000001", "segmentation_CV_00000001.nii.gz"],
		["../../etc/passwd", "segmentation_etc_passwd.nii.gz"],
		["", "segmentation_scan.nii.gz"],
	])("%s -> %s", (id, expected) => {
		expect(segmentationFileName(id)).toBe(expected);
	});
});
