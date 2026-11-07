import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchSharedAnnotationStatus, revisionForSharedSave, saveSharedSegmentation } from "../helpers/CornerstoneNifti2";

const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

afterEach(() => { vi.restoreAllMocks(); });

describe("fetchSharedAnnotationStatus", () => {
	it("asks the server about this case with the session cookie and never from cache", async () => {
		const fetchMock = vi.fn(async () => respond({ supported: true, exists: true, revision: "r7", can_override: true }));
		vi.stubGlobal("fetch", fetchMock);
		const status = await fetchSharedAnnotationStatus("https://site", "35");
		expect(status).toMatchObject({ exists: true, revision: "r7", can_override: true });
		expect(fetchMock).toHaveBeenCalledWith("https://site/api/shared-annotation/35", expect.objectContaining({ credentials: "include", cache: "no-store" }));
	});

	it("encodes the case id", async () => {
		const fetchMock = vi.fn(async () => respond({ supported: false, can_override: false }));
		vi.stubGlobal("fetch", fetchMock);
		await fetchSharedAnnotationStatus("", "a/b");
		expect(String(fetchMock.mock.calls[0][0])).toBe("/api/shared-annotation/a%2Fb");
	});

	it("rejects when the server cannot answer", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => respond({}, 500)));
		await expect(fetchSharedAnnotationStatus("", "35")).rejects.toThrow(/HTTP 500/);
	});
});

describe("saveSharedSegmentation", () => {
	it("refuses before sending anything when the scan has no shared version", async () => {
		const fetchMock = vi.fn(async () => respond({ supported: false, can_override: false }));
		vi.stubGlobal("fetch", fetchMock);
		await expect(saveSharedSegmentation("", "CV_00000001")).rejects.toThrow(/can't have a shared version/);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("refuses before sending anything when the account is not approved", async () => {
		const fetchMock = vi.fn(async () => respond({ supported: true, exists: false, revision: "none", can_override: false }));
		vi.stubGlobal("fetch", fetchMock);
		await expect(saveSharedSegmentation("", "35")).rejects.toThrow(/permission/);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(String(fetchMock.mock.calls[0][0])).toContain("/api/shared-annotation/35");
	});

	it("never posts to the shared endpoint without a loaded segmentation", async () => {
		const fetchMock = vi.fn(async () => respond({ supported: true, exists: false, revision: "none", can_override: true }));
		vi.stubGlobal("fetch", fetchMock);
		await expect(saveSharedSegmentation("", "35")).rejects.toThrow(/No segmentation volume/);
		expect(fetchMock.mock.calls.every(([url]) => !String(url).includes("save-segmentation"))).toBe(true);
	});
});

describe("revisionForSharedSave", () => {
	const current = { supported: true, exists: true, revision: "r9", can_override: true };

	it("uses the revision the scan was opened at, not the newest, so a stale tab cannot overwrite a newer fix", () => {
		expect(revisionForSharedSave("r7", current)).toBe("r7");
		expect(revisionForSharedSave("none", current)).toBe("none");
	});

	it("falls back to the current revision only when none was recorded", () => {
		expect(revisionForSharedSave(undefined, current)).toBe("r9");
		expect(revisionForSharedSave(undefined, { supported: true, can_override: true })).toBe("none");
	});
});
