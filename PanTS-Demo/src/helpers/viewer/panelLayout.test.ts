import { describe, expect, it } from "vitest";
import {
	MIN_W,
	SESSION_KEY,
	TRAY_LIMIT,
	clampRect,
	dropIndexAt,
	emptyLayout,
	loadSessionLayout,
	panelLayoutReducer as reduce,
	saveSessionLayout,
	type PanelLayoutAction,
	type PanelLayoutState,
} from "./panelLayout";

const bounds = { width: 1000, height: 600 };
const run = (actions: PanelLayoutAction[], start: PanelLayoutState = emptyLayout()) => actions.reduce(reduce, start);
const openAll = (ids: string[]) => run(ids.map((id) => ({ type: "open", id, bounds }) as const));

describe("panel tray", () => {
	it("adds panels left to right in opening order instead of replacing", () => {
		expect(openAll(["stats", "metadata", "measurements"]).tray).toEqual(["stats", "metadata", "measurements"]);
	});

	it("holds at most four panels; a fifth opens floating", () => {
		const s = openAll(["a", "b", "c", "d", "e"]);
		expect(s.tray).toHaveLength(TRAY_LIMIT);
		expect(s.floating.map((f) => f.id)).toEqual(["e"]);
	});

	it("reflows when a panel is lifted out: panels to its right shift left", () => {
		const s = run([{ type: "float", id: "a", rect: { x: 10, y: 10, w: 300, h: 300 }, bounds }], openAll(["a", "b", "c"]));
		expect(s.tray).toEqual(["b", "c"]);
		expect(s.floating[0]).toMatchObject({ id: "a", x: 10, y: 10 });
	});

	it("lifting the rightmost panel leaves the others where they were", () => {
		const s = run([{ type: "float", id: "c", rect: { x: 0, y: 0, w: 300, h: 300 }, bounds }], openAll(["a", "b", "c"]));
		expect(s.tray).toEqual(["a", "b"]);
	});

	it("docks a floating window at the chosen slot", () => {
		const s = run(
			[
				{ type: "float", id: "a", rect: { x: 0, y: 0, w: 300, h: 300 }, bounds },
				{ type: "dock", id: "a", index: 1 },
			],
			openAll(["a", "b", "c"]),
		);
		expect(s.tray).toEqual(["b", "a", "c"]);
		expect(s.floating).toEqual([]);
	});

	it("clamps an out-of-range dock index to the ends", () => {
		const lifted = run([{ type: "float", id: "a", rect: { x: 0, y: 0, w: 300, h: 300 }, bounds }], openAll(["a", "b"]));
		expect(reduce(lifted, { type: "dock", id: "a", index: 99 }).tray).toEqual(["b", "a"]);
		expect(reduce(lifted, { type: "dock", id: "a", index: -3 }).tray).toEqual(["a", "b"]);
	});

	it("refuses to dock into a full tray", () => {
		const s = openAll(["a", "b", "c", "d", "e"]);
		expect(reduce(s, { type: "dock", id: "e", index: 0 })).toBe(s);
	});
});

describe("floating windows", () => {
	const floated = () => run([{ type: "float", id: "a", rect: { x: 100, y: 100, w: 300, h: 300 }, bounds }], openAll(["a", "b"]));

	it("stay inside the stage when moved past an edge", () => {
		const s = reduce(floated(), { type: "move", id: "a", x: 5000, y: -50, bounds });
		expect(s.floating[0]).toMatchObject({ x: 700, y: 0 });
	});

	it("are resized within the stage and not below the minimum size", () => {
		let s = reduce(floated(), { type: "resize", id: "a", w: 50, h: 5000, bounds });
		expect(s.floating[0]).toMatchObject({ w: MIN_W, h: 600, y: 0 });
		s = reduce(s, { type: "resize", id: "a", w: 5000, h: 300, bounds });
		expect(s.floating[0]).toMatchObject({ w: 1000, x: 0 });
	});

	it("are pulled back in when the stage shrinks", () => {
		const s = reduce(floated(), { type: "clamp", bounds: { width: 350, height: 250 } });
		expect(s.floating[0]).toEqual(expect.objectContaining({ x: 50, y: 0, w: 300, h: 250 }));
	});

	it("come to the front when focused", () => {
		let s = run([{ type: "float", id: "b", rect: { x: 0, y: 0, w: 300, h: 300 }, bounds }], floated());
		s = reduce(s, { type: "focus", id: "a" });
		const z = Object.fromEntries(s.floating.map((f) => [f.id, f.z]));
		expect(z.a).toBeGreaterThan(z.b);
	});

	it("reopen floating at their last spot after being closed while floating", () => {
		let s = reduce(floated(), { type: "move", id: "a", x: 200, y: 150, bounds });
		s = reduce(s, { type: "close", id: "a" });
		expect(s.floating).toEqual([]);
		s = reduce(s, { type: "open", id: "a", bounds });
		expect(s.tray).toEqual(["b"]);
		expect(s.floating[0]).toMatchObject({ id: "a", x: 200, y: 150, w: 300, h: 300 });
	});

	it("reopen in the tray once they were docked before closing", () => {
		let s = reduce(floated(), { type: "close", id: "a" });
		s = run([{ type: "open", id: "a", bounds }, { type: "dock", id: "a", index: 0 }, { type: "close", id: "a" }, { type: "open", id: "a", bounds }], s);
		expect(s.tray).toEqual(["b", "a"]);
	});
});

