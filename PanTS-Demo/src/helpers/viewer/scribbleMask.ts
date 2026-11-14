/** Rasterize a 2D polyline into a cropped, axis-0-fastest binary mask. */
export function rasterizeScribbleStroke(
	points: Array<[number, number]>,
	minA: number,
	minB: number,
	maxA: number,
	maxB: number,
	radiusVox = 1,
): { mask: Uint8Array; width: number; height: number } | null {
	const width = maxA - minA + 1;
	const height = maxB - minB + 1;
	if (points.length === 0 || width <= 0 || height <= 0 || radiusVox <= 0) return null;

	const mask = new Uint8Array(width * height);
	const radiusSquared = radiusVox * radiusVox;
	for (let i = 0; i < points.length; i++) {
		const p0 = points[i];
		const p1 = points[Math.min(i + 1, points.length - 1)];
		const dx = p1[0] - p0[0];
		const dy = p1[1] - p0[1];
		const lengthSquared = dx * dx + dy * dy || 1;
		const steps = Math.ceil(Math.sqrt(lengthSquared)) + 1;
		for (let step = 0; step <= steps; step++) {
			const t = step / steps;
			const centerA = p0[0] + dx * t;
			const centerB = p0[1] + dy * t;
			const a0 = Math.max(minA, Math.floor(centerA - radiusVox));
			const a1 = Math.min(maxA, Math.ceil(centerA + radiusVox));
			const b0 = Math.max(minB, Math.floor(centerB - radiusVox));
			const b1 = Math.min(maxB, Math.ceil(centerB + radiusVox));
			for (let b = b0; b <= b1; b++) {
				for (let a = a0; a <= a1; a++) {
					const da = a - centerA;
					const db = b - centerB;
					if (da * da + db * db <= radiusSquared) mask[(a - minA) + (b - minB) * width] = 1;
				}
			}
		}
		if (points.length === 1) break;
	}
	return { mask, width, height };
}
