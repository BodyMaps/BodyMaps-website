import {
	Children,
	isValidElement,
	useCallback,
	useEffect,
	useLayoutEffect,
	useReducer,
	useRef,
	useState,
	type CSSProperties,
	type KeyboardEvent as ReactKeyboardEvent,
	type PointerEvent as ReactPointerEvent,
	type ReactElement,
	type ReactNode,
	type RefObject,
} from "react";
import { createPortal } from "react-dom";
import {
	DEFAULT_H,
	DEFAULT_W,
	MIN_W,
	TRAY_LIMIT,
	dropIndexAt,
	loadSessionLayout,
	panelLayoutReducer,
	saveSessionLayout,
	type Bounds,
	type Rect,
} from "../../helpers/viewer/panelLayout";
import "./PanelDock.css";

// Bottom tray + floating windows for the viewer's side panels.
//
// Panels sit side by side in a tray below the scans. Dragging a panel's header
// up onto the scans lifts it into a floating window that can be moved (and,
// if enabled, resized) anywhere inside the scan area. Dragging a window back
// down shows a drop box in the tray; releasing there docks it again.
// Under 900 px wide there is no floating: every panel shows in the tray, and
// windows float again once the screen is wide enough.

type DockPanelProps = { id: string; title: string; children: ReactNode };

/** Marks one panel for PanelDock. Renders nothing by itself: PanelDock reads
 *  its props and places the children in the tray or a floating window. */
export function DockPanel(_props: DockPanelProps): ReactElement | null {
	return null;
}

type Props = {
	/** The scan area. Floating windows render inside it and never leave it. */
	stageRef: RefObject<HTMLDivElement | null>;
	/** Floating windows get a resize corner. */
	resizable?: boolean;
	children?: ReactNode;
};

// The panel headers that double as drag handles. Buttons inside them keep working.
const HANDLE = ".vp-stats__head, .vp-panel-head";
const NOT_HANDLE = "button, a, input, select, textarea, [role='button']";
// How far above the tray the pointer must go before a tray panel lifts out.
const LIFT_MARGIN = 12;
// When the tray is hidden, this band at the bottom of the scans is the dock zone.
const HIDDEN_TRAY_ZONE = 96;
// When the tray is showing, the dock zone starts this far above it.
const TRAY_ZONE_MARGIN = 24;
const NARROW_QUERY = "(max-width: 899px)";
const KEY_STEP = 10;

type Drag = {
	id: string;
	kind: "move" | "resize";
	floating: boolean;
	startX: number;
	startY: number;
	/** Pointer position inside the window, kept while moving. */
	grabX: number;
	grabY: number;
	/** Window rect at the start (resize only). */
	rect0: Rect | null;
	/** Tray slot width when lifted out of the tray. */
	slotW: number;
	dropIndex: number | null;
};

/** The scan area's size, rounded down: clientWidth/Height round a fractional
 *  size up, which would let a window poke out by a fraction of a pixel. */
function stageBounds(el: HTMLElement): Bounds {
	const r = el.getBoundingClientRect();
	return { width: Math.floor(r.width), height: Math.floor(r.height) };
}

function useNarrow(): boolean {
	const get = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(NARROW_QUERY).matches;
	const [narrow, setNarrow] = useState(get);
	useEffect(() => {
		if (typeof window.matchMedia !== "function") return;
		const mq = window.matchMedia(NARROW_QUERY);
		const onChange = () => setNarrow(mq.matches);
		mq.addEventListener?.("change", onChange);
		return () => mq.removeEventListener?.("change", onChange);
	}, []);
	return narrow;
}

