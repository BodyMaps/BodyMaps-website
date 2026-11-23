import { type ApiResult, call } from "./assignments";
import { API_BASE } from "./constants";
import { postWithRetry } from "./chunkUpload";

// The scans a project owner uploads into their project. The file travels by the site's own chunked upload (the one the Upload
// page uses) and is then added to the project, which stores it, numbers it from 1 and opens it only for the project's people.

export type Modality = "ct" | "mri";

export type ProjectScan = {
	number: number;
	case_id: string;
	original_name: string;
	modality: Modality;
	size_bytes: number;
	shape: number[];
	spacing: number[];
	uploaded_at: string | null;
};

/** The first characters of a project's id that its scans' ids carry: PRJ_<code>_<number>. */
export const projectCode = (projectId: string) => projectId.slice(0, 8).toLowerCase();

/** The id the viewer and the API use for a project's scan number `n`. */
export const projectCaseId = (projectId: string, n: number) => `PRJ_${projectCode(projectId)}_${String(n).padStart(8, "0")}`;

const PROJECT_CASE = /^PRJ_([0-9a-f]{8})_(\d{8})$/i;

/** Which project (by its code) and which of its scans a case id is, or null for any other id. */
export function parseProjectCaseId(id: unknown): { code: string; number: number } | null {
	const m = PROJECT_CASE.exec(String(id ?? "").trim());
	return m ? { code: m[1].toLowerCase(), number: Number(m[2]) } : null;
}

export const fetchScans = (projectId: string) =>
	call<{ scans: ProjectScan[]; configured: boolean }>(`/projects/${encodeURIComponent(projectId)}/scans`);

export const removeScan = (projectId: string, number: number) =>
	call<{ deleted: boolean }>(`/projects/${encodeURIComponent(projectId)}/scans/${number}`, { method: "DELETE" });

/** The same chunk size and limits as the Upload page. */
export const CHUNK_SIZE = 512 * 1024;
export const MAX_SCAN_BYTES = 2 * 1024 ** 3;
const CONCURRENCY = 4;

export const isNifti = (name: string) => /\.nii(\.gz)?$/i.test(name);

export type UploadOutcome =
	| { ok: true; scan: ProjectScan }
	| { ok: false; message: string; reason?: string; duplicateOf?: number; stopped?: boolean };

const fail = (message: string, extra: Partial<Extract<UploadOutcome, { ok: false }>> = {}): UploadOutcome => ({ ok: false, message, ...extra });

async function reply(res: Response): Promise<Record<string, unknown>> {
	try {
		return (await res.json()) as Record<string, unknown>;
	} catch {
		return {};
	}
}

const sentence = (body: Record<string, unknown>, fallback: string) => (typeof body.error === "string" && body.error ? body.error : fallback);

/**
 * Upload one file into a project: the chunks, the finishing step, then adding it to the project. Resolves with the stored scan
 * or with why it was not stored; it does not throw. A stop (the signal) resolves with `stopped`.
 */
export async function uploadProjectScan(opts: {
	file: File;
	modality: Modality;
	projectId: string;
	userId: string;
	signal?: AbortSignal;
	onProgress?: (percent: number) => void;
}): Promise<UploadOutcome> {
	const { file, modality, projectId, userId, signal, onProgress } = opts;
	if (!isNifti(file.name)) return fail("Only .nii and .nii.gz files can be uploaded.");
	if (file.size > MAX_SCAN_BYTES) return fail("That file is larger than the limit for one scan (2 GB).", { reason: "too_large" });
	if (file.size === 0) return fail("That file is empty.");
	// 128 random bits from the browser's own source, as 32 hex characters (the server wants a safe id of 8 or more).
	const sessionId = [...globalThis.crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
	const total = Math.ceil(file.size / CHUNK_SIZE);
	const headers = { "X-Upload-Owner": userId };
	let done = 0;
	let next = 0;
	try {
		const sendChunk = async (i: number): Promise<UploadOutcome | null> => {
			const body = new FormData();
			body.append("session_id", sessionId);
			body.append("chunk_index", String(i));
			body.append("total_chunks", String(total));
			body.append("file", file.slice(i * CHUNK_SIZE, Math.min((i + 1) * CHUNK_SIZE, file.size)));
			const res = await postWithRetry(`${API_BASE}/api/upload-inference-chunk`, { method: "POST", body, credentials: "include", headers, signal });
			if (res.status === 401) return fail("You were signed out. Sign in and upload again.");
			if (res.status === 413) return fail("The server would not accept a file this large.", { reason: "too_large" });
			if (!res.ok) return fail(sentence(await reply(res), "The upload could not be sent. Try again."));
			done++;
			onProgress?.(Math.round((done / total) * 90));
			return null;
		};
		// The first chunk alone, so the server has written its markers before the rest arrive together.
		const first = await sendChunk(0);
		if (first) return first;
		next = 1;
		let stopped: UploadOutcome | null = null;
		const worker = async () => {
			for (;;) {
				if (stopped) return;
				const i = next++;
				if (i >= total) return;
				const out = await sendChunk(i);
				if (out) { stopped = out; return; }
			}
		};
		await Promise.all(Array.from({ length: Math.min(CONCURRENCY, Math.max(0, total - 1)) }, worker));
		if (stopped) return stopped;

		const fin = await fetch(`${API_BASE}/api/finalize-upload`, {
			method: "POST", credentials: "include", headers, signal,
			body: new URLSearchParams({ session_id: sessionId, total_chunks: String(total), output_filename: file.name }),
		});
		const finBody = await reply(fin);
		if (!fin.ok) return fail(sentence(finBody, "The upload could not be finished. Try again."));
		const uploaded = typeof finBody.uploaded_filename === "string" ? finBody.uploaded_filename : "";
		onProgress?.(95);

		const res = await fetch(`${API_BASE}/api/projects/${encodeURIComponent(projectId)}/scans`, {
			method: "POST", credentials: "include", headers: { "Content-Type": "application/json", ...headers }, signal,
			body: JSON.stringify({ session_id: sessionId, uploaded_filename: uploaded, modality, original_name: file.name }),
		});
		const body = await reply(res);
		if (!res.ok) {
			return fail(sentence(body, "The scan could not be added to the project."), {
				reason: typeof body.reason === "string" ? body.reason : undefined,
				duplicateOf: typeof body.number === "number" ? body.number : undefined,
			});
		}
		onProgress?.(100);
		return { ok: true, scan: body as unknown as ProjectScan };
	} catch (err) {
		if (signal?.aborted || (err instanceof DOMException && err.name === "AbortError")) return fail("Stopped.", { stopped: true });
		return fail("Couldn't reach the server. Check your connection and try again.");
	}
}

export type { ApiResult };
