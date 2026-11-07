// CT vs MRI detection for scans the viewer cannot get a DICOM Modality for (NIfTI uploads),
// and the MRI display settings that follow from it. CT voxels are Hounsfield units (air about
// -1000, water 0), so the fixed CT windows, "HU" labels and slider ranges are meaningful.
// MRI voxels are arbitrary scanner units, so they need a window taken from the scan itself.

export type ScanModality = "CT" | "MR";

export type ScanAnalysis = {
	modality: ScanModality;
	min: number;
	max: number;
	/** Foreground intensity percentiles (background excluded for MRI), used to derive MRI windows. */
	p2: number;
	p98: number;
	p995: number;
	/** Share of sampled voxels that sit in the CT air band (-1100 to -900 HU). */
	airFraction: number;
	reason: string;
};

export type MrWindowPreset = { name: string; width: number; center: number };

const SAMPLE_TARGET = 400_000;
const AIR_LOW = -1100;
const AIR_HIGH = -900;

function percentile(sorted: Float32Array, q: number): number {
	if (!sorted.length) return 0;
	return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))];
}

/** Classifies a loaded volume from a strided sample of its voxels. Pure: no viewer state. */
export function analyzeScan(data: ArrayLike<number>): ScanAnalysis {
	const stride = Math.max(1, Math.floor(data.length / SAMPLE_TARGET));
	const sample = new Float32Array(Math.ceil(data.length / stride));
	let n = 0;
	for (let i = 0; i < data.length; i += stride) {
		const v = data[i];
		if (Number.isFinite(v)) sample[n++] = v;
	}
	const values = sample.subarray(0, n);
	values.sort();
	if (!n) return { modality: "CT", min: 0, max: 0, p2: 0, p98: 0, p995: 0, airFraction: 0, reason: "no finite voxels" };
	const min = values[0];
	const max = values[n - 1];
	let air = 0;
	for (let i = 0; i < n; i++) if (values[i] >= AIR_LOW && values[i] <= AIR_HIGH) air++;
	const airFraction = air / n;

	let modality: ScanModality;
	let reason: string;
	if (airFraction >= 0.01) {
		modality = "CT";
		reason = "air band near -1000 HU";
	} else if (min >= -50) {
		modality = "MR";
		reason = "no negative intensities";
	} else if (percentile(values, 0.01) <= -80 && min >= AIR_LOW && percentile(values, 0.99) <= 3200) {
		modality = "CT";
		reason = "fat-range negatives within the HU range";
	} else {
		modality = "MR";
		reason = "intensities are not on the Hounsfield scale";
	}

	// MRI backgrounds are exactly zero (or constant): window on the foreground only.
	const firstForeground = modality === "MR" ? values.findIndex((v) => v > min + 1e-6) : 0;
	const foreground = values.subarray(Math.max(firstForeground, 0));
	return {
		modality,
		min,
		max,
		p2: percentile(foreground, 0.02),
		p98: percentile(foreground, 0.98),
		p995: percentile(foreground, 0.995),
		airFraction,
		reason,
	};
}

function toWindow(low: number, high: number): { width: number; center: number } {
	const width = Math.max(high - low, 1e-3);
	return { width, center: low + width / 2 };
}

/** MRI window presets, all derived from the scan's own intensity distribution. The first one is the default. */
export function mrWindowPresets(a: Pick<ScanAnalysis, "min" | "max" | "p2" | "p98" | "p995">): MrWindowPreset[] {
	const auto = toWindow(a.p2, a.p995);
	const bright = toWindow(a.p2 + (a.p98 - a.p2) * 0.35, a.p995);
	const wide = toWindow(a.min, a.max);
	return [
		{ name: "Auto", ...auto },
		{ name: "High contrast", ...bright },
		{ name: "Full range", ...wide },
	];
}

/** Unit text for intensity readouts: Hounsfield units only mean something on CT. */
export function intensityUnit(modality: string | undefined): string {
	return modality === "MR" ? "" : " HU";
}
