import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EditLockBanner from "../components/viewer/EditLockBanner";
import { RENEW_EVERY_MS, useEditLock, type EditLock } from "../helpers/editLock";

// Synthetic accounts and case numbers only.

type Call = { method: string; url: string; keepalive?: boolean };
let calls: Call[] = [];
let server: { lock: EditLock; acquire: "mine" | "taken" | "error"; takeOver: "ok" | "refused" };

const free: EditLock = { held: false, mine: false, holder: null, expires_at: null };
const mine: EditLock = { held: true, mine: true, holder: "me@example.org", expires_at: "2026-11-23T10:30:00Z" };
const theirs: EditLock = { held: true, mine: false, holder: "rad1@example.org", expires_at: "2026-11-23T10:30:00Z" };

const reply = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });

beforeEach(() => {
	calls = [];
	server = { lock: free, acquire: "mine", takeOver: "ok" };
	global.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
		const u = String(url);
		const method = init?.method ?? "GET";
		calls.push({ method, url: u, keepalive: init?.keepalive });
		if (u.endsWith("/take-over")) {
			if (server.takeOver === "refused") return reply({ error: "Only annotation managers can take over a scan." }, 403);
			server.lock = mine;
			return reply(mine);
		}
		if (method === "GET") return reply(server.lock);
		if (method === "DELETE") { server.lock = free; return reply({ released: true }); }
		if (server.acquire === "error") throw new Error("offline");
		if (server.acquire === "taken") return reply({ ...theirs, reason: "edit_lock", error: "rad1@example.org is editing this scan." }, 409);
		server.lock = mine;
		return reply(mine);
	}) as unknown as typeof fetch;
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

const lockCalls = (method: string) => calls.filter((c) => c.method === method && c.url.includes("/shared-annotation/55/lock"));

describe("useEditLock", () => {
	it("does nothing for someone who cannot change the shared version", async () => {
		renderHook(() => useEditLock("", 55, false, true));
		await act(async () => {});
		expect(calls).toEqual([]);
	});

	it("shows straight away when someone else is already editing", async () => {
		server.lock = theirs;
		const { result } = renderHook(() => useEditLock("", 55, true, false));
		await waitFor(() => expect(result.current.blockedBy).toBe("rad1@example.org"));
		expect(result.current.holding).toBe(false);
		expect(lockCalls("POST")).toEqual([]);
	});

	it("takes the hold when editing starts and renews it every minute, even with no activity", async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		const { result, rerender } = renderHook(({ editing }) => useEditLock("", 55, true, editing), { initialProps: { editing: false } });
		await act(async () => {});
		expect(lockCalls("POST")).toHaveLength(0); // opening to look does not lock
		rerender({ editing: true });
		await waitFor(() => expect(result.current.holding).toBe(true));
		expect(lockCalls("POST")).toHaveLength(1);
		rerender({ editing: false }); // a break: no tool in use, scan still open
		await act(async () => { await vi.advanceTimersByTimeAsync(RENEW_EVERY_MS * 3); });
		expect(lockCalls("POST")).toHaveLength(4);
		expect(result.current.holding).toBe(true);
	});

	it("is view only when someone else got there first", async () => {
		server.acquire = "taken";
		const { result } = renderHook(() => useEditLock("", 55, true, true));
		await waitFor(() => expect(result.current.blockedBy).toBe("rad1@example.org"));
		expect(result.current.holding).toBe(false);
	});

	it("notices when the other editor finishes", async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		server.lock = theirs;
		const { result } = renderHook(() => useEditLock("", 55, true, false));
		await waitFor(() => expect(result.current.blockedBy).toBe("rad1@example.org"));
		server.lock = free;
		await act(async () => { await vi.advanceTimersByTimeAsync(RENEW_EVERY_MS); });
		expect(result.current.blockedBy).toBeNull();
	});

	it("learns on its next renewal that a manager took the scan over", async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		const { result } = renderHook(() => useEditLock("", 55, true, true));
		await waitFor(() => expect(result.current.holding).toBe(true));
		server.acquire = "taken";
		await act(async () => { await vi.advanceTimersByTimeAsync(RENEW_EVERY_MS); });
		expect(result.current.holding).toBe(false);
		expect(result.current.blockedBy).toBe("rad1@example.org");
	});

	it("lets go when the scan is left, so nobody has to wait for it to lapse", async () => {
		const { result, unmount } = renderHook(() => useEditLock("", 55, true, true));
		await waitFor(() => expect(result.current.holding).toBe(true));
		unmount();
		expect(lockCalls("DELETE")).toEqual([expect.objectContaining({ keepalive: true })]);
	});

	it("does not let go of a hold it never had", async () => {
		server.lock = theirs;
		const { result, unmount } = renderHook(() => useEditLock("", 55, true, false));
		await waitFor(() => expect(result.current.blockedBy).toBe("rad1@example.org"));
		unmount();
		expect(lockCalls("DELETE")).toEqual([]);
	});

	it("keeps editing possible when the lock cannot be reached; the server's save check still applies", async () => {
		server.acquire = "error";
		const { result } = renderHook(() => useEditLock("", 55, true, true));
		await act(async () => {});
		expect(result.current.blockedBy).toBeNull();
	});

	it("takes the scan over, and says why when it cannot", async () => {
		server.lock = theirs;
		const { result } = renderHook(() => useEditLock("", 55, true, false));
		await waitFor(() => expect(result.current.blockedBy).toBe("rad1@example.org"));
		server.takeOver = "refused";
		await act(async () => { await result.current.takeOver(); });
		expect(result.current.takeOverError).toBe("Only annotation managers can take over a scan.");
		server.takeOver = "ok";
		await act(async () => { await result.current.takeOver(); });
		expect(result.current.blockedBy).toBeNull();
		expect(result.current.holding).toBe(true);
	});
});

describe("EditLockBanner", () => {
	it("names who is editing and offers take over only to managers", async () => {
		const onTakeOver = vi.fn(async () => {});
		const { rerender } = render(<EditLockBanner holder="rad1@example.org" canTakeOver={false} onTakeOver={onTakeOver} error={null} />);
		expect(screen.getByRole("status")).toHaveTextContent("rad1@example.org is editing this scan. It is view only until they finish.");
		expect(screen.queryByRole("button", { name: "Take over" })).toBeNull();

		rerender(<EditLockBanner holder="rad1@example.org" canTakeOver onTakeOver={onTakeOver} error={null} />);
		vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
		await userEvent.click(screen.getByRole("button", { name: "Take over" }));
		expect(onTakeOver).not.toHaveBeenCalled();
		await userEvent.click(screen.getByRole("button", { name: "Take over" }));
		expect(onTakeOver).toHaveBeenCalledTimes(1);
	});

	it("shows why a take over failed", () => {
		render(<EditLockBanner holder="rad1@example.org" canTakeOver onTakeOver={async () => {}} error="Couldn't take over this scan. Try again." />);
		expect(screen.getByRole("alert")).toHaveTextContent("Couldn't take over this scan. Try again.");
	});
});
