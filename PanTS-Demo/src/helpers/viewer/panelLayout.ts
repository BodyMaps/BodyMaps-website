// Layout state for the viewer's panel tray and floating panel windows.
//
// A panel is either docked in the tray below the scans (left to right in the
// order it joined) or floating as a window over the scan area. This module is
// pure (no React, no DOM) so the rules can be unit tested on their own:
//   - at most TRAY_LIMIT panels sit in the tray
//   - lifting a panel out of the tray closes its gap (the array just shrinks)
//   - floating windows always stay inside the stage bounds
//   - a window closed while floating reopens floating, where it was
// Which panels are OPEN is still owned by VisualizationPage (and remembered
// across visits in its saved prefs); this only decides WHERE they sit.

export const TRAY_LIMIT = 4;
export const MIN_W = 240;
export const MIN_H = 160;
export const DEFAULT_W = 340;
export const DEFAULT_H = 420;
const CASCADE = 24;

export type Rect = { x: number; y: number; w: number; h: number };
export type Bounds = { width: number; height: number };
export type FloatingPanel = Rect & { id: string; z: number };

export type PanelLayoutState = {
	/** Docked panel ids, left to right. */
	tray: string[];
	/** Floating windows; higher z is in front. */
	floating: FloatingPanel[];
	/** Last floating rect of panels that were closed while floating. */
	remembered: Record<string, Rect>;
	zTop: number;
};

export type PanelLayoutAction =
	| { type: "sync"; ids: string[]; bounds: Bounds | null }
	| { type: "open"; id: string; bounds: Bounds | null }
	| { type: "close"; id: string }
	| { type: "float"; id: string; rect: Rect; bounds: Bounds | null }
	| { type: "dock"; id: string; index: number }
	| { type: "move"; id: string; x: number; y: number; bounds: Bounds | null }
	| { type: "resize"; id: string; w: number; h: number; bounds: Bounds | null }
	| { type: "focus"; id: string }
	| { type: "clamp"; bounds: Bounds };

export const emptyLayout = (): PanelLayoutState => ({ tray: [], floating: [], remembered: {}, zTop: 0 });

const clampNum = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

/** Keeps a window fully inside the stage (and no smaller than the minimum size,
 *  unless the stage itself is smaller than that). */
export function clampRect(rect: Rect, bounds: Bounds | null): Rect {
	if (!bounds || bounds.width <= 0 || bounds.height <= 0) return rect;
	const w = clampNum(rect.w, Math.min(MIN_W, bounds.width), bounds.width);
	const h = clampNum(rect.h, Math.min(MIN_H, bounds.height), bounds.height);
	return {
		w,
		h,
		x: clampNum(rect.x, 0, bounds.width - w),
		y: clampNum(rect.y, 0, bounds.height - h),
	};
}

const sameRect = (a: Rect, b: Rect) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

export const isOpen = (s: PanelLayoutState, id: string) =>
	s.tray.includes(id) || s.floating.some((f) => f.id === id);

/** Where a new window goes when it has no remembered spot: cascaded from the
 *  top left so several new windows do not sit exactly on top of each other. */
function defaultRect(s: PanelLayoutState, bounds: Bounds | null): Rect {
	const k = s.floating.length;
	const h = bounds ? Math.min(DEFAULT_H, bounds.height - 2 * CASCADE) : DEFAULT_H;
	return clampRect({ x: CASCADE * (k + 1), y: CASCADE * (k + 1), w: DEFAULT_W, h }, bounds);
}

function open(s: PanelLayoutState, id: string, bounds: Bounds | null): PanelLayoutState {
	if (isOpen(s, id)) return s;
	const remembered = s.remembered[id];
	if (!remembered && s.tray.length < TRAY_LIMIT) return { ...s, tray: [...s.tray, id] };
	// Reopen floating where it was; or float a new one when the tray is full.
	const rect = clampRect(remembered ?? defaultRect(s, bounds), bounds);
	const z = s.zTop + 1;
	return { ...s, floating: [...s.floating, { id, ...rect, z }], zTop: z };
}

function close(s: PanelLayoutState, id: string): PanelLayoutState {
	if (s.tray.includes(id)) {
		const { [id]: _drop, ...remembered } = s.remembered;
		return { ...s, tray: s.tray.filter((t) => t !== id), remembered };
	}
	const win = s.floating.find((f) => f.id === id);
	if (!win) return s;
	return {
		...s,
		floating: s.floating.filter((f) => f.id !== id),
		remembered: { ...s.remembered, [id]: { x: win.x, y: win.y, w: win.w, h: win.h } },
	};
}

