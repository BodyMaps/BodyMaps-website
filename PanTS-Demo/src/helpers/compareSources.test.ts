import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveSources } from "./compareSources";

describe("comparison volume resolution", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("uses preview CT with full-resolution segmentation", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));

		const sources = await resolveSources("35");

		expect(sources.ct).toContain("/api/get-main-nifti/35.nii.gz?res=low");
		expect(sources.seg).toContain("/api/get-segmentations/35.nii.gz?labels=viewer-v1");
		expect(sources.seg).not.toContain("res=low");
	});

	it("reads the full-resolution CT when asked", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));

		const sources = await resolveSources("35", true);

		expect(sources.ct).toMatch(/\/api\/get-main-nifti\/35\.nii\.gz$/);
		expect(sources.seg).toContain("/api/get-segmentations/35.nii.gz?labels=viewer-v1");
	});

	it("loads the mask from the backend even when the CT comes from the mirror", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));

		const sources = await resolveSources("35");

		expect(sources.ct).toContain("huggingface.co");
		// The mirror's raw mask numbers the spleen, stomach and lesion differently from the viewer.
		expect(sources.seg).toContain("/api/get-segmentations/35.nii.gz?labels=viewer-v1");
		expect(sources.seg).not.toContain("mask_only");
	});

	it("overlays a CancerVerse tumor mask when the route answers with a volume", async () => {
		const fetchMock = vi.fn().mockResolvedValue({ ok: true, headers: { get: () => "application/gzip" } });
		vi.stubGlobal("fetch", fetchMock);

		const sources = await resolveSources("CV_00000001");

		expect(sources.ct).toContain("/api/get-main-nifti/CV_00000001.nii.gz?res=low");
		expect(sources.seg).toMatch(/\/api\/get-segmentations\/CV_00000001\.nii\.gz$/);
		expect(fetchMock).toHaveBeenCalledWith(sources.seg, { method: "HEAD" });
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("shows a CancerVerse CT alone when the route answers that it has no mask", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, headers: { get: () => "application/json" } }));

		const sources = await resolveSources("CV_00000002");

		expect(sources.ct).toContain("/api/get-main-nifti/CV_00000002.nii.gz?res=low");
		expect(sources.seg).toBe("");
	});

	it("shows a CancerVerse CT alone when the mask check fails", async () => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

		const sources = await resolveSources("CV_00000003", true);

		expect(sources.ct).toMatch(/\/api\/get-main-nifti\/CV_00000003\.nii\.gz$/);
		expect(sources.seg).toBe("");
	});
});
