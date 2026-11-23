import { call } from "./assignments";

// The projects API, for the admin page that creates projects and names their owners.

export type ProjectSummary = {
	id: string;
	name: string;
	slug: string;
	is_default: boolean;
	allow_training: boolean;
	role: "owner" | "collaborator" | null;
};

export type ProjectMember = { id: string; name: string | null; email: string; role: "owner" | "collaborator" };

const enc = encodeURIComponent;

export const fetchProjects = () => call<{ projects: ProjectSummary[] }>("/projects");

export const createProject = (name: string) => call<ProjectSummary>("/projects", { method: "POST", body: JSON.stringify({ name }) });

export const setAllowTraining = (id: string, allowed: boolean) =>
	call<ProjectSummary>(`/projects/${enc(id)}`, { method: "PATCH", body: JSON.stringify({ allow_training: allowed }) });

export const fetchMembers = (id: string) => call<{ members: ProjectMember[] }>(`/projects/${enc(id)}/members`);

export const findByEmail = (id: string, email: string) =>
	call<{ account: { id: string; name: string | null; email: string } | null }>(`/projects/${enc(id)}/find?email=${enc(email)}`);

export const addMember = (id: string, userId: string, role: "owner" | "collaborator") =>
	call<ProjectMember>(`/projects/${enc(id)}/members`, { method: "POST", body: JSON.stringify({ user_id: userId, role }) });

export const removeMember = (id: string, userId: string) =>
	call<{ removed: boolean }>(`/projects/${enc(id)}/members/${enc(userId)}`, { method: "DELETE" });
