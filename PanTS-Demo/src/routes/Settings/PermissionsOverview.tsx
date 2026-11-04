import { useState } from "react";
import { useAuth } from "../../contexts/authContext";
import {
	PLAN_LIMITS,
	isVerifiedResearcher,
	planLabel,
	type AccountProfile,
	type PlanId,
	type PlanLimits,
} from "../../helpers/accountProfile";

// Permissions: what each kind of visitor can do. The account rows are read from
// PLAN_LIMITS (the UI copy of the server's table), so this page cannot drift from
// the limits the controls are greyed against. Guest and admin are not plans, so
// they are spelled out here, from api/access_policy.py and plan_store.limits_for_user.

type StatusId = "guest" | "free" | "verified" | PlanId | "admin";
type Row = { label: string; value: string };

const unlimited = (n: number | null) => (n === null ? "Unlimited" : String(n));
const yesNo = (v: boolean) => (v ? "Yes" : "No");

const accountRows = (l: PlanLimits): Row[] => [
	{ label: "Open any scan in the library", value: "Yes" },
	{ label: "Scans per day", value: unlimited(l.dailyScans) },
	{ label: "Scans at once", value: unlimited(l.concurrentScans) },
	{ label: "Models", value: l.models ? l.models.join(", ") : "All models" },
	{ label: "Post-processing", value: yesNo(l.postprocessing) },
	{ label: "AI assistant messages per day", value: unlimited(l.dailyAiMessages) },
	{ label: "Create reports", value: yesNo(l.createReports) },
	{ label: "Results kept", value: l.retentionDays === null ? "Forever" : `${l.retentionDays} days` },
	{ label: "Priority queue", value: yesNo(l.priorityQueue) },
];

const STATUSES: { id: StatusId; label: string; note: string; rows: Row[] }[] = [
	{
		id: "guest",
		label: "Guest (not signed in)",
		note: "Browse only. No scans, masks or reports beyond the showcase.",
		rows: [
			{ label: "Browse the dataset library and filters", value: "Yes" },
			{ label: "Statistics", value: "Yes" },
			{ label: "Open the 8 showcase cases (read-only)", value: "Yes" },
			{ label: "Open any other scan", value: "No" },
			{ label: "Run models or upload scans", value: "No" },
			{ label: "AI assistant and reports", value: "No" },
		],
	},
	{
		id: "free",
		label: `${planLabel("free")} account`,
		note: "Any signed-up account.",
		rows: accountRows(PLAN_LIMITS.free),
	},
	{
		id: "verified",
		label: "Verified researcher",
		note: "A Free account with a verified email and a complete profile. Gets Pro limits automatically.",
		rows: accountRows(PLAN_LIMITS.pro),
	},
	{ id: "team", label: planLabel("team"), note: "Pro limits for each member.", rows: accountRows(PLAN_LIMITS.team) },
	{
		id: "enterprise",
		label: planLabel("enterprise"),
		note: "No limits.",
		rows: accountRows(PLAN_LIMITS.enterprise),
	},
	{
		id: "admin",
		label: "Admin",
		note: "Outside the plan limits, whatever plan the account is on.",
		rows: [
			...accountRows({ ...PLAN_LIMITS.enterprise }),
			{ label: "Usage, People and Diagnostics pages", value: "Yes" },
			{ label: "Manage accounts and roles", value: "Yes" },
		],
	},
];

/** The status the signed-in account is on, so the dropdown opens on it. */
const currentStatus = (
	user: { plan: PlanId; roles: string[]; emailVerified?: boolean; profile?: AccountProfile } | null | undefined,
): StatusId => {
	if (!user) return "guest";
	if (user.roles.includes("admin")) return "admin";
	if (user.plan === "free") return isVerifiedResearcher(user) ? "verified" : "free";
	return user.plan;
};

export default function PermissionsOverview() {
	const { user } = useAuth();
	const yours = currentStatus(user);
	const [selected, setSelected] = useState<StatusId>(yours);
	const status = STATUSES.find((s) => s.id === selected) ?? STATUSES[1];

	return (
		<div className="set-group" id="permissions">
			<h2 className="set-heading">Permissions</h2>
			<div className="set-row">
				<label className="set-row-label" htmlFor="permissions-status">
					Status
					<span className="set-row-note">{status.note}</span>
				</label>
				<select
					id="permissions-status"
					className="set-select"
					value={selected}
					onChange={(e) => setSelected(e.target.value as StatusId)}
				>
					{STATUSES.map((s) => (
						<option key={s.id} value={s.id}>
							{s.label}
							{s.id === yours ? " (you)" : ""}
						</option>
					))}
				</select>
			</div>
			{status.rows.map((row) => (
				<div className="set-row" key={row.label}>
					<span className="set-row-label">{row.label}</span>
					<span className="set-row-value">{row.value}</span>
				</div>
			))}
		</div>
	);
}
