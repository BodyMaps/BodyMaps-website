import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../../contexts/authContext";
import {
	type Modality,
	type ProjectScan,
	fetchScans,
	isNifti,
	removeScan,
	uploadProjectScan,
} from "../../helpers/projectScans";

// Upload dataset: an owner adds scans to their project. Each file is sent one at a time with the site's chunked upload and
// then stored by the server as the project's next case (1, 2, 3...). The project's people open them from their assignments;
// nobody outside the project can.

type Item = { key: string; file: File; modality: Modality; state: "waiting" | "uploading" | "stored" | "failed" | "stopped"; percent: number; message?: string };

const size = (bytes: number) => (bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`);

export default function UploadDataset({ project, onChanged }: { project: { id: string; name: string }; onChanged: () => void }) {
	const { user } = useAuth();
	const [scans, setScans] = useState<ProjectScan[] | null>(null);
	const [configured, setConfigured] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [modality, setModality] = useState<Modality>("ct");
	const [queue, setQueue] = useState<Item[]>([]);
	const [running, setRunning] = useState(false);
	const [removing, setRemoving] = useState<number | null>(null);
	const stop = useRef<AbortController | null>(null);
	const alive = useRef(true);

	const load = useCallback(async () => {
		const res = await fetchScans(project.id);
		if (!alive.current) return;
		if (res.ok) {
			setScans(res.data.scans);
			setConfigured(res.data.configured);
			setError(null);
		} else {
			setError(res.message);
		}
	}, [project.id]);

	useEffect(() => {
		alive.current = true;
		void load();
		return () => { alive.current = false; stop.current?.abort(); };
	}, [load]);

	const patch = (key: string, change: Partial<Item>) => setQueue((q) => q.map((i) => (i.key === key ? { ...i, ...change } : i)));

	const choose = (files: FileList | null) => {
		if (!files || files.length === 0) return;
		const added: Item[] = [...files].map((file, n) => ({
			key: `${Date.now()}-${n}-${file.name}`, file, modality,
			state: isNifti(file.name) ? "waiting" : "failed", percent: 0,
			message: isNifti(file.name) ? undefined : "Only .nii and .nii.gz files can be uploaded.",
		}));
		setQueue((q) => [...q.filter((i) => i.state === "waiting" || i.state === "uploading"), ...added]);
	};

	const start = async () => {
		if (!user || running) return;
		setRunning(true);
		const controller = new AbortController();
		stop.current = controller;
		let stored = 0;
		for (const item of queue.filter((i) => i.state === "waiting")) {
			if (controller.signal.aborted) { patch(item.key, { state: "stopped", message: "Stopped." }); continue; }
			patch(item.key, { state: "uploading", percent: 0 });
			const out = await uploadProjectScan({
				file: item.file, modality: item.modality, projectId: project.id, userId: user.id, signal: controller.signal,
				onProgress: (percent) => { if (alive.current) patch(item.key, { percent }); },
			});
			if (!alive.current) return;
			if (out.ok) {
				stored++;
				patch(item.key, { state: "stored", percent: 100, message: `Stored as case ${out.scan.number}.` });
			} else if (out.stopped) {
				patch(item.key, { state: "stopped", message: "Stopped." });
			} else {
				patch(item.key, { state: "failed", message: out.duplicateOf ? `Already in this project as case ${out.duplicateOf}.` : out.message });
			}
		}
		stop.current = null;
		setRunning(false);
		await load();
		if (stored > 0) onChanged();
	};

	const remove = async (number: number) => {
		setError(null);
		const res = await removeScan(project.id, number);
		setRemoving(null);
		if (!res.ok) { setError(res.message); return; }
		await load();
		onChanged();
	};

	const waiting = queue.filter((i) => i.state === "waiting").length;

	return (
		<div data-testid="upload-dataset">
			<p className="asg-sub">
				Scans uploaded here are stored on the server and become this project's cases, numbered from 1. Only the people in {project.name} can open them.
			</p>
			{!configured && <p className="asg-banner asg-banner--error" role="alert" data-testid="not-configured">Dataset uploads are not set up on this server yet.</p>}
			{error && <p className="asg-banner asg-banner--error" role="alert">{error}</p>}

			<fieldset className="asg-people" disabled={running || !configured}>
				<legend className="asg-step-label">What are these scans?</legend>
				<div className="asg-radio-row">
					{(["ct", "mri"] as const).map((m) => (
						<label key={m} className={modality === m ? "is-on" : ""}>
							<input type="radio" name="modality" value={m} checked={modality === m} onChange={() => setModality(m)} />
							<span>{m === "ct" ? "CT" : "MRI"}</span>
						</label>
					))}
				</div>
				<label className="asg-field">
					<span>Choose files (.nii or .nii.gz, up to 2 GB each)</span>
					<input className="asg-input" type="file" accept=".nii,.gz,.nii.gz" multiple data-testid="scan-files" onChange={(e) => { choose(e.target.files); e.target.value = ""; }} />
				</label>
			</fieldset>

			{queue.length > 0 && (
				<ul className="asg-account-list asg-upload-list" aria-label="Files to upload" data-testid="upload-queue">
					{queue.map((i) => (
						<li key={i.key} data-state={i.state}>
							<span>
								<strong>{i.file.name}</strong>
								<span className="asg-note"> {size(i.file.size)} · {i.modality === "ct" ? "CT" : "MRI"}</span>
							</span>
							<span className={`asg-upload-state asg-upload-state--${i.state}`} role={i.state === "failed" ? "alert" : undefined}>
								{i.state === "waiting" && "Waiting"}
								{i.state === "uploading" && `Uploading ${i.percent}%`}
								{(i.state === "stored" || i.state === "failed" || i.state === "stopped") && i.message}
							</span>
						</li>
					))}
				</ul>
			)}

			<div className="asg-actions">
				<button type="button" className="asg-btn asg-btn--primary" disabled={running || waiting === 0 || !configured} onClick={() => void start()} data-testid="start-upload">
					{running ? "Uploading…" : waiting > 1 ? `Upload ${waiting} scans` : "Upload"}
				</button>
				{running && <button type="button" className="asg-btn" onClick={() => stop.current?.abort()}>Stop</button>}
			</div>

			<h3 className="asg-person-name asg-annotators-heading">
				{scans === null ? "Scans in this project" : `Scans in this project (${scans.length})`}
			</h3>
			{scans !== null && scans.length === 0 && <p className="asg-note" data-testid="no-scans">No scans yet.</p>}
			{scans !== null && scans.length > 0 && (
				<ul className="asg-account-list" aria-label="Scans in this project" data-testid="scan-list">
					{scans.map((s) => (
						<li key={s.case_id}>
							<span>
								<strong>Case {s.number}</strong>
								<span className="asg-note"> {s.original_name} · {s.modality === "ct" ? "CT" : "MRI"} · {size(s.size_bytes)}</span>
							</span>
							{removing === s.number ? (
								<span className="asg-confirm">
									<span className="asg-confirm-text">Remove case {s.number} and its file? Cases handed out for it stay in the assignments.</span>
									<button type="button" className="asg-btn asg-btn--danger" onClick={() => void remove(s.number)}>Yes, remove</button>
									<button type="button" className="asg-btn" onClick={() => setRemoving(null)}>Keep</button>
								</span>
							) : (
								<button type="button" className="asg-btn" disabled={running} onClick={() => setRemoving(s.number)}>Remove</button>
							)}
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
