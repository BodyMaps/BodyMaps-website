import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "../contexts/authContext";

// The signed-in account carries the projects it belongs to, each with its role there. A server that sends none, or
// something unexpected, leaves the account with none or with no role: it fails closed.

const respond = (user: unknown) => {
	global.fetch = vi.fn(async (url: RequestInfo | URL) => {
		const body = String(url).includes("/api/auth/me") ? { user } : { items: [], total: 0, ids: [] };
		return { ok: true, status: 200, json: async () => body, text: async () => "", headers: { get: () => "application/json" } };
	}) as unknown as typeof fetch;
};

const Show: React.FC = () => {
	const { user } = useAuth();
	return <p data-testid="out">{user ? JSON.stringify(user.projects) : "signed out"}</p>;
};

const shown = async () => JSON.parse((await screen.findByTestId("out")).textContent ?? "null");

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("projects on the signed-in account", () => {
	it("maps each project and its role", async () => {
		respond({
			id: "u1", email: "a@x.org", plan: "free", roles: [],
			projects: [
				{ id: "jhu", name: "JHU", slug: "jhu", is_default: true, allow_training: false, role: "collaborator" },
				{ id: "p2", name: "Stanford Lab", slug: "stanford-lab", is_default: false, allow_training: true, role: "owner" },
			],
		});
		render(<AuthProvider><Show /></AuthProvider>);
		await vi.waitFor(async () => expect(await shown()).not.toBe("signed out"));
		expect(await shown()).toEqual([
			{ id: "jhu", name: "JHU", slug: "jhu", isDefault: true, allowTraining: false, role: "collaborator" },
			{ id: "p2", name: "Stanford Lab", slug: "stanford-lab", isDefault: false, allowTraining: true, role: "owner" },
		]);
	});

	it("has no projects when the server sends none", async () => {
		respond({ id: "u1", email: "a@x.org", plan: "free", roles: [] });
		render(<AuthProvider><Show /></AuthProvider>);
		await vi.waitFor(async () => expect(await shown()).toEqual([]));
	});

	it.each(["admin", "annotator", "", null, 7])("reads the role %j as no role", async (role) => {
		respond({ id: "u1", email: "a@x.org", plan: "free", roles: [], projects: [{ id: "p", name: "P", slug: "p", role }] });
		render(<AuthProvider><Show /></AuthProvider>);
		await vi.waitFor(async () => expect((await shown())[0]?.role).toBeNull());
	});
});