describe("sync with the page's open panels", () => {
	it("opens new ids and closes missing ones", () => {
		let s = reduce(emptyLayout(), { type: "sync", ids: ["stats", "metadata"], bounds });
		expect(s.tray).toEqual(["stats", "metadata"]);
		s = reduce(s, { type: "sync", ids: ["metadata", "measurements"], bounds });
		expect(s.tray).toEqual(["metadata", "measurements"]);
	});

	it("returns the same state object when nothing changes", () => {
		const s = reduce(emptyLayout(), { type: "sync", ids: ["stats"], bounds });
		expect(reduce(s, { type: "sync", ids: ["stats"], bounds })).toBe(s);
	});
});

describe("helpers", () => {
	it("clampRect leaves a window alone without bounds", () => {
		expect(clampRect({ x: -5, y: -5, w: 10, h: 10 }, null)).toEqual({ x: -5, y: -5, w: 10, h: 10 });
	});

	it("dropIndexAt picks the slot from where the docked panels sit", () => {
		// Two 350 px panels at the left of a wide tray: centres 175 and 525.
		expect(dropIndexAt(10, [175, 525])).toBe(0);
		expect(dropIndexAt(300, [175, 525])).toBe(1);
		expect(dropIndexAt(600, [175, 525])).toBe(2);
		// Far right of the tray, past every panel: the end.
		expect(dropIndexAt(1400, [175, 525])).toBe(2);
		// Empty tray: the first slot.
		expect(dropIndexAt(800, [])).toBe(0);
	});
});

describe("per-tab memory", () => {
	const memoryStorage = () => {
		const data = new Map<string, string>();
		return {
			getItem: (k: string) => data.get(k) ?? null,
			setItem: (k: string, v: string) => void data.set(k, v),
		};
	};

	it("restores floating windows (open or closed) as remembered spots", () => {
		const storage = memoryStorage();
		let s = run([{ type: "float", id: "a", rect: { x: 40, y: 50, w: 300, h: 320 }, bounds }], openAll(["a", "b"]));
		saveSessionLayout(s, storage);
		s = loadSessionLayout(storage);
		expect(s.remembered).toEqual({ a: { x: 40, y: 50, w: 300, h: 320 } });
		expect(reduce(s, { type: "open", id: "a", bounds }).floating[0]).toMatchObject({ id: "a", x: 40 });
	});

	it("ignores broken or foreign data", () => {
		const storage = memoryStorage();
		storage.setItem(SESSION_KEY, "{not json");
		expect(loadSessionLayout(storage)).toEqual(emptyLayout());
		storage.setItem(SESSION_KEY, JSON.stringify({ windows: { a: { x: "1" }, b: { x: 1, y: 2, w: 300, h: 300 } } }));
		expect(Object.keys(loadSessionLayout(storage).remembered)).toEqual(["b"]);
	});

	it("survives storage that throws", () => {
		const throwing = {
			getItem: () => { throw new Error("blocked"); },
			setItem: () => { throw new Error("blocked"); },
		};
		expect(loadSessionLayout(throwing)).toEqual(emptyLayout());
		expect(() => saveSessionLayout(emptyLayout(), throwing)).not.toThrow();
	});
});
