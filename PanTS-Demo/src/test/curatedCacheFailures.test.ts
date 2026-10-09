import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The featured strip is cached for the whole session, so only a complete answer
// may be kept: half a strip or an empty one would stay on screen with no error.
type Reply = { ok: boolean; items?: unknown[] };
let replies: { tumor: Reply; noTumor: Reply };

const items = (tumor: number) =>
	Array.from({ length: 4 }, (_, i) => ({ case_id: tumor * 10 + i + 1, sex: "F", age: 50, tumor }));

beforeEach(() => {
	vi.resetModules();
	replies = { tumor: { ok: true, items: items(1) }, noTumor: { ok: true, items: items(0) } };
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: string) => {
			const reply = String(input).includes("tumor=1") ? replies.tumor : replies.noTumor;
			return { ok: reply.ok, status: reply.ok ? 200 : 500, json: async () => ({ items: reply.items ?? [] }) };
		}),
	);
});
afterEach(() => vi.unstubAllGlobals());

describe("featured strip cache", () => {
	it("fails as a whole when either half fails, and asks again next time", async () => {
		const { fetchCurated, getCachedCurated } = await import("../helpers/curatedCache");
		replies.noTumor = { ok: false };
		await expect(fetchCurated()).rejects.toThrow();
		expect(getCachedCurated()).toBeNull();

		replies.noTumor = { ok: true, items: items(0) };
		await expect(fetchCurated()).resolves.toHaveLength(8);
		expect(getCachedCurated()).toHaveLength(8);
	});

	it("does not keep an empty strip", async () => {
		const { fetchCurated, getCachedCurated } = await import("../helpers/curatedCache");
		replies = { tumor: { ok: true, items: [] }, noTumor: { ok: true, items: [] } };
		await expect(fetchCurated()).rejects.toThrow();
		expect(getCachedCurated()).toBeNull();
	});
});
