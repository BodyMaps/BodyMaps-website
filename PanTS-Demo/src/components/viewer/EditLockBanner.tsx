import { useState } from "react";
import "./EditLockBanner.css";

// Shown above the viewer when another annotator is editing this scan: it is view only until they finish. An
// annotation manager can take the scan over, for example when someone forgot to close it.

export default function EditLockBanner({ holder, canTakeOver, onTakeOver, error }: {
	holder: string;
	canTakeOver: boolean;
	onTakeOver: () => Promise<void>;
	error: string | null;
}) {
	const [busy, setBusy] = useState(false);
	const takeOver = async () => {
		if (busy) return;
		if (!window.confirm(`Take this scan over from ${holder}? They will no longer be able to save their edits to it.`)) return;
		setBusy(true);
		try { await onTakeOver(); } finally { setBusy(false); }
	};
	return (
		<div className="edit-lock-bar" role="status">
			<span><b>{holder}</b> is editing this scan. It is view only until they finish.</span>
			{canTakeOver && (
				<button type="button" className="edit-lock-btn" disabled={busy} onClick={() => void takeOver()}>
					Take over
				</button>
			)}
			{error && <span className="edit-lock-error" role="alert">{error}</span>}
		</div>
	);
}
