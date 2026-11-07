import { describe, expect, it, vi } from "vitest";
import { _tagNiftiVolumeAsCt } from "../helpers/CornerstoneNifti2";
import { analyzeScan, intensityUnit, modalityFromName, mrWindowPresets, waitForFrames } from "../helpers/scanModality";

// Deterministic pseudo-random so the fixtures never flake.
function rng(seed: number) {
	let x = seed;
	return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

function ctWithAir(n = 60_000): Int16Array {
	const r = rng(1);
	return Int16Array.from({ length: n }, (_, i) => (i % 3 === 0 ? -1000 + Math.round(r() * 20) : Math.round(r() * 160 - 20)));
}

function croppedCtWithoutAir(n = 60_000): Int16Array {
	const r = rng(2);
	return Int16Array.from({ length: n }, (_, i) => (i % 4 === 0 ? -120 + Math.round(r() * 40) : 20 + Math.round(r() * 120)));
}

function mrT1(n = 60_000): Uint16Array {
	const r = rng(3);
	return Uint16Array.from({ length: n }, (_, i) => (i % 2 === 0 ? 0 : 200 + Math.round(r() * 800)));
}

function mrZScored(n = 60_000): Float32Array {
	const r = rng(4);
	return Float32Array.from({ length: n }, () => (r() - 0.5) * 6);
}

describe("analyzeScan", () => {
	it("calls a scan with an air band near -1000 CT", () => {
		expect(analyzeScan(ctWithAir()).modality).toBe("CT");
	});

	it("calls a cropped CT with fat-range negatives and no air CT", () => {
		expect(analyzeScan(croppedCtWithoutAir()).modality).toBe("CT");
	});

	it("calls a non-negative scanner-unit volume MR", () => {
		const a = analyzeScan(mrT1());
		expect(a.modality).toBe("MR");
		expect(a.min).toBe(0);
	});

	it("calls a z-scored volume MR", () => {
		expect(analyzeScan(mrZScored()).modality).toBe("MR");
	});

	it("takes MR percentiles from the foreground, not the zero background", () => {
		const a = analyzeScan(mrT1());
		expect(a.p2).toBeGreaterThanOrEqual(200);
		expect(a.p995).toBeLessThanOrEqual(1000);
	});

	it("ignores non-finite voxels", () => {
		const data = Float32Array.from(mrT1(1000));
		data[3] = NaN;
		data[4] = Infinity;
		expect(analyzeScan(data).modality).toBe("MR");
	});

	it("does not throw on an empty volume", () => {
		expect(analyzeScan(new Float32Array(0)).modality).toBe("CT");
	});
});

describe("mrWindowPresets", () => {
	it("starts with an Auto window that covers the foreground range", () => {
		const a = analyzeScan(mrT1());
		const [auto, , full] = mrWindowPresets(a);
		expect(auto.name).toBe("Auto");
		expect(auto.center - auto.width / 2).toBeCloseTo(a.p2);
		expect(auto.center + auto.width / 2).toBeCloseTo(a.p995);
		expect(full.name).toBe("Full range");
		expect(full.width).toBeCloseTo(a.max - a.min);
	});
});

describe("intensityUnit", () => {
	it("prints HU only for CT", () => {
		expect(intensityUnit("CT")).toBe(" HU");
		expect(intensityUnit(undefined)).toBe(" HU");
		expect(intensityUnit("MR")).toBe("");
	});
});

describe("_tagNiftiVolumeAsCt with a modality", () => {
	it("tags an untagged volume with the detected modality", () => {
		const volume = { metadata: {} as { Modality?: string } };
		_tagNiftiVolumeAsCt(volume, "MR");
		expect(volume.metadata.Modality).toBe("MR");
	});
});

describe("waitForFrames", () => {
	it("resolves once the loader has delivered every slice, polling in between", async () => {
		vi.useFakeTimers();
		try {
			const volume = { framesLoaded: 0, numFrames: 3 };
			const onTick = vi.fn(() => { volume.framesLoaded += 1; });
			const done = waitForFrames(volume, onTick);
			await vi.advanceTimersByTimeAsync(500);
			await expect(done).resolves.toBe(true);
			expect(onTick).toHaveBeenCalledTimes(3);
		} finally {
			vi.useRealTimers();
		}
	});

	it("gives up after the timeout instead of hanging", async () => {
		vi.useFakeTimers();
		try {
			const done = waitForFrames({ framesLoaded: 0, numFrames: 5 }, () => {}, 200);
			await vi.advanceTimersByTimeAsync(1000);
			await expect(done).resolves.toBe(false);
		} finally {
			vi.useRealTimers();
		}
	});

	it("propagates a stale-load error from the tick", async () => {
		vi.useFakeTimers();
		try {
			const done = waitForFrames({ framesLoaded: 0, numFrames: 5 }, () => { throw new Error("stale"); });
			const settled = expect(done).rejects.toThrow("stale");
			await vi.advanceTimersByTimeAsync(100);
			await settled;
		} finally {
			vi.useRealTimers();
		}
	});

	it("returns immediately when everything is already loaded", async () => {
		await expect(waitForFrames({ framesLoaded: 4, numFrames: 4 })).resolves.toBe(true);
	});
});

describe("modalityFromName", () => {
	it("recognises MRI sequence names and CT names", () => {
		expect(modalityFromName("brats_BraTS2021_00053_t1ce.nii.gz")).toBe("MR");
		expect(modalityFromName("sub-01_FLAIR.nii")).toBe("MR");
		expect(modalityFromName("ct_axial_soft_tissue_1p5mm_series-3.nii")).toBe("CT");
		expect(modalityFromName("NCCT_head.nii.gz")).toBe("CT");
	});

	it("says nothing for names that name neither, or both", () => {
		expect(modalityFromName("scan1.nii.gz")).toBeNull();
		expect(modalityFromName("ct_vs_mri.nii")).toBeNull();
		expect(modalityFromName(undefined)).toBeNull();
		expect(modalityFromName("project.nii")).toBeNull();
	});
});

describe("analyzeScan with a file name", () => {
	it("keeps an air-band CT as CT even if the name looks like MRI", () => {
		expect(analyzeScan(ctWithAir(), "t1_looking_name.nii").modality).toBe("CT");
	});

	it("calls a slightly negative bias-corrected volume MR when the name says so", () => {
		const r = rng(5);
		const data = Float32Array.from({ length: 60_000 }, (_, i) => (i % 3 === 0 ? -90 + r() * 10 : 100 + r() * 500));
		expect(analyzeScan(data, "case_t2w.nii.gz").modality).toBe("MR");
	});

	it("calls an offset CT (no negatives, no air band) CT when the name says CT", () => {
		const r = rng(6);
		const data = Uint16Array.from({ length: 60_000 }, () => 900 + Math.round(r() * 1200));
		expect(analyzeScan(data).modality).toBe("MR");
		expect(analyzeScan(data, "ct_abdomen.nii").modality).toBe("CT");
	});
});
