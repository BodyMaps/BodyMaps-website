import { act, render, screen, within } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_KEY } from "../../helpers/viewer/panelLayout";
import PanelDock, { DockPanel } from "./PanelDock";

// Synthetic panels only: a header (the drag handle) with a close button, and a body.
function Harness({ ids }: { ids: string[] }) {
	const stageRef = useRef<HTMLDivElement>(null);
	return (
		<div>
			<div ref={stageRef} data-testid="stage" className="vp-stage" />
			<PanelDock stageRef={stageRef}>
				{ids.map((id) => (
					<DockPanel key={id} id={id} title={`Panel ${id}`}>
						<div className="vp-measure">
							<div className="vp-panel-head" data-testid={`head-${id}`}>
								<span>Panel {id}</span>
								<button type="button">close</button>
							</div>
							<p>body {id}</p>
						</div>
					</DockPanel>
				))}
			</PanelDock>
		</div>
	);
}

// jsdom has no layout: stage is 1000 x 600 at the top left; the tray sits below it.
const STAGE = { left: 0, top: 0, width: 1000, height: 600 };
const TRAY = { left: 0, top: 600, width: 1000, height: 300 };
const rect = (r: { left: number; top: number; width: number; height: number }) =>
	({ ...r, x: r.left, y: r.top, right: r.left + r.width, bottom: r.top + r.height, toJSON: () => r }) as DOMRect;

beforeEach(() => {
	sessionStorage.clear();
	vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
		if (this.classList.contains("vp-stage")) return rect(STAGE);
		if (this.classList.contains("vp-tray")) return rect(TRAY);
		if (this.classList.contains("vp-pframe--tray")) return rect({ left: 0, top: 600, width: 500, height: 300 });
		return rect({ left: 0, top: 0, width: 0, height: 0 });
	});
	vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
		return this.classList.contains("vp-stage") ? STAGE.width : 0;
	});
	vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) {
		return this.classList.contains("vp-stage") ? STAGE.height : 0;
	});
});

afterEach(() => vi.restoreAllMocks());

const trayPanels = () => [...document.querySelectorAll(".vp-tray > .vp-pframe")].map((el) => el.getAttribute("aria-label"));
const floatingPanels = () => [...document.querySelectorAll(".vp-stage .vp-pframe--floating")].map((el) => el.getAttribute("aria-label"));

// jsdom lacks PointerEvent; React only needs the event name and mouse fields.
const pointer = (target: EventTarget, type: string, clientX: number, clientY: number) =>
	act(() => {
		target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX, clientY }));
	});

describe("PanelDock", () => {
	it("shows opened panels side by side in opening order instead of replacing", () => {
		const { rerender } = render(<Harness ids={["stats"]} />);
		rerender(<Harness ids={["stats", "metadata"]} />);
		expect(trayPanels()).toEqual(["Panel stats", "Panel metadata"]);
		rerender(<Harness ids={["metadata"]} />);
		expect(trayPanels()).toEqual(["Panel metadata"]);
	});

	it("hides the tray when no panel is open", () => {
		render(<Harness ids={[]} />);
		expect(document.querySelector(".vp-tray")).toBeNull();
	});

	it("floats a panel dragged up onto the scans, then docks it at the drop box", () => {
		render(<Harness ids={["a", "b"]} />);

		pointer(screen.getByTestId("head-a"), "pointerdown", 100, 610);
		pointer(window, "pointermove", 100, 300);
		expect(trayPanels()).toEqual(["Panel b"]);
		expect(floatingPanels()).toEqual(["Panel a"]);
		expect(within(screen.getByTestId("stage")).getByText("body a")).toBeTruthy();

		// Near the bottom: a drop box appears in the tray at the slot under the pointer.
		pointer(window, "pointermove", 900, 640);
		expect(document.querySelector(".vp-tray__drop")).not.toBeNull();
		const order = [...document.querySelectorAll(".vp-tray > *")].map((el) =>
			el.classList.contains("vp-tray__drop") ? "drop" : el.getAttribute("aria-label"),
		);
		expect(order).toEqual(["Panel b", "drop"]);

		pointer(window, "pointerup", 900, 640);
		expect(document.querySelector(".vp-tray__drop")).toBeNull();
		expect(floatingPanels()).toEqual([]);
		expect(trayPanels()).toEqual(["Panel b", "Panel a"]);
	});

	it("keeps a window floating when released away from the tray", () => {
		render(<Harness ids={["a"]} />);
		pointer(screen.getByTestId("head-a"), "pointerdown", 100, 610);
		pointer(window, "pointermove", 300, 200);
		pointer(window, "pointerup", 300, 200);
		expect(floatingPanels()).toEqual(["Panel a"]);
		expect(document.querySelector(".vp-tray")).toBeNull();
	});

	it("does not start a drag from buttons in the header", () => {
		render(<Harness ids={["a"]} />);
		pointer(within(screen.getByTestId("head-a")).getByText("close"), "pointerdown", 100, 610);
		pointer(window, "pointermove", 100, 200);
		expect(floatingPanels()).toEqual([]);
	});

	it("reopens a window closed while floating as floating (same tab)", () => {
		const { rerender } = render(<Harness ids={["a"]} />);
		pointer(screen.getByTestId("head-a"), "pointerdown", 100, 610);
		pointer(window, "pointermove", 300, 200);
		pointer(window, "pointerup", 300, 200);
		rerender(<Harness ids={[]} />);
		expect(sessionStorage.getItem(SESSION_KEY)).toContain('"a"');
		rerender(<Harness ids={["a"]} />);
		expect(floatingPanels()).toEqual(["Panel a"]);
	});

	it("docks a focused floating window with Escape", () => {
		render(<Harness ids={["a"]} />);
		const frame = screen.getByRole("region", { name: "Panel a" });
		act(() => {
			frame.focus();
			frame.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
		});
		expect(floatingPanels()).toEqual(["Panel a"]);
		const win = screen.getByRole("region", { name: "Panel a" });
		expect(document.activeElement).toBe(win);
		act(() => {
			win.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
		});
		expect(trayPanels()).toEqual(["Panel a"]);
	});
});
