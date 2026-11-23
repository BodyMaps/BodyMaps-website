import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isProjectCaseId, isServerOnlyCaseId } from "../helpers/caseIds";
import {
	CHUNK_SIZE,
	MAX_SCAN_BYTES,
	isNifti,
	parseProjectCaseId,
	projectCaseId,
	projectCode,
	uploadProjectScan,
} from "../helpers/projectScans";

const PROJECT = "3924F4CB-1111-2222-3333-444455556666";

describe("a project's case ids", () => {
	it("are the project's code and the scan's number", () => {
		expect(projectCode(PROJECT)).toBe("3924f4cb");
		expect(projectCaseId(PROJECT, 1)).toBe("PRJ_3924f4cb_00000001");
		expect(projectCaseId(PROJECT, 12345)).toBe("PRJ_3924f4cb_00012345");
	});

	it.each([
		["PRJ_3924f4cb_00000007", { code: "3924f4cb", number: 7 }],
		["prj_3924F4CB_00000007", { code: "3924f4cb", number: 7 }],
		[" PRJ_3924f4cb_00000007 ", { code: "3924f4cb", number: 7 }],
	])("read %s", (id, expected) => expect(parseProjectCaseId(id)).toEqual(expected));

	it.each(["PRJ_3924f4cb_7", "PRJ_3924f4c_00000007", "PRJ_zzzzzzzz_00000007", "CV_00000007", "BDMAP_00000007", "17", "", null, undefined, 7])(
		"does not read %j", (id) => expect(parseProjectCaseId(id)).toBeNull());

	it("count as server-only cases, like CancerVerse and AbdomenAtlas, and nothing else does by accident", () => {
		expect(isProjectCaseId("PRJ_3924f4cb_00000001")).toBe(true);
		expect(isServerOnlyCaseId("PRJ_3924f4cb_00000001")).toBe(true);
		for (const other of ["17", "PanTS_00000017", "CV_00000001", "BDMAP_00000001"]) expect(isProjectCaseId(other)).toBe(false);
		expect(isServerOnlyCaseId("CV_00000001")).toBe(true);
		expect(isServerOnlyCaseId("PanTS_00000017")).toBe(false);
	});
});

describe("which files can be uploaded", () => {
	it.each(["a.nii", "a.nii.gz", "A.NII.GZ", "scan.v2.nii.gz"])("accepts %s", (n) => expect(isNifti(n)).toBe(true));
	it.each(["a.dcm", "a.gz", "a.nii.zip", "nii", "a.nii.gz.exe", ""])("refuses %s", (n) => expect(isNifti(n)).toBe(false));
});

type Call = { url: string; method: string; body: unknown; headers: Record<string, string> };

let calls: Call[] = [];
let script: (c: Call) => { status: number; body: Record<string, unknown> };

const fileOf = (bytes: number, name = "scan.nii.gz") => new File([new Uint8Array(bytes)], name);

beforeEach(() => {
	calls = [];
	script = (c) => {
		if (c.url.endsWith("/upload-inference-chunk")) return { status: 200, body: { ok: true } };
		if (c.url.endsWith("/finalize-upload")) return { status: 200, body: { uploaded_filename: "BDMAP_00000001/ct.nii.gz" } };
		return { status: 201, body: { number: 1, case_id: "PRJ_3924f4cb_00000001", original_name: "scan.nii.gz", modality: "ct", size_bytes: 1, shape: [1], spacing: [1], uploaded_at: null } };
	};
	global.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
		const call: Call = {
			url: String(url), method: init?.method ?? "GET",
			body: init?.body instanceof FormData ? Object.fromEntries([...init.body.entries()].map(([k, v]) => [k, v instanceof File ? v.size : v]))
				: init?.body instanceof URLSearchParams ? Object.fromEntries(init.body.entries())
				: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
			headers: (init?.headers ?? {}) as Record<string, string>,
		};
		calls.push(call);
		if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
		const r = script(call);
		return { ok: r.status < 400, status: r.status, json: async () => r.body } as Response;
	}) as unknown as typeof fetch;
});

afterEach(() => vi.restoreAllMocks());

const upload = (file: File, extra: Partial<Parameters<typeof uploadProjectScan>[0]> = {}) =>
	uploadProjectScan({ file, modality: "ct", projectId: PROJECT, userId: "u1", ...extra });

