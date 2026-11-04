import { useCallback, useEffect, useState } from "react";
import { API_BASE } from "../../helpers/constants";

// Diagnostics: is the site healthy right now? Reads the public /api/health, which
// only reports cached state, so this page answers even when the data mount is down.

type Health = {
	status?: string;
	mount?: { ok?: boolean };
	inference?: { running?: number; queued?: number };
};

type State = { kind: "loading" } | { kind: "unreachable" } | { kind: "ready"; health: Health };

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
	const [state, setState] = useState<State>({ kind: "loading" });

	const load = useCallback(async (signal?: AbortSignal) => {
		try {
			const res = await fetch(`${API_BASE}/api/health`, { cache: "no-store", signal });
			// 503 still carries the JSON body: the server is up but degraded.
			const health = (await res.json()) as Health;
			setState({ kind: "ready", health });
		} catch (e) {
			if ((e as Error)?.name !== "AbortError") setState({ kind: "unreachable" });
		}
	}, []);

	useEffect(() => {
		const controller = new AbortController();
		load(controller.signal);
		const id = window.setInterval(() => load(controller.signal), REFRESH_MS);
		return () => {
			controller.abort();
			window.clearInterval(id);
		};
	}, [load]);

	const reachable = state.kind === "ready";
	const health = state.kind === "ready" ? state.health : undefined;
	const storageOk = health?.mount?.ok === true;
	const allHealthy = reachable && health?.status === "ok" && storageOk;
	const running = health?.inference?.running ?? 0;
	const queued = health?.inference?.queued ?? 0;

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
				<span className="set-row-value">updates every 30 s</span>
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
						<span className="set-row-label"><Dot ok={reachable} />Model runs</span>
						<span className="set-row-value">{reachable ? `${running} running, ${queued} queued` : "Unknown"}</span>
					</div>
				</>
			)}
		</div>
	);
}
