import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../contexts/authContext";
import { API_BASE } from "../../helpers/constants";

// Diagnostics: is the site healthy right now? Reads the public /api/health, which
// only reports cached state, so this page answers even when the data mount is down.
// The scan library count is asked once (a search is not free), the rest every 30 s.
//
// Admin-only, checked here as well as by the settings nav: a hidden link is not access
// control. A non-admin gets the message and no requests are made.

type Health = {
	status?: string;
	mount?: { ok?: boolean };
	inference?: { running?: number; queued?: number };
};

type State =
	| { kind: "loading" }
	| { kind: "unreachable"; checkedAt: Date }
	| { kind: "ready"; health: Health; ms: number; checkedAt: Date };

// null while asking, -1 when the search failed.
type Library = number | null;

const REFRESH_MS = 30_000;
const GOOD = "#1a8a4a";
const BAD = "#c0392b";

const Dot = ({ ok }: { ok: boolean }) => (
	<span
		aria-hidden="true"
		style={{ display: "inline-block", width: 9, height: 9, borderRadius: "50%", marginRight: 8, background: ok ? GOOD : BAD }}
	/>
);

export default function DiagnosticsSettings() {
	const { user } = useAuth();
	if (!user?.roles.includes("admin")) {
		return (
			<div className="set-group">
				<h2 className="set-heading">Diagnostics</h2>
				<p className="set-sub">You need an admin account to see this.</p>
			</div>
		);
	}
	return <DiagnosticsPanel />;
}

function DiagnosticsPanel() {
	const [state, setState] = useState<State>({ kind: "loading" });
	const [library, setLibrary] = useState<Library>(null);

	const load = useCallback(async (signal?: AbortSignal) => {
		const started = performance.now();
		try {
			const res = await fetch(`${API_BASE}/api/health`, { cache: "no-store", signal });
			// 503 still carries the JSON body: the server is up but degraded.
			const health = (await res.json()) as Health;
			setState({ kind: "ready", health, ms: Math.round(performance.now() - started), checkedAt: new Date() });
		} catch (e) {
			if ((e as Error)?.name !== "AbortError") setState({ kind: "unreachable", checkedAt: new Date() });
		}
	}, []);

	useEffect(() => {
		const controller = new AbortController();
		load(controller.signal);
		const id = window.setInterval(() => load(controller.signal), REFRESH_MS);
		fetch(`${API_BASE}/api/search?limit=1&dataset=all`, { signal: controller.signal })
			.then((res) => res.json())
			.then((body) => setLibrary(typeof body?.total === "number" ? body.total : -1))
			.catch((e) => {
				if ((e as Error)?.name !== "AbortError") setLibrary(-1);
			});
		return () => {
			controller.abort();
			window.clearInterval(id);
		};
	}, [load]);

	const reachable = state.kind === "ready";
	const health = state.kind === "ready" ? state.health : undefined;
	const storageOk = health?.mount?.ok === true;
	const libraryOk = library === null || library > 0;
	const allHealthy = reachable && health?.status === "ok" && storageOk && libraryOk;
	const running = health?.inference?.running ?? 0;
	const queued = health?.inference?.queued ?? 0;
	const checkedAt = state.kind === "loading" ? null : state.checkedAt;

	const headline =
		state.kind === "loading"
			? "Checking…"
			: allHealthy
				? "All systems healthy"
				: reachable
					? "Some systems need attention"
					: "Can't reach the server";

	return (
		<div className="set-group">
			<h2 className="set-heading">Diagnostics</h2>
			<div className="set-row" role="status" aria-live="polite">
				<span className="set-row-label">
					{state.kind !== "loading" && <Dot ok={allHealthy} />}
					{headline}
				</span>
				<span className="set-row-value">
					{checkedAt ? `checked ${checkedAt.toLocaleTimeString()}` : "updates every 30 s"}
				</span>
			</div>
			{state.kind !== "loading" && (
				<>
					<div className="set-row">
						<span className="set-row-label"><Dot ok={reachable} />Website server</span>
						<span className="set-row-value">{reachable ? "Online" : "Unreachable"}</span>
					</div>
					<div className="set-row">
						<span className="set-row-label">
							<Dot ok={storageOk} />Scan storage
							{reachable && !storageOk && (
								<span className="set-row-note">Search and sign-in work, but scans and masks can't be loaded.</span>
							)}
						</span>
						<span className="set-row-value">{!reachable ? "Unknown" : storageOk ? "Available" : "Unavailable"}</span>
					</div>
					<div className="set-row">
						<span className="set-row-label"><Dot ok={libraryOk && reachable} />Scan library</span>
						<span className="set-row-value">
							{library === null ? "Checking…" : library > 0 ? `${library.toLocaleString()} scans` : "Unavailable"}
						</span>
					</div>
					<div className="set-row">
						<span className="set-row-label"><Dot ok={reachable} />Model runs</span>
						<span className="set-row-value">{reachable ? `${running} running, ${queued} queued` : "Unknown"}</span>
					</div>
					<div className="set-row">
						<span className="set-row-label"><Dot ok={reachable} />Response time</span>
						<span className="set-row-value">{state.kind === "ready" ? `${state.ms} ms` : "Unknown"}</span>
					</div>
				</>
			)}
		</div>
	);
}
