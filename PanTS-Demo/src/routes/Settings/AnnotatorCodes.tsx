import { useCallback, useEffect, useState } from "react";
import { API_BASE } from "../../helpers/constants";
import { parseServerTime } from "../../helpers/resetTime";

// Temporary codes that let a person edit what every visitor sees (the annotator role).
//
// The other way to grant it is Edit > "Make annotator" on a person below. A code is for when you would
// rather hand someone a code than look their account up: it works once, expires, and can be withdrawn. The
// server keeps only a digest, so the code is shown here exactly once, when it is made.

type Invite = {
	id: string;
	status: "open" | "redeemed" | "expired";
	created_at: string | null;
	expires_at: string | null;
	redeemed_at: string | null;
	redeemed_by: string | null;
};

type Created = { id: string; code: string; expires_at: string };

const LIFETIMES = [
	{ hours: 1, label: "1 hour" },
	{ hours: 24, label: "1 day" },
	{ hours: 24 * 7, label: "7 days" },
];

const when = (iso: string | null) => {
	if (!iso) return "";
	const date = parseServerTime(iso);
	return Number.isNaN(date.getTime())
		? ""
		: date.toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
};

const AnnotatorCodes: React.FC = () => {
	const [hours, setHours] = useState(24);
	const [invites, setInvites] = useState<Invite[]>([]);
	const [created, setCreated] = useState<Created | null>(null);
	const [copied, setCopied] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(async () => {
		try {
			const res = await fetch(`${API_BASE}/api/admin/annotator-invites`, { credentials: "include" });
			if (!res.ok) throw new Error();
			setInvites((await res.json()).invites ?? []);
		} catch {
			setError("Couldn't load the codes.");
		}
	}, []);

	useEffect(() => { void load(); }, [load]);

	const create = async () => {
		setBusy(true);
		setError(null);
		setCopied(false);
		try {
			const res = await fetch(`${API_BASE}/api/admin/annotator-invites`, {
				method: "POST",
				credentials: "include",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ hours }),
			});
			if (!res.ok) throw new Error();
			setCreated(await res.json());
			await load();
		} catch {
			setError("Couldn't create a code. Try again.");
		} finally {
			setBusy(false);
		}
	};

	const withdraw = async (id: string) => {
		setBusy(true);
		setError(null);
		try {
			const res = await fetch(`${API_BASE}/api/admin/annotator-invites/${encodeURIComponent(id)}`, {
				method: "DELETE",
				credentials: "include",
			});
			if (!res.ok && res.status !== 404) throw new Error();
			if (created?.id === id) setCreated(null);
			await load();
		} catch {
			setError("Couldn't withdraw that code. Try again.");
		} finally {
			setBusy(false);
		}
	};

	const copy = async () => {
		if (!created) return;
		try {
			await navigator.clipboard.writeText(created.code);
			setCopied(true);
		} catch {
			setCopied(false); // the code is on screen; they can select it by hand
		}
	};

	return (
		<div className="set-group" data-testid="annotator-codes">
			<h2 className="set-heading">Annotator access code</h2>
			<p className="set-sub">
				A one-time code that lets someone save corrected scans for everyone. It expires after the time you choose.
			</p>

			<div className="set-picture-actions">
				<label className="set-row-note" htmlFor="annotator-code-lifetime">Works for</label>
				<select
					id="annotator-code-lifetime"
					className="set-input"
					value={hours}
					disabled={busy}
					onChange={(e) => setHours(Number(e.target.value))}
				>
					{LIFETIMES.map((option) => <option key={option.hours} value={option.hours}>{option.label}</option>)}
				</select>
				<button className="set-btn" type="button" disabled={busy} onClick={() => void create()}>
					Create code
				</button>
			</div>

			{created && (
				<div className="set-banner" role="status" data-testid="annotator-code-created">
					<p>
						<strong style={{ fontSize: "1.25em", letterSpacing: "0.08em", userSelect: "all" }}>{created.code}</strong>
					</p>
					<p className="set-row-note">
						Shown once. Valid until {when(created.expires_at)}.
					</p>
					<button className="set-btn" type="button" onClick={() => void copy()}>
						{copied ? "Copied" : "Copy"}
					</button>
				</div>
			)}

			{error && <div className="set-banner set-banner--error" role="alert">{error}</div>}

			{invites.length > 0 && (
				<ul className="dash-list" aria-label="Recent codes">
					{invites.map((invite) => (
						<li key={invite.id} className="set-row">
							<span className="set-row-label">
								{invite.status === "open" && `Open until ${when(invite.expires_at)}`}
								{invite.status === "redeemed" && `Used by ${invite.redeemed_by ?? "a deleted account"}, ${when(invite.redeemed_at)}`}
								{invite.status === "expired" && `Expired ${when(invite.expires_at)}`}
								<span className="set-row-note">Created {when(invite.created_at)}</span>
							</span>
							{invite.status === "open" && (
								<button className="set-btn" type="button" disabled={busy} onClick={() => void withdraw(invite.id)}>
									Withdraw
								</button>
							)}
						</li>
					))}
				</ul>
			)}
		</div>
	);
};

export default AnnotatorCodes;
