import React, { useCallback, useEffect, useState } from "react";
import {
	type ProjectMember,
	type ProjectSummary,
	addMember,
	createProject,
	fetchMembers,
	fetchProjects,
	findByEmail,
	removeMember,
	setAllowTraining,
} from "../../helpers/projects";
import { useSettings } from "./context";

// Admin: create a project, name its owners, and say whether its scans may be used for training. An owner then adds their own
// collaborators and uploads their dataset from the Assignments page. The built-in JHU project is listed but not changed here:
// its owners are set on the server, and its collaborators are chosen on the Assignments page.

const personLabel = (p: { name: string | null; email: string }) => p.name || p.email;

const ProjectCard: React.FC<{ project: ProjectSummary; onChanged: () => void }> = ({ project, onChanged }) => {
	const { run, notify } = useSettings();
	const [members, setMembers] = useState<ProjectMember[] | null>(null);
	const [email, setEmail] = useState("");
	const [removing, setRemoving] = useState<string | null>(null);

	const load = useCallback(async () => {
		const res = await fetchMembers(project.id);
		if (res.ok) setMembers(res.data.members);
	}, [project.id]);
	useEffect(() => { void load(); }, [load]);

	const owners = (members ?? []).filter((m) => m.role === "owner");
	const collaborators = (members ?? []).filter((m) => m.role === "collaborator");

	const addOwner = (e: React.FormEvent) => {
		e.preventDefault();
		const address = email.trim();
		if (!address) return;
		void run(async () => {
			const found = await findByEmail(project.id, address);
			if (!found.ok) throw new Error(found.message);
			if (!found.data.account) throw new Error("No account has that email address. They need to sign up on the website first.");
			const added = await addMember(project.id, found.data.account.id, "owner");
			if (!added.ok) throw new Error(added.message);
			setEmail("");
			notify(`${personLabel(found.data.account)} is now an owner of ${project.name}.`);
			await load();
		}, `project-owner-${project.id}`);
	};

	const drop = (m: ProjectMember) => {
		void run(async () => {
			const res = await removeMember(project.id, m.id);
			if (!res.ok) throw new Error(res.message);
			setRemoving(null);
			notify(`${personLabel(m)} was removed from ${project.name}.`);
			await load();
		}, `project-member-${project.id}`);
	};

	const toggleTraining = (allowed: boolean) => {
		void run(async () => {
			const res = await setAllowTraining(project.id, allowed);
			if (!res.ok) throw new Error(res.message);
			notify(allowed ? `${project.name}'s scans may now be used for training.` : `${project.name}'s scans are no longer used for training.`);
			onChanged();
		}, `project-training-${project.id}`);
	};

	return (
		<div className="set-group" data-testid="project-card" data-project={project.id}>
			<h2 className="set-heading">{project.name}</h2>
			{project.is_default ? (
				<div className="set-row">
					<span className="set-row-label">The shared library<span className="set-row-note">Its owners are set on the server. Its collaborators are chosen on the Assignments page.</span></span>
				</div>
			) : (
				<>
					<div className="set-row">
						<span className="set-row-label">Owners</span>
						<span className="set-row-value">{members === null ? "Loading…" : owners.length === 0 ? "None yet" : owners.length}</span>
					</div>
					{owners.map((m) => (
						<div className="set-row" key={m.id}>
							<span className="set-row-label">{personLabel(m)}{m.name && <span className="set-row-note">{m.email}</span>}</span>
							{removing === m.id ? (
								<span className="set-row-value">
									<button type="button" className="set-btn set-btn--danger" onClick={() => drop(m)}>Yes, remove</button>{" "}
									<button type="button" className="set-btn" onClick={() => setRemoving(null)}>Keep</button>
								</span>
							) : (
								<button type="button" className="set-btn" onClick={() => setRemoving(m.id)} aria-label={`Remove ${personLabel(m)} as an owner`}>Remove</button>
							)}
						</div>
					))}
					<form className="set-row" onSubmit={addOwner}>
						<label className="set-row-label" htmlFor={`owner-email-${project.id}`}>Add an owner<span className="set-row-note">Their full email address. They must already have an account.</span></label>
						<span className="set-row-value">
							<input id={`owner-email-${project.id}`} className="set-input" type="email" value={email} autoComplete="off" placeholder="name@university.edu" onChange={(e) => setEmail(e.target.value)} />{" "}
							<button type="submit" className="set-btn" disabled={!email.trim()}>Add owner</button>
						</span>
					</form>
					<div className="set-row">
						<span className="set-row-label">Collaborators</span>
						<span className="set-row-value">{members === null ? "Loading…" : collaborators.length}</span>
					</div>
					<div className="set-row">
						<label className="set-row-label" htmlFor={`training-${project.id}`}>Allow training<span className="set-row-note">Whether this project's scans may be used to train models. Off unless you turn it on.</span></label>
						<input id={`training-${project.id}`} type="checkbox" role="switch" checked={project.allow_training} onChange={(e) => toggleTraining(e.target.checked)} />
					</div>
				</>
			)}
		</div>
	);
};

const ProjectsSettings: React.FC = () => {
	const { run, notify } = useSettings();
	const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [name, setName] = useState("");

	const load = useCallback(async () => {
		const res = await fetchProjects();
		if (res.ok) { setProjects(res.data.projects); setLoadError(null); } else { setLoadError(res.message); }
	}, []);
	useEffect(() => { void load(); }, [load]);

	const create = (e: React.FormEvent) => {
		e.preventDefault();
		const n = name.trim();
		if (!n) return;
		void run(async () => {
			const res = await createProject(n);
			if (!res.ok) throw new Error(res.message);
			setName("");
			notify(`${res.data.name} was created. Add its owners below.`);
			await load();
		}, "project-create");
	};

	return (
		<div data-testid="projects-settings">
			<div className="set-group">
				<h2 className="set-heading">Projects</h2>
				<form className="set-row" onSubmit={create}>
					<label className="set-row-label" htmlFor="new-project-name">New project<span className="set-row-note">A group that works on its own cases, for example another lab. You then name its owners.</span></label>
					<span className="set-row-value">
						<input id="new-project-name" className="set-input" value={name} maxLength={80} autoComplete="off" placeholder="Stanford Lab" onChange={(e) => setName(e.target.value)} />{" "}
						<button type="submit" className="set-btn" disabled={!name.trim()}>Create project</button>
					</span>
				</form>
				{loadError && <div className="set-row" role="alert"><span className="set-row-label">{loadError}</span><button type="button" className="set-btn" onClick={() => void load()}>Try again</button></div>}
			</div>
			{projects === null && !loadError && <p className="set-row-note">Loading…</p>}
			{projects?.map((p) => <ProjectCard key={p.id} project={p} onChanged={() => void load()} />)}
		</div>
	);
};

export default ProjectsSettings;