function updateWindow(s: PanelLayoutState, id: string, fn: (f: FloatingPanel) => FloatingPanel): PanelLayoutState {
	let changed = false;
	const floating = s.floating.map((f) => {
		if (f.id !== id) return f;
		const next = fn(f);
		if (!sameRect(next, f) || next.z !== f.z) changed = true;
		return next;
	});
	return changed ? { ...s, floating } : s;
}

export function panelLayoutReducer(s: PanelLayoutState, a: PanelLayoutAction): PanelLayoutState {
	switch (a.type) {
		case "sync": {
			// Close what is no longer open, then open new ids in the given order.
			let next = s;
			for (const id of [...s.tray, ...s.floating.map((f) => f.id)]) {
				if (!a.ids.includes(id)) next = close(next, id);
			}
			for (const id of a.ids) next = open(next, id, a.bounds);
			return next;
		}
		case "open":
			return open(s, a.id, a.bounds);
		case "close":
			return close(s, a.id);
		case "float": {
			if (!s.tray.includes(a.id)) return s;
			const z = s.zTop + 1;
			return {
				...s,
				// Removing it from the array is the reflow: panels to its right move left.
				tray: s.tray.filter((t) => t !== a.id),
				floating: [...s.floating, { id: a.id, ...clampRect(a.rect, a.bounds), z }],
				zTop: z,
			};
		}
		case "dock": {
			if (!s.floating.some((f) => f.id === a.id) || s.tray.length >= TRAY_LIMIT) return s;
			const tray = [...s.tray];
			tray.splice(clampNum(Math.round(a.index), 0, tray.length), 0, a.id);
			const { [a.id]: _drop, ...remembered } = s.remembered;
			return { ...s, tray, floating: s.floating.filter((f) => f.id !== a.id), remembered };
		}
		case "move":
			return updateWindow(s, a.id, (f) => ({ ...f, ...clampRect({ ...f, x: a.x, y: a.y }, a.bounds) }));
		case "resize":
			// Resizing grows right and down; the top left corner stays put unless
			// the stage edge forces it in.
			return updateWindow(s, a.id, (f) => ({ ...f, ...clampRect({ ...f, w: a.w, h: a.h }, a.bounds) }));
		case "focus": {
			const win = s.floating.find((f) => f.id === a.id);
			if (!win || win.z === s.zTop) return s;
			const z = s.zTop + 1;
			return { ...updateWindow(s, a.id, (f) => ({ ...f, z })), zTop: z };
		}
		case "clamp": {
			let changed = false;
			const floating = s.floating.map((f) => {
				const r = clampRect(f, a.bounds);
				if (sameRect(r, f)) return f;
				changed = true;
				return { ...f, ...r };
			});
			return changed ? { ...s, floating } : s;
		}
	}
}

/** Which tray slot a pointer at x would drop into, given the horizontal centres
 *  of the panels already docked (left to right). The tray does not stretch its
 *  panels to fill it, so slots are found from where the panels actually sit. */
export function dropIndexAt(x: number, slotCenters: number[]): number {
	return slotCenters.filter((c) => c < x).length;
}

// ---- Per-tab memory (sessionStorage, so it ends when the tab is closed) ----

export const SESSION_KEY = "bodymaps.viewer.panelWindows.v1";

const isRect = (v: unknown): v is Rect =>
	!!v && typeof v === "object" &&
	["x", "y", "w", "h"].every((k) => Number.isFinite((v as Record<string, unknown>)[k]));

/** Floating windows (open or closed) to restore in this tab. Open ones come back
 *  as remembered rects, so they reopen floating when their panel reopens. */
export function loadSessionLayout(storage: Pick<Storage, "getItem"> | null = safeSessionStorage()): PanelLayoutState {
	const state = emptyLayout();
	try {
		const raw = storage?.getItem(SESSION_KEY);
		if (!raw) return state;
		const parsed = JSON.parse(raw) as { windows?: Record<string, unknown> };
		for (const [id, rect] of Object.entries(parsed.windows ?? {})) {
			if (isRect(rect)) state.remembered[id] = { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
		}
	} catch {
		// Unreadable or blocked storage: start fresh.
	}
	return state;
}

export function saveSessionLayout(
	s: PanelLayoutState,
	storage: Pick<Storage, "setItem"> | null = safeSessionStorage(),
): void {
	const windows: Record<string, Rect> = { ...s.remembered };
	for (const f of s.floating) windows[f.id] = { x: f.x, y: f.y, w: f.w, h: f.h };
	try {
		storage?.setItem(SESSION_KEY, JSON.stringify({ windows }));
	} catch {
		// Quota or privacy mode: floating positions just are not remembered.
	}
}

function safeSessionStorage(): Storage | null {
	try {
		return typeof window === "undefined" ? null : window.sessionStorage;
	} catch {
		return null;
	}
}
