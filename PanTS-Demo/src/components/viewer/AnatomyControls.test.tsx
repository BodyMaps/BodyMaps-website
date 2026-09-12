import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Types } from "@cornerstonejs/core";
vi.mock("@cornerstonejs/core", () => ({ Enums: { Events: { IMAGE_RENDERED: "rendered" } } }));
import { AnatomyControls, type PlaneMode } from "./AnatomyControls";

describe("anatomy controls", () => {
  it("changes the actual viewport, keeps the pivot, follows external scroll, and resets", () => {
    let index = 4;
    const element = document.createElement("div");
    const setCamera = vi.fn();
    const scroll = vi.fn((delta: number) => { index += delta; });
    const reset = vi.fn();
    const viewport = {
      element, getSliceIndex: () => index, getNumberOfSlices: () => 20,
      getCamera: () => ({ focalPoint: [0, 0, 0], position: [0, 0, -100] }),
      setCamera, scroll, render: () => element.dispatchEvent(new Event("rendered")),
    } as unknown as Types.IVolumeViewport;
    function Harness() {
      const [mode, setMode] = useState<PlaneMode>("axial");
      return <AnatomyControls axial={viewport} mode={mode} setMode={setMode} pivot={[12, -4, 90]} onReset={reset} />;
    }
    const { unmount } = render(<Harness />);
    const summary = screen.getByText("CT planes", { selector: "summary" });
    expect(summary.closest("details")).not.toHaveAttribute("open");
    fireEvent.click(summary);
    fireEvent.click(screen.getByRole("button", { name: "Next anatomy slice" }));
    expect(scroll).toHaveBeenLastCalledWith(1);
    expect(screen.getByRole("slider", { name: "Anatomy slice position" })).toHaveValue("5");
    act(() => { index = 12; element.dispatchEvent(new Event("rendered")); });
    expect(screen.getByRole("slider", { name: "Anatomy slice position" })).toHaveValue("12");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "oblique" } });
    fireEvent.change(screen.getByRole("slider", { name: "Oblique tilt around left-right axis" }), { target: { value: "30" } });
    expect(setCamera.mock.lastCall?.[0].focalPoint).toEqual([12, -4, 90]);
    expect(setCamera.mock.lastCall?.[0].viewPlaneNormal[1]).toBeCloseTo(.5);
    fireEvent.click(screen.getByRole("button", { name: "Reset anatomy view" }));
    expect(reset).toHaveBeenCalledOnce();
    expect(setCamera.mock.lastCall?.[0].viewPlaneNormal).toEqual([0, 0, -1]);
    expect(screen.getByRole("combobox")).toHaveValue("axial");
    const remove = vi.spyOn(element, "removeEventListener");
    unmount();
    expect(remove).toHaveBeenCalledWith("rendered", expect.any(Function));
  });
});
