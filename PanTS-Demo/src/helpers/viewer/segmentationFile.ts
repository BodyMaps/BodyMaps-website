// "Save to computer": the live labelmap as a NIfTI-1 (.nii.gz) file, written in the browser.
//
// The geometry mirrors what the server builds from the same numbers when it saves a labelmap
// (flask-server api_blueprint._save_segmentation_locked): the labelmap's LPS direction, spacing and origin
// become the RAS affine NIfTI expects, so the file opens in 3D Slicer / ITK-SNAP / nibabel exactly where
// the scan is. One byte per voxel; the structure names and colours are not part of the file.

export type LabelmapGeometry = {
	dimensions: readonly number[];
	spacing: readonly number[];
	origin: readonly number[];
	/** Nine values, LPS world axes: i-axis [0..2], j-axis [3..5], k-axis [6..8]. */
	direction: readonly number[];
};

const HEADER_BYTES = 348;
const VOXEL_OFFSET = 352; // the header, then the 4-byte "no extensions" marker

/** The uncompressed .nii bytes of a uint8 labelmap. Throws on a label that does not fit in one byte. */
export function buildNifti1Labelmap(geometry: LabelmapGeometry, data: ArrayLike<number>): Uint8Array {
	const { dimensions, spacing, origin, direction } = geometry;
	if (dimensions.length !== 3 || dimensions.some((n) => !Number.isSafeInteger(n) || n <= 0)) {
		throw new Error("Segmentation has invalid dimensions.");
	}
	if (spacing.length !== 3 || origin.length !== 3 || direction.length !== 9
		|| ![...spacing, ...origin, ...direction].every(Number.isFinite)) {
		throw new Error("Segmentation has invalid geometry.");
	}
	const [nx, ny, nz] = dimensions;
	const voxelCount = nx * ny * nz;
	if (!Number.isSafeInteger(voxelCount) || data.length !== voxelCount) {
		throw new Error("Segmentation data length does not match its dimensions.");
	}

	const bytes = new Uint8Array(VOXEL_OFFSET + voxelCount);
	const view = new DataView(bytes.buffer);
	view.setInt32(0, HEADER_BYTES, true); // sizeof_hdr
	view.setInt16(40, 3, true); // dim[0]: three dimensions
	view.setInt16(42, nx, true);
	view.setInt16(44, ny, true);
	view.setInt16(46, nz, true);
	for (let extra = 4; extra < 8; extra++) view.setInt16(40 + 2 * extra, 1, true);
	view.setInt16(70, 2, true); // datatype: uint8
	view.setInt16(72, 8, true); // bitpix
	view.setFloat32(76, 1, true); // pixdim[0]: qfac
	for (let axis = 0; axis < 3; axis++) view.setFloat32(80 + 4 * axis, spacing[axis], true);
	view.setFloat32(108, VOXEL_OFFSET, true); // vox_offset
	view.setFloat32(112, 1, true); // scl_slope
	bytes[123] = 2; // xyzt_units: millimetres
	view.setInt16(252, 0, true); // qform_code: none, the sform below is the placement
	view.setInt16(254, 1, true); // sform_code: scanner coordinates
	// LPS -> RAS flips the first two world axes. direction is column-major: axis c of the voxel grid is
	// direction[3c .. 3c+2].
	const flip = [-1, -1, 1];
	for (let row = 0; row < 3; row++) {
		for (let col = 0; col < 3; col++) {
			view.setFloat32(280 + 16 * row + 4 * col, flip[row] * direction[row + 3 * col] * spacing[col], true);
		}
		view.setFloat32(280 + 16 * row + 12, flip[row] * origin[row], true);
	}
	bytes.set([0x6e, 0x2b, 0x31, 0x00], 344); // magic "n+1"

	for (let index = 0; index < voxelCount; index++) {
		const label = data[index];
		if (!Number.isInteger(label) || label < 0 || label > 255) {
			throw new Error(`Segmentation contains an invalid label at voxel ${index}.`);
		}
		bytes[VOXEL_OFFSET + index] = label;
	}
	return bytes;
}

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
	const source = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(bytes);
			controller.close();
		},
	});
	return new Uint8Array(await new Response(source.pipeThrough(new CompressionStream("gzip"))).arrayBuffer());
}

/** The labelmap as the bytes of a gzip-compressed NIfTI file. */
export async function labelmapToNiftiGz(geometry: LabelmapGeometry, data: ArrayLike<number>): Promise<Uint8Array> {
	return gzip(buildNifti1Labelmap(geometry, data));
}

/** A file name that is safe on every operating system. */
export function segmentationFileName(caseId: string | number): string {
	const safe = String(caseId).replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
	return `segmentation_${safe || "scan"}.nii.gz`;
}

/** Hand bytes to the browser as a download. */
export function downloadBytes(bytes: Uint8Array, fileName: string, type = "application/gzip"): void {
	const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
	const link = document.createElement("a");
	link.href = url;
	link.download = fileName;
	link.rel = "noopener";
	document.body.appendChild(link);
	link.click();
	link.remove();
	// The browser has started reading the blob by the time the click returns; give it a moment anyway.
	setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