describe("uploading a scan into a project", () => {
	it("sends the chunks, finishes the upload, then adds it to the project", async () => {
		const progress: number[] = [];
		const out = await upload(fileOf(CHUNK_SIZE * 2 + 10), { onProgress: (p) => progress.push(p) });
		expect(out.ok).toBe(true);
		const chunks = calls.filter((c) => c.url.endsWith("/upload-inference-chunk"));
		expect(chunks.map((c) => (c.body as Record<string, unknown>).chunk_index).sort()).toEqual(["0", "1", "2"]);
		expect((chunks[0].body as Record<string, unknown>).chunk_index).toBe("0");   // the first chunk goes alone
		expect(new Set(chunks.map((c) => (c.body as Record<string, unknown>).session_id)).size).toBe(1);
		expect(chunks.every((c) => (c.body as Record<string, unknown>).total_chunks === "3")).toBe(true);
		expect(chunks.every((c) => c.headers["X-Upload-Owner"] === "u1")).toBe(true);
		const [finalize, add] = calls.slice(-2);
		expect(finalize.url).toMatch(/\/finalize-upload$/);
		expect(finalize.body).toMatchObject({ total_chunks: "3", output_filename: "scan.nii.gz" });
		expect(add.url).toMatch(new RegExp(`/projects/${PROJECT}/scans$`));
		expect(add.body).toMatchObject({ uploaded_filename: "BDMAP_00000001/ct.nii.gz", modality: "ct", original_name: "scan.nii.gz" });
		expect((add.body as Record<string, unknown>).session_id).toBe((chunks[0].body as Record<string, unknown>).session_id);
		expect(progress[progress.length - 1]).toBe(100);
		expect(progress).toEqual([...progress].sort((a, b) => a - b));
	});

	it("says which modality was chosen", async () => {
		await upload(fileOf(1000), { modality: "mri" });
		expect(calls[calls.length - 1].body).toMatchObject({ modality: "mri" });
	});

	it("refuses a file that is not a NIfTI before sending anything", async () => {
		const out = await upload(fileOf(1000, "scan.dcm"));
		expect(out).toMatchObject({ ok: false, message: "Only .nii and .nii.gz files can be uploaded." });
		expect(calls).toHaveLength(0);
	});

	it("refuses an empty file and one over the limit before sending anything", async () => {
		expect(await upload(fileOf(0))).toMatchObject({ ok: false, message: "That file is empty." });
		const big = new File([new Uint8Array(1)], "big.nii.gz");
		Object.defineProperty(big, "size", { value: MAX_SCAN_BYTES + 1 });
		expect(await upload(big)).toMatchObject({ ok: false, reason: "too_large" });
		expect(calls).toHaveLength(0);
	});

	it("reports a duplicate with the number it already has", async () => {
		const base = script;
		script = (c) => (c.url.endsWith("/scans") ? { status: 409, body: { error: "This scan is already in the project.", reason: "duplicate", number: 4 } } : base(c));
		expect(await upload(fileOf(1000))).toMatchObject({ ok: false, reason: "duplicate", duplicateOf: 4, message: "This scan is already in the project." });
	});

	it("reports the server's reason when it will not store the scan", async () => {
		const base = script;
		script = (c) => (c.url.endsWith("/scans") ? { status: 400, body: { error: "That file is not a 3D scan volume (.nii or .nii.gz).", reason: "not_a_volume" } } : base(c));
		expect(await upload(fileOf(1000))).toMatchObject({ ok: false, reason: "not_a_volume", message: "That file is not a 3D scan volume (.nii or .nii.gz)." });
	});

	it("stops at the first chunk the server refuses and says so", async () => {
		script = (c) => (c.url.endsWith("/upload-inference-chunk") ? { status: 413, body: {} } : { status: 200, body: {} });
		expect(await upload(fileOf(CHUNK_SIZE * 3))).toMatchObject({ ok: false, reason: "too_large" });
		expect(calls.some((c) => c.url.endsWith("/finalize-upload"))).toBe(false);
	});

	it("says when the account has been signed out", async () => {
		script = () => ({ status: 401, body: {} });
		expect(await upload(fileOf(1000))).toMatchObject({ ok: false, message: "You were signed out. Sign in and upload again." });
	});

	it("does not add the scan when finishing the upload fails", async () => {
		const base = script;
		script = (c) => (c.url.endsWith("/finalize-upload") ? { status: 409, body: { error: "Upload is incomplete; first missing chunk is 1" } } : base(c));
		const out = await upload(fileOf(CHUNK_SIZE + 5));
		expect(out).toMatchObject({ ok: false, message: "Upload is incomplete; first missing chunk is 1" });
		expect(calls.some((c) => c.url.endsWith("/scans"))).toBe(false);
	});

	it("resolves with stopped, and sends nothing more, when it is stopped", async () => {
		const controller = new AbortController();
		controller.abort();
		expect(await upload(fileOf(CHUNK_SIZE * 2), { signal: controller.signal })).toMatchObject({ ok: false, stopped: true });
		expect(calls.some((c) => c.url.endsWith("/finalize-upload"))).toBe(false);
	});

	it("says it could not reach the server when the network is down", async () => {
		global.fetch = vi.fn(async () => { throw new TypeError("Failed to fetch"); }) as unknown as typeof fetch;
		expect(await upload(fileOf(1000))).toMatchObject({ ok: false, message: "Couldn't reach the server. Check your connection and try again." });
	}, 15000);
});