function PanelDock({ stageRef, resizable = true, children }: Props) {
	const panels = new Map<string, { title: string; content: ReactNode }>();
	Children.forEach(children, (child) => {
		if (isValidElement<DockPanelProps>(child) && child.type === DockPanel) {
			panels.set(child.props.id, { title: child.props.title, content: child.props.children });
		}
	});
	const ids = [...panels.keys()];
	const idsKey = ids.join("|");

	const [state, dispatch] = useReducer(panelLayoutReducer, undefined, () => loadSessionLayout());
	const [stageEl, setStageEl] = useState<HTMLDivElement | null>(null);
	const [dropIndex, setDropIndex] = useState<number | null>(null);
	const [draggingId, setDraggingId] = useState<string | null>(null);
	const narrow = useNarrow();
	const canFloat = !narrow;
	const trayRef = useRef<HTMLDivElement>(null);
	const dragRef = useRef<Drag | null>(null);
	const stateRef = useRef(state);
	useLayoutEffect(() => {
		stateRef.current = state;
	}, [state]);
	const focusAfterRef = useRef<string | null>(null);

	useLayoutEffect(() => {
		setStageEl(stageRef.current);
	}, [stageRef]);

	const bounds = useCallback((): Bounds | null => {
		const el = stageRef.current;
		return el ? stageBounds(el) : null;
	}, [stageRef]);

	// Follow the page's open/closed panels.
	useLayoutEffect(() => {
		dispatch({ type: "sync", ids: idsKey ? idsKey.split("|") : [], bounds: bounds() });
	}, [idsKey, bounds]);

	// Remember floating windows for this browser tab.
	useEffect(() => {
		saveSessionLayout(state);
	}, [state]);

	// Keep windows inside the scan area when it changes size.
	useEffect(() => {
		if (!stageEl || typeof ResizeObserver === "undefined") return;
		const ro = new ResizeObserver(() => {
			const b = bounds();
			if (b) dispatch({ type: "clamp", bounds: b });
		});
		ro.observe(stageEl);
		return () => ro.disconnect();
	}, [stageEl, bounds]);

	// A panel moved between the tray and the stage remounts; give keyboard focus back.
	useLayoutEffect(() => {
		const id = focusAfterRef.current;
		if (!id) return;
		focusAfterRef.current = null;
		const el = document.querySelector<HTMLElement>(`[data-panel-id="${CSS.escape(id)}"]`);
		el?.focus({ preventScroll: true });
	}, [state]);

	// ---- dragging ----

	const dockZoneIndex = useCallback((clientX: number, clientY: number, id: string): number | null => {
		const s = stateRef.current;
		const others = s.tray.filter((t) => t !== id);
		if (others.length >= TRAY_LIMIT) return null;
		const stage = stageRef.current?.getBoundingClientRect();
		const tray = trayRef.current?.getBoundingClientRect();
		const trayShowing = !!tray && tray.height > 0;
		const zoneTop = trayShowing ? tray.top - TRAY_ZONE_MARGIN : (stage ? stage.bottom - HIDDEN_TRAY_ZONE : Infinity);
		if (clientY < zoneTop) return null;
		const centers = [...(trayRef.current?.querySelectorAll<HTMLElement>(":scope > .vp-pframe") ?? [])]
			.filter((el) => el.dataset.panelId !== id)
			.map((el) => {
				const r = el.getBoundingClientRect();
				return r.left + r.width / 2;
			});
		return dropIndexAt(clientX, centers);
	}, [stageRef]);

	const onPointerMove = useCallback((e: PointerEvent) => {
		const d = dragRef.current;
		const stageEl2 = stageRef.current;
		if (!d || !stageEl2) return;
		const stage = stageEl2.getBoundingClientRect();
		const b = stageBounds(stageEl2);

		if (d.kind === "resize" && d.rect0) {
			dispatch({ type: "resize", id: d.id, w: d.rect0.w + e.clientX - d.startX, h: d.rect0.h + e.clientY - d.startY, bounds: b });
			return;
		}

		if (!d.floating) {
			// Still in the tray: lift out once the pointer is up on the scans.
			const tray = trayRef.current?.getBoundingClientRect();
			if (!tray || e.clientY > tray.top - LIFT_MARGIN) return;
			const w = Math.min(Math.max(d.slotW, MIN_W), DEFAULT_W + 60);
			const h = Math.min(DEFAULT_H, Math.max(b.height - 48, 0));
			d.grabX = Math.min(d.grabX, w - 40);
			d.floating = true;
			dispatch({
				type: "float",
				id: d.id,
				rect: { x: e.clientX - stage.left - d.grabX, y: e.clientY - stage.top - d.grabY, w, h },
				bounds: b,
			});
		} else {
			dispatch({ type: "move", id: d.id, x: e.clientX - stage.left - d.grabX, y: e.clientY - stage.top - d.grabY, bounds: b });
		}
		const idx = dockZoneIndex(e.clientX, e.clientY, d.id);
		if (idx !== d.dropIndex) {
			d.dropIndex = idx;
			setDropIndex(idx);
		}
	}, [stageRef, dockZoneIndex]);

	const endDrag = useCallback(() => {
		const d = dragRef.current;
		dragRef.current = null;
		setDropIndex(null);
		setDraggingId(null);
		if (d && d.dropIndex !== null) dispatch({ type: "dock", id: d.id, index: d.dropIndex });
	}, []);

	// Window-level listeners for the duration of a drag (the panel may remount
	// mid-drag when it moves from the tray to the stage, so not on the element).
	useEffect(() => {
		if (!draggingId) return;
		document.body.classList.add("vp-panel-dragging");
		window.addEventListener("pointermove", onPointerMove);
		window.addEventListener("pointerup", endDrag);
		window.addEventListener("pointercancel", endDrag);
		return () => {
			document.body.classList.remove("vp-panel-dragging");
			window.removeEventListener("pointermove", onPointerMove);
			window.removeEventListener("pointerup", endDrag);
			window.removeEventListener("pointercancel", endDrag);
		};
	}, [draggingId, onPointerMove, endDrag]);

	const startDrag = (e: ReactPointerEvent<HTMLElement>, id: string, kind: Drag["kind"]) => {
		if (!canFloat || e.button !== 0 || dragRef.current) return;
		const target = e.target as HTMLElement;
		if (kind === "move" && (!target.closest(HANDLE) || target.closest(NOT_HANDLE))) return;
		const frame = e.currentTarget.closest<HTMLElement>("[data-panel-id]");
		if (!frame) return;
		e.preventDefault();
		e.stopPropagation();
		const r = frame.getBoundingClientRect();
		const win = stateRef.current.floating.find((f) => f.id === id);
		dragRef.current = {
			id,
			kind,
			floating: !!win,
			startX: e.clientX,
			startY: e.clientY,
			grabX: e.clientX - r.left,
			grabY: e.clientY - r.top,
			rect0: win ? { x: win.x, y: win.y, w: win.w, h: win.h } : null,
			slotW: r.width,
			dropIndex: null,
		};
		setDraggingId(id);
	};

	// ---- keyboard: Esc docks, arrows move, Shift+arrows resize, ArrowUp lifts ----

	const onFrameKeyDown = (e: ReactKeyboardEvent<HTMLElement>, id: string, floating: boolean) => {
		if (!canFloat || e.target !== e.currentTarget) return;
		const s = stateRef.current;
		const b = bounds();
		let handled = true;
		if (floating) {
			const win = s.floating.find((f) => f.id === id);
			if (!win) return;
			const dx = e.key === "ArrowLeft" ? -KEY_STEP : e.key === "ArrowRight" ? KEY_STEP : 0;
			const dy = e.key === "ArrowUp" ? -KEY_STEP : e.key === "ArrowDown" ? KEY_STEP : 0;
			if (e.key === "Escape" && s.tray.length < TRAY_LIMIT) {
				focusAfterRef.current = id;
				dispatch({ type: "dock", id, index: s.tray.length });
			} else if ((dx || dy) && e.shiftKey && resizable) {
				dispatch({ type: "resize", id, w: win.w + dx, h: win.h + dy, bounds: b });
			} else if (dx || dy) {
				dispatch({ type: "move", id, x: win.x + dx, y: win.y + dy, bounds: b });
			} else handled = false;
		} else if (e.key === "ArrowUp") {
			focusAfterRef.current = id;
			const h = Math.min(DEFAULT_H, (b?.height ?? DEFAULT_H + 48) - 48);
			const k = s.floating.length + 1;
			dispatch({ type: "float", id, rect: { x: 24 * k, y: 24 * k, w: DEFAULT_W, h }, bounds: b });
		} else handled = false;
		if (handled) {
			e.preventDefault();
			e.stopPropagation(); // keep the viewer's own arrow / Esc shortcuts out of it
		}
	};

	// ---- render ----

	const known = (id: string) => panels.has(id);
	const floatingWins = canFloat ? state.floating.filter((f) => known(f.id)) : [];
	// Narrow screens show floating panels in the tray too (their floating spot is kept).
	const trayIds = canFloat
		? state.tray.filter(known)
		: [...state.tray, ...[...state.floating].sort((a, b) => a.z - b.z).map((f) => f.id)].filter(known);

	const frame = (id: string, floating: boolean, style?: CSSProperties) => {
		const p = panels.get(id)!;
		const hintId = `vp-pframe-hint-${id}`;
		return (
			<section
				key={id}
				data-panel-id={id}
				className={`vp-pframe vp-pframe--${floating ? "floating" : "tray"}${canFloat ? " is-draggable" : ""}${draggingId === id ? " is-dragging" : ""}`}
				role="region"
				aria-label={p.title}
				aria-describedby={canFloat ? hintId : undefined}
				tabIndex={0}
				style={style}
				onPointerDown={(e) => {
					if (floating) dispatch({ type: "focus", id });
					startDrag(e, id, "move");
				}}
				onKeyDown={(e) => onFrameKeyDown(e, id, floating)}
			>
				{p.content}
				{canFloat && (
					<span id={hintId} className="vp-pframe__hint">
						{floating
							? "Floating window. Drag its header to move it, or into the tray to dock it. Arrow keys move it, Escape docks it."
							: "Drag the header up onto the scans, or press the up arrow, to float this panel."}
					</span>
				)}
				{floating && resizable && (
					<div
						className="vp-pframe__resize"
						aria-hidden="true"
						onPointerDown={(e) => {
							dispatch({ type: "focus", id });
							startDrag(e, id, "resize");
						}}
					/>
				)}
			</section>
		);
	};

	const trayChildren: ReactNode[] = trayIds.map((id) => frame(id, false));
	if (dropIndex !== null) {
		trayChildren.splice(dropIndex, 0, (
			<div key="__drop" className="vp-tray__drop" aria-hidden="true">
				<span className="vp-tray__drop-plus">+</span>
			</div>
		));
	}

	return (
		<>
			{trayChildren.length > 0 && (
				<div className="vp-tray" ref={trayRef} data-count={trayChildren.length}>
					{trayChildren}
				</div>
			)}
			{stageEl && floatingWins.length > 0 && createPortal(
				<div className="vp-float-layer">
					{floatingWins.map((f) => frame(f.id, true, { left: f.x, top: f.y, width: f.w, height: f.h, zIndex: f.z }))}
				</div>,
				stageEl,
			)}
		</>
	);
}

export default PanelDock;
