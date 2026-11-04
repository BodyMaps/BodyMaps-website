import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import DiagnosticsSettings from "../routes/Settings/DiagnosticsSettings";

const auth = vi.hoisted(() => ({ roles: ["admin"] as string[] }));
vi.mock("../contexts/authContext", () => ({
	useAuth: () => ({ user: { roles: auth.roles } }),
}));

// /api/health gets `body`; the one-off library search gets `total`.
const reply = (body: unknown, status = 200, total: number | "fail" = 43585) =>
	vi.fn().mockImplementation(async (url: string) => {
		if (String(url).includes("/api/search")) {
			if (total === "fail") throw new TypeError("search failed");
			return { status: 200, json: async () => ({ total }) };
		}
		return { status, json: async () => body };
	});

afterEach(() => {
	auth.roles = ["admin"];
	cleanup();
	vi.unstubAllGlobals();
});

describe("Diagnostics settings", () => {
	it("says everything is healthy when the server, scan storage and library are up", async () => {
		vi.stubGlobal("fetch", reply({ status: "ok", mount: { ok: true }, inference: { running: 1, queued: 2 } }));
		render(<DiagnosticsSettings />);
		expect(await screen.findByText("All systems healthy")).toBeTruthy();
		expect(screen.getByText("Available")).toBeTruthy();
		expect(screen.getByText("1 running, 2 queued")).toBeTruthy();
		expect(await screen.findByText("43,585 scans")).toBeTruthy();
		expect(screen.getByText(/^\d+ ms$/)).toBeTruthy();
	});

	it("flags a degraded server whose scan storage is down (HTTP 503 still carries the body)", async () => {
		vi.stubGlobal("fetch", reply({ status: "degraded", mount: { ok: false }, inference: { running: 0, queued: 0 } }, 503));
		render(<DiagnosticsSettings />);
		expect(await screen.findByText("Some systems need attention")).toBeTruthy();
		expect(screen.getByText("Unavailable")).toBeTruthy();
	});

	it("flags a failing scan library even when the server is up", async () => {
		vi.stubGlobal("fetch", reply({ status: "ok", mount: { ok: true }, inference: { running: 0, queued: 0 } }, 200, "fail"));
		render(<DiagnosticsSettings />);
		expect(await screen.findByText("Some systems need attention")).toBeTruthy();
		expect(await screen.findByText("Unavailable")).toBeTruthy();
	});

	it("is for admins only: anyone else gets the message and no requests are made", async () => {
		auth.roles = [];
		const fetchMock = reply({ status: "ok", mount: { ok: true } });
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
