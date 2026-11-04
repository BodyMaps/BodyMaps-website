import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../contexts/authContext";
import { API_BASE } from "../../helpers/constants";
import { parseServerTime } from "../../helpers/resetTime";

// Diagnostics: is the site healthy right now? Reads the public /api/health, which
// only reports cached state, so this page answers even when the data mount is down.
// Per-model health comes from /api/admin/models/health (job history, admin-only).
// The scan library count is asked once (a search is not free), the rest every 30 s.
//
// Admin-only, checked here as well as by the settings nav and the endpoint: a hidden
// link is not access control. A non-admin gets the message and no requests are made.

type Health = {
	status?: string;
	mount?: { ok?: boolean };
	inference?: { running?: number; queued?: number };
};

type ModelHealth = {
	model: string;
	status: "healthy" | "failing" | "no_runs";
	completed: number;
	failed: number;
	last_run_at: string | null;
	last_success_at: string | null;
	last_error: string | null;
};

type State =
	| { kind: "loading" }
	| { kind: "unreachable"; checkedAt: Date }
	| { kind: "ready"; health: Health; ms: number; checkedAt: Date };

// null while asking, -1 when the search failed.
type Library = number | null;
// null while asking, "error" when the endpoint did not answer.
type Models = ModelHealth[] | "error" | null;

const REFRESH_MS = 30_000;
const WINDOW_DAYS = 30;
const GOOD = "#1a8a4a";
const BAD = "#c0392b";
const IDLE = "#9aa0a6";

const Dot = ({ ok, idle }: { ok: boolean; idle?: boolean }) => (
	<span
		aria-hidden="true"
		style={{ display: "inline-block", width: 9, height: 9, borderRadius: "50%", marginRight: 8, background: idle ? IDLE : ok ? GOOD : BAD }}
	/>
);

const shortDate = (iso: string | null) =>
	iso ? parseServerTime(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";

const modelValue = (m: ModelHealth) => {
	if (m.status === "no_runs") return `No runs in ${WINDOW_DAYS} days`;
	if (m.status === "failing") return `Last run failed ${shortDate(m.last_run_at)}`;
	return `${m.completed} ok, ${m.failed} failed`;
};

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
	const [models, setModels] = useState<Models>(null);

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
		try {
			const res = await fetch(`${API_BASE}/api/admin/models/health`, { credentials: "include", cache: "no-store", signal });
			if (!res.ok) throw new Error(String(res.status));
			const body = await res.json();
			setModels(Array.isArray(body?.models) ? (body.models as ModelHealth[]) : "error");
		} catch (e) {
			if ((e as Error)?.name !== "AbortError") setModels("error");
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
	const failingModels = Array.isArray(models) ? models.filter((m) => m.status === "failing").length : 0;
	const modelsOk = models !== "error" && failingModels === 0;
	const allHealthy = reachable && health?.status === "ok" && storageOk && libraryOk && modelsOk;
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

	const modelsHeadline =
		models === null
			? "Checking…"
			: models === "error"
				? "Model status unavailable"
				: failingModels === 0
					? "All models healthy"
					: `${failingModels} model${failingModels === 1 ? "" : "s"} need${failingModels === 1 ? "s" : ""} attention`;

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

			<h2 className="set-heading">Models</h2>
			<div className="set-row" role="status" aria-live="polite">
				<span className="set-row-label">
					{models !== null && <Dot ok={modelsOk} />}
					{modelsHeadline}
					{Array.isArray(models) && (
						<span className="set-row-note">
							From each model's most recent finished run in the last {WINDOW_DAYS} days. A fixed model shows healthy once it runs again.
						</span>
					)}
				</span>
			</div>
			{Array.isArray(models) &&
				models.map((m) => (
					<div className="set-row" key={m.model}>
						<span className="set-row-label">
							<Dot ok={m.status !== "failing"} idle={m.status === "no_runs"} />
							{m.model}
							{m.status === "failing" && m.last_error && <span className="set-row-note">{m.last_error}</span>}
						</span>
						<span className="set-row-value">{modelValue(m)}</span>
					</div>
				))}
		</div>
	);
}
