import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import DiagnosticsSettings from "../routes/Settings/DiagnosticsSettings";

const reply = (body: unknown, status = 200) =>
	vi.fn().mockResolvedValue({ status, json: async () => body });

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe("Diagnostics settings", () => {
	it("says everything is healthy when the server and the scan storage are up", async () => {
		vi.stubGlobal("fetch", reply({ status: "ok", mount: { ok: true }, inference: { running: 1, queued: 2 } }));
		render(<DiagnosticsSettings />);
		expect(await screen.findByText("All systems healthy")).toBeTruthy();
		expect(screen.getByText("Available")).toBeTruthy();
		expect(screen.getByText("1 running, 2 queued")).toBeTruthy();
	});

	it("flags a degraded server whose scan storage is down (HTTP 503 still carries the body)", async () => {
		vi.stubGlobal("fetch", reply({ status: "degraded", mount: { ok: false }, inference: { running: 0, queued: 0 } }, 503));
		render(<DiagnosticsSettings />);
		expect(await screen.findByText("Some systems need attention")).toBeTruthy();
		expect(screen.getByText("Unavailable")).toBeTruthy();
	});

	it("says so when the server cannot be reached", async () => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network down")));
		render(<DiagnosticsSettings />);
		expect(await screen.findByText("Can't reach the server")).toBeTruthy();
		expect(screen.getByText("Unreachable")).toBeTruthy();
	});
});
