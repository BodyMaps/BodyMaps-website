import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MeshManifest } from "../types";

// The 3D pane around the mesh loading queue: live meshes for edited catalog classes that have no
// baked mesh, the refit back to the opening framing when the report walkthrough ends, a retry
// after the canvas itself fails, and keyboard focus after a retry. jsdom draws no WebGL, so the
// renderer, the camera and the meshes are stand-ins.

const mocks = vi.hoisted(() => {
  const bounds = { refresh: vi.fn(), clip: vi.fn(), fit: vi.fn() };
  bounds.refresh.mockReturnValue(bounds);
  bounds.clip.mockReturnValue(bounds);
  return { bounds, controls: {}, canvasThrows: { value: false } };
});

vi.mock("@react-three/fiber", () => ({
  Canvas: ({ children }: { children: React.ReactNode }) => {
    if (mocks.canvasThrows.value) throw new Error("WebGL context could not be created");
    return <div data-testid="mesh-canvas">{children}</div>;
  },
  useThree: (selector: (state: { controls: object }) => unknown) => selector({ controls: mocks.controls }),
}));
vi.mock("@react-three/drei", () => ({
  Bounds: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  OrbitControls: () => <span data-testid="orbit-controls" />,
  useBounds: () => mocks.bounds,
  useGLTF: Object.assign(vi.fn(), { clear: vi.fn() }),
}));
vi.mock("../helpers/constants", () => ({ APP_CONSTANTS: { API_ORIGIN: "" } }));
vi.mock("../helpers/utils", () => ({ cornerstoneLpsMmToThree: (position: number[]) => position }));
vi.mock("../helpers/viewer/meshCapture", () => ({ registerMeshRoot: vi.fn() }));
vi.mock("../components/viewer/LiveSegmentMesh", () => ({
  LiveSegmentMesh: ({ segmentIndex, maskRevision }: { segmentIndex: number; maskRevision?: number }) => <span data-testid={`live-${segmentIndex}`} data-revision={maskRevision ?? 0} />,
}));
vi.mock("../components/viewer/SceneCrosshair3D", () => ({ SceneCrosshair3D: () => <span data-testid="crosshair" /> }));
vi.mock("../components/viewer/OrganMesh", async () => {
  const { useEffect } = await import("react");
  return { OrganMesh: ({ organ, onLoaded }: { organ: { id: number }; onLoaded: (id: number) => void }) => {
    useEffect(() => { onLoaded(organ.id); }, [organ.id, onLoaded]);
    return <span data-testid={`mesh-${organ.id}`} />;
  } };
});

import { SegmentationMeshViewer } from "../components/viewer/MeshViewer";

const manifest = (count = 3): MeshManifest => ({
  caseId: "one", center: [0, 0, 0], bounds: { min: [-100, -150, -200], max: [100, 150, 200] },
  organs: Array.from({ length: count }, (_, index) => ({
    id: index + 1, key: `organ${index + 1}`, name: `Organ ${index + 1}`, color: "#ffffff",
    url: `/api/cases/one/render_only/organ${index + 1}.glb`, vertices: 10, faces: 8,
  })),
});
const props = { caseId: "one", loading: false, checkState: [false, true, true, true, true, true, true, true], opacity: 50, crosshairMm: [0, 0, 0] as [number, number, number] };
const response = (data: MeshManifest) => ({ ok: true, json: async () => data }) as Response;

beforeEach(() => {
  mocks.canvasThrows.value = false;
  mocks.bounds.refresh.mockClear(); mocks.bounds.clip.mockClear(); mocks.bounds.fit.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(manifest())));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("3D mesh pane", () => {
  it("rebuilds edited baked organs from the live labelmap while keeping unedited baked meshes", async () => {
    render(<SegmentationMeshViewer {...props} editedOrgans={[{ id: 2, label: "organ2" }, { id: 7, label: "organ7" }]} maskRevisions={{ 2: 4, 7: 1 }} />);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("3 of 3 meshes loaded."));
    expect(screen.getByTestId("live-7")).toBeInTheDocument();
    expect(screen.getByTestId("live-2")).toHaveAttribute("data-revision", "4");
    expect(screen.queryByTestId("mesh-2")).not.toBeInTheDocument();
    expect(screen.getByTestId("mesh-1")).toBeInTheDocument();
  });

  it("passes a newer settled mask revision to the edited live surface", async () => {
    const view = render(<SegmentationMeshViewer {...props} editedOrgans={[{ id: 2, label: "organ2" }]} maskRevisions={{ 2: 4 }} />);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("3 of 3 meshes loaded."));
    view.rerender(<SegmentationMeshViewer {...props} editedOrgans={[{ id: 2, label: "organ2" }]} maskRevisions={{ 2: 5 }} />);
    expect(screen.getByTestId("live-2")).toHaveAttribute("data-revision", "5");
  });

  it("returns to the opening framing when the report walkthrough ends", async () => {
    const view = render(<SegmentationMeshViewer {...props} fitVisible />);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("3 of 3 meshes loaded."));
    const fitsBefore = mocks.bounds.fit.mock.calls.length;
    view.rerender(<SegmentationMeshViewer {...props} fitVisible={false} />);
    expect(mocks.bounds.fit).toHaveBeenCalledTimes(fitsBefore + 1);
    const box = mocks.bounds.refresh.mock.calls.at(-1)?.[0];
    expect(box.min.toArray()).toEqual(manifest().bounds.min);
    expect(box.max.toArray()).toEqual(manifest().bounds.max);
  });

  it("offers a retry when the canvas itself fails, and mounts a fresh one", async () => {
    mocks.canvasThrows.value = true;
    render(<SegmentationMeshViewer {...props} />);
    const retry = await screen.findByRole("button", { name: "Retry 3D meshes" });
    expect(screen.getByRole("alert")).toHaveTextContent("3D segmentation unavailable.");
    mocks.canvasThrows.value = false;
    retry.focus();
    fireEvent.click(retry);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("3 of 3 meshes loaded."));
    expect(screen.getByTestId("mesh-canvas")).toBeInTheDocument();
    // The button went away with the alert; focus is on the pane, not lost to the page.
    expect(document.activeElement).toBe(screen.getByTestId("mesh-canvas").closest("[tabindex='-1']"));
  });

  it("keeps keyboard focus on the pane after a manifest retry", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("Failed to fetch")).mockResolvedValueOnce(response(manifest(1)));
    render(<SegmentationMeshViewer {...props} />);
    const retry = await screen.findByRole("button", { name: "Retry 3D meshes" });
    retry.focus();
    fireEvent.click(retry);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("1 of 1 meshes loaded."));
    expect(document.activeElement).toBe(screen.getByTestId("mesh-canvas").closest("[tabindex='-1']"));
  });

  it("announces the loading message", async () => {
    render(<SegmentationMeshViewer {...props} loading />);
    expect(await screen.findByRole("status")).toHaveTextContent("Loading 3D segmentation...");
  });
});
