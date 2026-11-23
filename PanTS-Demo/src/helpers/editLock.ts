import { useCallback, useEffect, useRef, useState } from "react";

// One annotator edits a dataset scan's shared version at a time (flask-server/services/edit_lock_store.py).
// The first annotator to start editing holds the scan; their open page renews the hold every minute, so a break with
// the scan open never loses it. Everyone else sees the scan view only until the holder closes it, or until the hold
// lapses after the server's limit (30 minutes by default) when the holder's page has gone quiet.

export type EditLock = {
	held: boolean;
	mine: boolean;
	holder: string | null;
	expires_at: string | null;
	ttl_seconds?: number;
};

/** How often the holder's page renews the hold, and how often a waiting page checks whether the scan is free. */
export const RENEW_EVERY_MS = 60_000;

const lockUrl = (apiBase: string, caseId: string | number) =>
	`${apiBase}/api/shared-annotation/${encodeURIComponent(String(caseId))}/lock`;

type LockResult = { ok: true; lock: EditLock } | { ok: false; status: number; lock?: EditLock; error?: string };

async function call(url: string, method: string, signal?: AbortSignal, keepalive = false): Promise<LockResult> {
	try {
		const resp = await fetch(url, { method, credentials: "include", cache: "no-store", signal, keepalive });
		const body = await resp.json().catch(() => null);
		if (resp.ok) return { ok: true, lock: body as EditLock };
		const lock = body && typeof body.held === "boolean" ? (body as EditLock) : undefined;
		return { ok: false, status: resp.status, lock, error: body?.error };
	} catch {
		return { ok: false, status: 0 };
	}
}

export const fetchEditLock = (apiBase: string, caseId: string | number, signal?: AbortSignal) =>
	call(lockUrl(apiBase, caseId), "GET", signal);
export const acquireEditLock = (apiBase: string, caseId: string | number) =>
	call(lockUrl(apiBase, caseId), "POST");
/** Let go of the caller's own hold. `keepalive` lets it finish while the page is closing. */
export const releaseEditLock = (apiBase: string, caseId: string | number, keepalive = false) =>
	call(lockUrl(apiBase, caseId), "DELETE", undefined, keepalive);
export const takeOverEditLock = (apiBase: string, caseId: string | number) =>
	call(`${lockUrl(apiBase, caseId)}/take-over`, "POST");

export type EditLockState = {
	/** Who else is editing this scan right now; null when the caller may edit. */
	blockedBy: string | null;
	/** True while the caller holds the scan. */
	holding: boolean;
	/** Annotation managers only: move the hold to the caller. */
	takeOver: () => Promise<void>;
	takeOverError: string | null;
};

/**
 * Keep the edit lock for one scan in step with what the person is doing.
 *
 * `enabled`: the person may change the shared version of this scan (the server's can_override).
 * `editing`: an editing tool is in use. The hold is taken the first time this turns true, renewed every minute while
 * the page is open, and let go when the person leaves the scan or closes the page.
 */
export function useEditLock(apiBase: string, caseId: string | number, enabled: boolean, editing: boolean): EditLockState {
	// State is tagged with the scan it is about, so moving to another scan starts clean without resetting in an effect.
	const scan = String(caseId);
	const [state, setState] = useState<{ scan: string; holding: boolean; blockedBy: string | null; takeOverError: string | null }>(
		{ scan, holding: false, blockedBy: null, takeOverError: null },
	);
	const current = state.scan === scan ? state : { scan, holding: false, blockedBy: null, takeOverError: null };
	const { holding, blockedBy, takeOverError } = current;
	const holdingRef = useRef(false);
	const requesting = useRef(false);

	const apply = useCallback((lock: EditLock | undefined) => {
		if (!lock) return;
		const mine = lock.held && lock.mine;
		holdingRef.current = mine;
		setState({ scan, holding: mine, blockedBy: lock.held && !lock.mine ? lock.holder || "Another annotator" : null, takeOverError: null });
	}, [scan]);

	// Show straight away if someone else is already editing this scan.
	useEffect(() => {
		holdingRef.current = false;
		if (!enabled) return;
		const controller = new AbortController();
		void fetchEditLock(apiBase, caseId, controller.signal).then((res) => {
			if (!controller.signal.aborted && (res.ok || res.lock)) apply(res.ok ? res.lock : res.lock);
		});
		return () => controller.abort();
	}, [apiBase, caseId, enabled, apply]);

	// Starting to edit takes the hold.
	useEffect(() => {
		if (!enabled || !editing || holdingRef.current || requesting.current) return;
		requesting.current = true;
		void acquireEditLock(apiBase, caseId).then((res) => {
			requesting.current = false;
			if (res.ok || res.lock) apply(res.ok ? res.lock : res.lock);
		});
	}, [apiBase, caseId, enabled, editing, apply]);

	// While held: renew every minute (a break with the scan open keeps it). While someone else holds it: check every
	// minute whether they have finished.
	useEffect(() => {
		if (!enabled || (!holding && !blockedBy)) return;
		const timer = window.setInterval(() => {
			const request = holdingRef.current ? acquireEditLock(apiBase, caseId) : fetchEditLock(apiBase, caseId);
			void request.then((res) => { if (res.ok || res.lock) apply(res.ok ? res.lock : res.lock); });
		}, RENEW_EVERY_MS);
		return () => window.clearInterval(timer);
	}, [apiBase, caseId, enabled, holding, blockedBy, apply]);

	// Leaving the scan or closing the page lets go, so the next person need not wait for the hold to lapse.
	useEffect(() => {
		if (!enabled) return;
		const letGo = () => {
			if (!holdingRef.current) return;
			holdingRef.current = false;
			void releaseEditLock(apiBase, caseId, true);
		};
		window.addEventListener("pagehide", letGo);
		return () => {
			window.removeEventListener("pagehide", letGo);
			letGo();
		};
	}, [apiBase, caseId, enabled]);

	const takeOver = useCallback(async () => {
		const res = await takeOverEditLock(apiBase, caseId);
		if (res.ok) apply(res.lock);
		else setState((s) => ({ ...s, scan, takeOverError: res.error || "Couldn't take over this scan. Try again." }));
	}, [apiBase, caseId, apply, scan]);

	return { blockedBy: enabled ? blockedBy : null, holding: enabled && holding, takeOver, takeOverError };
}
