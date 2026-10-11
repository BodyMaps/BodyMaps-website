import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WorkspaceTour from "../components/WorkspaceTour";

const SEEN_KEY = "bodymaps.workspace-tour.v6";

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  // jsdom does not lay out the document. Mark the targets that a real browser
  // would expose on desktop or mobile, including a hidden desktop sidebar.
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(function (this: HTMLElement) {
    const rects = this.dataset.testVisible === "true" ? [new DOMRect(0, 0, 100, 40)] : [];
    return Object.assign(rects, { item: (index: number) => rects[index] ?? null });
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const startTour = () => act(() => { vi.advanceTimersByTime(900); });

describe("workspace walkthrough", () => {
  it("guides only through visible mobile targets and restores the starting focus on Escape", () => {
    render(<>
      <button type="button" data-tour="mobile-navigation" data-test-visible="true">Open navigation</button>
      <nav data-tour="explore">Hidden desktop navigation</nav>
      <section data-tour="composer" data-test-visible="true">Scan composer</section>
      <section data-tour="settings">Hidden account controls</section>
      <WorkspaceTour replay={0} />
    </>);
    const opener = screen.getByRole("button", { name: "Open navigation" });
    opener.focus();
    startTour();

    expect(screen.getByRole("dialog")).toHaveFocus();
    expect(screen.getByText("1 of 2")).toBeInTheDocument();
    expect(screen.getByText(/Open the navigation menu to explore/)).toBeInTheDocument();
    expect(opener).toHaveClass("design-tour-target");
    expect(screen.getByText("Hidden desktop navigation")).not.toHaveClass("design-tour-target");

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("dialog", { name: "Start with a CT scan" })).toBeInTheDocument();
    expect(screen.getByText("2 of 2")).toBeInTheDocument();
    expect(opener).not.toHaveClass("design-tour-target");
    expect(screen.getByText("Scan composer")).toHaveClass("design-tour-target");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("Scan composer")).not.toHaveClass("design-tour-target");
    expect(opener).toHaveFocus();
    expect(localStorage.getItem(SEEN_KEY)).toBe("true");
  });

  it("uses a generic introduction when the current page exposes no tour targets", () => {
    render(<><aside data-tour="settings">Hidden settings</aside><WorkspaceTour replay={0} /></>);
    startTour();

    expect(screen.getByRole("dialog", { name: "Welcome to BodyMaps" })).toBeInTheDocument();
    expect(screen.getByText("1 of 1")).toBeInTheDocument();
    expect(screen.queryByText("Make it yours")).not.toBeInTheDocument();
    expect(screen.getByText("Hidden settings")).not.toHaveClass("design-tour-target");
    fireEvent.click(screen.getByRole("button", { name: "Get started" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("does not interrupt returning users but supports explicitly replaying the walkthrough", () => {
    localStorage.setItem(SEEN_KEY, "true");
    const { rerender } = render(<WorkspaceTour replay={0} />);
    startTour();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    rerender(<WorkspaceTour replay={1} />);
    act(() => { vi.advanceTimersByTime(0); });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Skip tour" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps keyboard focus within the tour and skips the disabled Back button", () => {
    render(<WorkspaceTour replay={0} />);
    startTour();
    expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();

    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(screen.getByRole("button", { name: "Get started" })).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(screen.getByRole("button", { name: "Skip tour" })).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(screen.getByRole("button", { name: "Get started" })).toHaveFocus();
  });

  it.each([false, true])("reveals offscreen targets while retaining dialog focus (reduced motion: %s)", (reducedMotion) => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: reducedMotion })));
    render(<>
      <button type="button" data-tour="explore" data-test-visible="true">Navigation</button>
      <section data-tour="composer" data-test-visible="true">Offscreen scan composer</section>
      <WorkspaceTour replay={0} />
    </>);
    const navigation = screen.getByRole("button", { name: "Navigation" });
    const composer = screen.getByText("Offscreen scan composer");
    const revealNavigation = vi.fn();
    const revealComposer = vi.fn();
    navigation.scrollIntoView = revealNavigation;
    composer.scrollIntoView = revealComposer;
    vi.spyOn(composer, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 1800, 300, 200));
    navigation.focus();
    startTour();

    expect(revealNavigation).toHaveBeenCalledOnce();
    expect(revealComposer).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(revealComposer).toHaveBeenCalledWith({
      behavior: reducedMotion ? "instant" : "smooth", block: "center", inline: "nearest",
    });
    expect(screen.getByRole("dialog", { name: "Start with a CT scan" })).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(screen.getByRole("button", { name: "Get started" })).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(navigation).toHaveFocus();
  });

  it.each([
    ["hidden", "mobile"],
    ["removed", "settings"],
    ["removed", "content"],
  ] as const)("restores useful focus when the replay launcher is %s using the %s fallback", (launcherState, fallback) => {
    const view = (launcher: "shown" | "hidden" | "removed") => <>
      {launcher !== "removed" && <button type="button" hidden={launcher === "hidden"} data-test-visible="true">Replay walkthrough</button>}
      <header data-tour="mobile-navigation">
        <button type="button" aria-controls="design-sidebar" data-test-visible={fallback === "mobile"}>Open navigation</button>
      </header>
      <aside data-tour="settings">
        <button type="button" aria-haspopup="menu" data-test-visible={fallback === "settings"}>Settings</button>
      </aside>
      <main id="workspace-content" tabIndex={-1} data-test-visible="true">Workspace</main>
      <WorkspaceTour replay={1} />
    </>;
    const { rerender } = render(view("shown"));
    screen.getByRole("button", { name: "Replay walkthrough" }).focus();
    act(() => { vi.advanceTimersByTime(0); });
    expect(screen.getByRole("dialog")).toHaveFocus();
    rerender(view(launcherState));

    fireEvent.click(screen.getByRole("button", { name: "Skip tour" }));
    const target = fallback === "content" ? screen.getByRole("main")
      : screen.getByRole("button", { name: fallback === "mobile" ? "Open navigation" : "Settings" });
    expect(target).toHaveFocus();
  });
});
