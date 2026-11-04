import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import DiagnosticsSettings from "../routes/Settings/DiagnosticsSettings";

const auth = vi.hoisted(() => ({ roles: ["admin"] as string[] }));
vi.mock("../contexts/authContext", () => ({
	useAuth: () => ({ user: { roles: auth.roles } }),
}));

const model = (over: Record<string, unknown>) => ({
	model: "ePAI", status: "healthy", completed: 402, failed: 0,
	last_run_at: "2026-11-03T20:00:00", last_success_at: "2026-11-03T20:00:00", last_error: null, ...over,
});
const GOOD_MODELS = [model({}), model({ model: "SuPreM", status: "no_runs", completed: 0, last_run_at: null, last_success_at: null })];

type Options = { status?: number; total?: number | "fail"; models?: unknown[] | "fail" };

// /api/health gets `body`; the one-off library search gets `total`; the admin model endpoint `models`.
const reply = (body: unknown, { status = 200, total = 43585, models = GOOD_MODELS }: Options = {}) =>
	vi.fn().mockImplementation(async (url: string) => {
		if (String(url).includes("/api/search")) {
			if (total === "fail") throw new TypeError("search failed");
			return { ok: true, status: 200, json: async () => ({ total }) };
		}
		if (String(url).includes("/api/admin/models/health")) {
			if (models === "fail") return { ok: false, status: 500, json: async () => ({}) };
			return { ok: true, status: 200, json: async () => ({ window_days: 30, models }) };
		}
		return { ok: status < 400, status, json: async () => body };
	});

const UP = { status: "ok", mount: { ok: true }, inference: { running: 0, queued: 0 } };

afterEach(() => {
	auth.roles = ["admin"];
	cleanup();
	vi.unstubAllGlobals();
});

describe("Diagnostics settings", () => {
	it("says everything is healthy when the server, scan storage, library and models are up", async () => {
		vi.stubGlobal("fetch", reply({ ...UP, inference: { running: 1, queued: 2 } }));
		render(<DiagnosticsSettings />);
		expect(await screen.findByText("All systems healthy")).toBeTruthy();
		expect(screen.getByText("Available")).toBeTruthy();
		expect(screen.getByText("1 running, 2 queued")).toBeTruthy();
		expect(await screen.findByText("43,585 scans")).toBeTruthy();
		expect(screen.getByText(/^\d+ ms$/)).toBeTruthy();
		expect(await screen.findByText("All models healthy")).toBeTruthy();
	});

	it("lists every model with how its runs went, and shows idle ones as not a problem", async () => {
		vi.stubGlobal("fetch", reply(UP));
		render(<DiagnosticsSettings />);
		expect(await screen.findByText("402 ok, 0 failed")).toBeTruthy();
		expect(screen.getByText("SuPreM")).toBeTruthy();
		expect(screen.getByText("No runs in 30 days")).toBeTruthy();
		expect(await screen.findByText("All systems healthy")).toBeTruthy();
	});

	it("flags a model whose last run failed and turns the headline to needs attention", async () => {
		const failing = model({ model: "Atlas-Net", status: "failing", completed: 8, failed: 2, last_run_at: "2026-11-02T23:55:29", last_error: "Expected Atlas-Net output not found" });
		vi.stubGlobal("fetch", reply(UP, { models: [failing, ...GOOD_MODELS] }));
		render(<DiagnosticsSettings />);
		expect(await screen.findByText("1 model needs attention")).toBeTruthy();
		expect(screen.getByText("Expected Atlas-Net output not found")).toBeTruthy();
		expect(screen.getByText(/^Last run failed /)).toBeTruthy();
		expect(screen.getByText("Some systems need attention")).toBeTruthy();
	});

	it("says model status is unavailable, and needs attention, when that endpoint fails", async () => {
		vi.stubGlobal("fetch", reply(UP, { models: "fail" }));
		render(<DiagnosticsSettings />);
		expect(await screen.findByText("Model status unavailable")).toBeTruthy();
		expect(screen.getByText("Some systems need attention")).toBeTruthy();
	});

	it("flags a degraded server whose scan storage is down (HTTP 503 still carries the body)", async () => {
		vi.stubGlobal("fetch", reply({ status: "degraded", mount: { ok: false }, inference: { running: 0, queued: 0 } }, { status: 503 }));
		render(<DiagnosticsSettings />);
		expect(await screen.findByText("Some systems need attention")).toBeTruthy();
		expect(screen.getByText("Unavailable")).toBeTruthy();
	});

	it("flags a failing scan library even when the server is up", async () => {
		vi.stubGlobal("fetch", reply(UP, { total: "fail" }));
		render(<DiagnosticsSettings />);
		expect(await screen.findByText("Some systems need attention")).toBeTruthy();
		expect(await screen.findByText("Unavailable")).toBeTruthy();
	});

	it("is for admins only: anyone else gets the message and no requests are made", async () => {
		auth.roles = [];
		const fetchMock = reply(UP);
		vi.stubGlobal("fetch", fetchMock);
		render(<DiagnosticsSettings />);
		expect(screen.getByText("You need an admin account to see this.")).toBeTruthy();
		expect(screen.queryByText("All systems healthy")).toBeNull();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("says so when the server cannot be reached", async () => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network down")));
		render(<DiagnosticsSettings />);
		expect(await screen.findByText("Can't reach the server")).toBeTruthy();
		expect(screen.getByText("Unreachable")).toBeTruthy();
	});
});
