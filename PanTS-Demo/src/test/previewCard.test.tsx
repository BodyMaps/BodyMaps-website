import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import Preview from "../components/Preview";
import type { PreviewType } from "../types";

// The library card tells the user what kind of tumor a case has, whichever dataset it is from.
const renderCard = (id: number | string, meta: PreviewType) =>
  render(
    <MemoryRouter>
      <Preview id={id} previewMetadata={meta} />
    </MemoryRouter>,
  );

describe("Preview card tumor badge", () => {
  it("names the organ of a PanTS tumor", () => {
    renderCard(12, { sex: "M", age: 60, tumor: 1, tumorLabel: "Pancreas" });
    expect(screen.getByText("PanTS_00000012")).toBeTruthy();
    expect(screen.getByText("Pancreas tumor")).toBeTruthy();
  });

  it("names the organs of a CancerVerse tumor and keeps a long list short", () => {
    renderCard("CV_00000012", { sex: "F", age: 55, tumor: 1, tumorLabel: "Liver, Kidney, Colon, Spleen" });
    expect(screen.getByText("CV_00000012")).toBeTruthy();
    expect(screen.getByText("Liver, Kidney +2 tumor")).toBeTruthy();
  });

  it("says No Tumor, Unknown, or a plain Tumor when the organ is not known", () => {
    const none = renderCard(1, { sex: "M", age: 40, tumor: 0 });
    expect(screen.getByText("No Tumor")).toBeTruthy();
    none.unmount();
    const unknown = renderCard("CV_00000003", { sex: "M", age: 40, tumor: null });
    expect(screen.getByText("Unknown")).toBeTruthy();
    unknown.unmount();
    renderCard(2, { sex: "M", age: 40, tumor: 1 });
    expect(screen.getByText("Tumor")).toBeTruthy();
  });

  it("lets the sex / age / tumor row wrap instead of overflowing a narrow card", () => {
    const { container } = renderCard("CV_00000012", { sex: "F", age: 55, tumor: 1, tumorLabel: "Adrenal gland, Gallbladder" });
    const row = screen.getByText("Adrenal gland, Gallbladder tumor").parentElement as HTMLElement;
    expect(row.className).toContain("flex-wrap");
    expect(container.contains(row)).toBe(true);
  });
});
