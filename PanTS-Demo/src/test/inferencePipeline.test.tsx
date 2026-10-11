import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../contexts/authContext";
import UploadPage from "../routes/UploadPage";
import WorkspaceRunCard from "../components/WorkspaceRunCard";
import { appendPipelineFields, readPipelineOptions, readPipelineStages } from "../helpers/inferencePipeline";
import { recentUploadsStorageKey, setRecentUploadsAccount, type RecentUpload } from "../helpers/recentUploads";
import type { PendingUpload } from "../helpers/pendingUploads";

const store = vi.hoisted(() => ({ pending: [] as PendingUpload[] }));
vi.mock("../helpers/pendingUploads", () => ({
  chunkSizeOf: (p: PendingUpload) => p.chunkSize || 256 * 1024,
  loadPendingUploads: vi.fn(async () => store.pending),
  savePendingUpload: vi.fn(async (p: PendingUpload) => { store.pending = [...store.pending.filter((row) => row.sessionId !== p.sessionId), p]; return true; }),
  setPendingUploaded: vi.fn(async (sid: string, name: string) => { const p = store.pending.find((row) => row.sessionId === sid); if (p) p.uploadedFilename = name; }),
  setPendingNextChunk: vi.fn(async () => {}),
  deletePendingUpload: vi.fn(async (sid: string) => { store.pending = store.pending.filter((p) => p.sessionId !== sid); }),
}));
vi.mock("../components/CtPreview/CtPreview", () => ({ default: () => <div>CT preview</div> }));

const ACCOUNT = { id: "pipeline-user", email: "test@example.com", plan: "pro", roles: [] };
const capability = { version: 1, preprocessing: [{ id: "OpenVAE", label: "OpenVAE", available: true, reason: null, supported_models: ["ePAI", "LesionSegmenter"] }],
  postprocessing: [{ id: "ShapeKit", label: "ShapeKit", available: true, reason: null, supported_models: ["ePAI", "LesionSegmenter"] }] };
const json = (data: unknown, status = 200) => ({ ok: status < 400, status, json: async () => data, headers: { get: () => "application/json" } });
let requests: FormData[];
let releaseUpload: (() => void) | undefined;
let transferGate: Promise<void> | null;
let availableOptions: unknown;
let accountPlan: string;
let acknowledgePipeline: boolean;
let replayStatus: "running" | "completed" | undefined;
let admissionRemaining: number;
beforeEach(() => {
  vi.stubEnv("VITE_OPENVAE_UI_PREVIEW", "false");
  localStorage.clear(); setRecentUploadsAccount(null); store.pending = []; requests = []; transferGate = null; releaseUpload = undefined;
  availableOptions = capability; accountPlan = "pro"; acknowledgePipeline = true; replayStatus = undefined;
  admissionRemaining = 0;
  global.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = String(url);
    if (path.endsWith("/api/auth/me")) return json({ user: { ...ACCOUNT, plan: accountPlan } });
    if (path.endsWith("/api/pipeline/options")) return json(availableOptions);
    if (path.includes("/api/upload-inference-chunk") || path.includes("/api/upload-dicom-slice")) { await transferGate; return json({ ok: true }); }
    if (path.includes("/api/finalize-")) return json({ uploaded_filename: "ct.nii.gz" });
    if (path.includes("/api/run-epai-inference")) {
      const request = init!.body as FormData; requests.push(request);
      if (admissionRemaining-- > 0) return json({ code: "inference_admitting", error: "Admission in progress" }, 409);
      return json({ session_id: request.get("session_id"), ...(replayStatus ? { status: replayStatus, reused: true } : {}), ...(acknowledgePipeline ? { pipeline: { version: 1, model: request.get("model_name"),
        preprocessing: request.get("preprocessing"), postprocessing: request.get("postprocessing") } } : {}) });
    }
    if (path.includes("/api/inference-status/")) return json({ status: replayStatus || "queued" });
    return json({ jobs: [], user_id: ACCOUNT.id, items: [] });
  }) as unknown as typeof fetch;
});
afterEach(() => { releaseUpload?.(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });
const show = () => render(<AuthProvider><MemoryRouter><UploadPage /></MemoryRouter></AuthProvider>);
// Auth hydrates asynchronously before the plan-aware default model appears.
// Allow startup under parallel suite/build load; interaction waits stay unchanged.
const waitForAccountModel = (name: string | RegExp = "ePAI") =>
  screen.findByRole("button", { name, exact: typeof name === "string" }, { timeout: 5000 });
const chooseOptional = async (user: ReturnType<typeof userEvent.setup>, stage: "Preprocessing" | "Postprocessing", name: string) => {
  await user.click(await screen.findByRole("button", { name: new RegExp(`^${stage}:`) }));
  await user.click(within(screen.getByRole("menu", { name: stage })).getByText(name, { exact: true }));
};
const chooseModel = async (user: ReturnType<typeof userEvent.setup>, current: string, next: string) => {
  await user.click(screen.getByRole("button", { name: current, exact: true }));
  await user.click(within(document.getElementById("segmentation-options")!).getByText(next, { exact: true }));
};
const run: RecentUpload = { sessionId: "resumed", label: "Saved run", model: "LesionSegmenter", status: "Processing", timestamp: Date.now() };

describe("server-backed pipeline", () => {
  it("previews unavailable OpenVAE locally without executing it, bypassing real-stage permissions, or claiming completion", async () => {
    vi.stubEnv("MODE", "development"); vi.stubEnv("VITE_OPENVAE_UI_PREVIEW", "true"); accountPlan = "free";
    availableOptions = { ...capability, preprocessing: [{ ...capability.preprocessing[0], available: false, reason: "Weights missing" }] };
    const user = userEvent.setup(); const { container } = show();
    await waitForAccountModel(/LesionSegmenter/);
    expect(screen.queryByText("Preview only — not run. Segmentation uses the original CT.")).not.toBeInTheDocument();
    await chooseOptional(user, "Preprocessing", "OpenVAE");
    expect(screen.getByText("Preview only — not run. Segmentation uses the original CT.")).toBeInTheDocument();
    expect(screen.queryByText("OpenVAE needs Pro")).not.toBeInTheDocument();
    await user.upload(container.querySelector<HTMLInputElement>('input[accept=".nii,.gz"]')!, new File(["scan"], "preview.nii.gz"));
    await user.click(screen.getByRole("button", { name: "Run", exact: true }));
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0].get("model_name")).toBe("LesionSegmenter");
    expect(requests[0].has("preprocessing")).toBe(false);
    expect(requests[0].has("preprocessingPreview")).toBe(false);
    expect(screen.getByText("OpenVAE was previewed only and did not run. Segmentation uses the original CT.")).toBeInTheDocument();
    expect(screen.queryByText(/Reconstruct CT · OpenVAE/)).not.toBeInTheDocument();
    const saved = JSON.parse(localStorage.getItem(recentUploadsStorageKey(ACCOUNT.id))!);
    expect(saved[0]).toMatchObject({ preprocessingPreview: "OpenVAE", pipeline: { preprocessing: null } });
  });

  it("cannot turn on the OpenVAE visual preview in a production build", async () => {
    vi.stubEnv("MODE", "production"); vi.stubEnv("DEV", false); vi.stubEnv("VITE_OPENVAE_UI_PREVIEW", "true");
    availableOptions = { ...capability, preprocessing: [{ ...capability.preprocessing[0], available: false, reason: "Weights missing" }] };
    show(); await waitForAccountModel();
    expect(await screen.findByText("Weights missing")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preprocessing: None (skip)" })).toBeDisabled();
  });

  it("shows the server's unavailability reason and prevents selecting missing installations", async () => {
    availableOptions = { ...capability, preprocessing: [{ ...capability.preprocessing[0], available: false, reason: "OpenVAE weights are not installed" }],
      postprocessing: [{ ...capability.postprocessing[0], available: false, reason: "ShapeKit is not installed" }] };
    show(); await waitForAccountModel();
    await screen.findByText("OpenVAE weights are not installed");
    expect(screen.getByRole("button", { name: "Preprocessing: None (skip)" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Postprocessing: None (skip)" })).toBeDisabled();
  });

  it("keeps server-available optional stages behind their existing Free plan gates", async () => {
    accountPlan = "free"; const user = userEvent.setup(); show();
    await waitForAccountModel(/LesionSegmenter/);
    await chooseOptional(user, "Preprocessing", "OpenVAE");
    expect(await screen.findByText("OpenVAE needs Pro")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Not now" }));
    await chooseOptional(user, "Postprocessing", "ShapeKit");
    expect(await screen.findByText("ShapeKit needs Pro")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Postprocessing: None (skip)" })).toBeInTheDocument();
  });

  it("freezes all optional stages for every batch member while later composer choices change", async () => {
    transferGate = new Promise((resolve) => { releaseUpload = resolve; });
    const user = userEvent.setup(); const { container } = show();
    await waitForAccountModel();
    await chooseOptional(user, "Preprocessing", "OpenVAE"); await chooseOptional(user, "Postprocessing", "ShapeKit");
    const input = container.querySelector<HTMLInputElement>('input[accept=".nii,.gz"]')!;
    await user.upload(input, [new File(["scan"], "a.nii.gz"), new File(["scan"], "b.nii.gz")]);
    await user.click(screen.getByRole("button", { name: "Run", exact: true }));
    await chooseOptional(user, "Preprocessing", "None (skip)"); await chooseOptional(user, "Postprocessing", "None (skip)");
    releaseUpload?.();
    await waitFor(() => expect(requests).toHaveLength(2));
    for (const request of requests) {
      expect(request.get("preprocessing")).toBe("OpenVAE"); expect(request.get("postprocessing")).toBe("ShapeKit"); expect(request.get("model_name")).toBe("ePAI");
    }
    expect(new Set(requests.map((request) => request.get("session_id"))).size).toBe(2);
  });

  it("sends DICOM conversion output through the same selected server pipeline", async () => {
    const user = userEvent.setup(); const { container } = show();
    await waitForAccountModel();
    await chooseOptional(user, "Preprocessing", "OpenVAE"); await chooseOptional(user, "Postprocessing", "ShapeKit");
    const input = container.querySelector<HTMLInputElement>('input[webkitdirectory]')!;
    fireEvent.change(input, { target: { files: [new File(["dicom"], "1.dcm"), new File(["dicom"], "2.dcm")] } });
    await user.click(screen.getByRole("button", { name: "Run", exact: true }));
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0].get("uploaded_filename")).toBe("ct.nii.gz");
    expect(requests[0].get("preprocessing")).toBe("OpenVAE"); expect(requests[0].get("postprocessing")).toBe("ShapeKit");
  });

  it.each([false, true])("resumes %s fully uploaded pipeline from its saved choices, not composer defaults", async (fullyUploaded) => {
    localStorage.setItem(recentUploadsStorageKey(ACCOUNT.id), JSON.stringify([run]));
    store.pending = [{ sessionId: run.sessionId, model: run.model, filename: "ct.nii.gz", file: new Blob(["scan"]), bdmapId: "", totalChunks: 1, nextChunk: 0,
      ...(fullyUploaded ? { uploadedFilename: "ct.nii.gz" } : {}), pipeline: { preprocessing: "OpenVAE", postprocessing: "ShapeKit", lesionTarget: "liver" } }];
    show(); await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0].get("model_name")).toBe("LesionSegmenter"); expect(requests[0].get("lesion_target")).toBe("liver");
    expect(requests[0].get("preprocessing")).toBe("OpenVAE"); expect(requests[0].get("postprocessing")).toBe("ShapeKit");
  });

  it("clears optional selections in view-only mode without uploading the chosen scan", async () => {
    const user = userEvent.setup(); const { container } = show();
    await waitForAccountModel();
    await chooseOptional(user, "Preprocessing", "OpenVAE"); await chooseOptional(user, "Postprocessing", "ShapeKit");
    await chooseModel(user, "ePAI", "None");
    for (const stage of ["Preprocessing", "Postprocessing"]) expect(screen.getByRole("button", { name: `${stage}: None (skip)` })).toBeDisabled();
    await user.upload(container.querySelector<HTMLInputElement>('input[accept=".nii,.gz"]')!, new File(["scan"], "local.nii.gz"));
    expect(vi.mocked(global.fetch).mock.calls.some(([url]) => String(url).includes("/api/upload-"))).toBe(false);
    expect(requests).toHaveLength(0);
  });

  it("does not admit a cancelled run after its background transfer settles", async () => {
    transferGate = new Promise((resolve) => { releaseUpload = resolve; });
    const user = userEvent.setup(); const { container } = show();
    await waitForAccountModel();
    await chooseOptional(user, "Preprocessing", "OpenVAE");
    await user.upload(container.querySelector<HTMLInputElement>('input[accept=".nii,.gz"]')!, new File(["scan"], "cancel.nii.gz"));
    await user.click(screen.getByRole("button", { name: "Run", exact: true }));
    await user.click(screen.getByRole("button", { name: "Cancel", exact: true }));
    releaseUpload?.();
    await screen.findByRole("heading", { name: "Run cancelled" });
    expect(requests).toHaveLength(0);
  });

  it("requests cancellation when an older server silently ignores selected stages", async () => {
    acknowledgePipeline = false;
    localStorage.setItem(recentUploadsStorageKey(ACCOUNT.id), JSON.stringify([run]));
    store.pending = [{ sessionId: run.sessionId, model: run.model, filename: "ct.nii.gz", file: new Blob(), bdmapId: "", totalChunks: 0, nextChunk: 0,
      uploadedFilename: "ct.nii.gz", pipeline: { preprocessing: "OpenVAE", postprocessing: null } }];
    show();
    await screen.findByText(/server did not confirm the selected pipeline/);
    expect(vi.mocked(global.fetch).mock.calls.some(([url]) => String(url).endsWith(`/api/cancel-inference/${run.sessionId}`))).toBe(true);
    expect(screen.getByRole("heading", { name: "Run failed" })).toBeInTheDocument();
  });

  it.each(["running", "completed"] as const)("reconnects to an already %s admitted pipeline without transferring again", async (status) => {
    replayStatus = status;
    const pipeline = { preprocessing: "OpenVAE" as const, postprocessing: "ShapeKit" as const, lesionTarget: "liver" as const };
    localStorage.setItem(recentUploadsStorageKey(ACCOUNT.id), JSON.stringify([{ ...run, pipeline }]));
    store.pending = [{ sessionId: run.sessionId, model: run.model, filename: "ct.nii.gz", file: new Blob(), bdmapId: "", totalChunks: 0, nextChunk: 0,
      uploadedFilename: "ct.nii.gz", pipeline }];
    show();
    await screen.findByRole("heading", { name: status === "completed" ? "Your results are ready" : "Processing your scan" });
    expect(requests).toHaveLength(1);
    expect(requests[0].get("session_id")).toBe(run.sessionId);
    expect(store.pending).toEqual([]);
    const urls = vi.mocked(global.fetch).mock.calls.map(([url]) => String(url));
    expect(urls.some((url) => /upload-inference-chunk|finalize-upload|cancel-inference/.test(url))).toBe(false);
    if (status === "completed") expect(urls.some((url) => url.includes("inference-status/"))).toBe(false);
  });

  it("keeps an exhausted admission resumable and retries the same session without transferring its file again", async () => {
    admissionRemaining = 10;
    localStorage.setItem(recentUploadsStorageKey(ACCOUNT.id), JSON.stringify([run]));
    store.pending = [{ sessionId: run.sessionId, model: run.model, filename: "ct.nii.gz", file: new Blob(), bdmapId: "", totalChunks: 0, nextChunk: 0,
      uploadedFilename: "ct.nii.gz", pipeline: { preprocessing: "OpenVAE", postprocessing: null } }];
    const user = userEvent.setup(); show();
    const retry = await screen.findByRole("button", { name: "Retry start" }, { timeout: 15000 });
    expect(store.pending).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem(recentUploadsStorageKey(ACCOUNT.id))!)[0].status).toBe("Processing");
    // A browser may revoke IndexedDB access after transfer. Same-tab retry
    // still has the immutable dispatch arguments and must remain usable.
    store.pending = [];
    await user.click(retry);
    await screen.findByRole("heading", { name: "Queued for GPU" });
    expect(requests).toHaveLength(11);
    expect(new Set(requests.map((request) => request.get("session_id")))).toEqual(new Set([run.sessionId]));
    expect(requests.every((request) => request.get("preprocessing") === "OpenVAE")).toBe(true);
    expect(store.pending).toEqual([]);
    expect(vi.mocked(fetch).mock.calls.some(([url]) => /upload-inference-chunk|finalize-upload|cancel-inference/.test(String(url)))).toBe(false);
  }, 20000);

  it.each(["cancel", "account switch"])("stops waiting admission after %s and never dispatches another attempt", async (action) => {
    admissionRemaining = 10;
    localStorage.setItem(recentUploadsStorageKey(ACCOUNT.id), JSON.stringify([run]));
    store.pending = [{ sessionId: run.sessionId, model: run.model, filename: "ct.nii.gz", file: new Blob(), bdmapId: "", totalChunks: 0, nextChunk: 0, uploadedFilename: "ct.nii.gz" }];
    const user = userEvent.setup(); show(); await waitFor(() => expect(requests).toHaveLength(1));
    if (action === "cancel") await user.click(screen.getByRole("button", { name: "Cancel", exact: true }));
    else act(() => setRecentUploadsAccount("different-user"));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1100)); });
    expect(requests).toHaveLength(1);
    expect(store.pending.length).toBe(action === "cancel" ? 0 : 1);
    const saved = JSON.parse(localStorage.getItem(recentUploadsStorageKey(ACCOUNT.id))!);
    expect(saved[0].status).toBe(action === "cancel" ? "Cancelled" : "Processing");
  });

  it("keeps old saved runs model-only and rejects unknown capability versions", () => {
    const body = new FormData(); appendPipelineFields(body); expect([...body.keys()]).toEqual([]);
    expect(readPipelineOptions({ ...capability, version: 2 })).toBeNull();
    expect(readPipelineStages([{ id: "segmentation", model: "ePAI", status: "pretend", error: null }])).toEqual([]);
  });

  it("renders observed stage completion and failure without completing later steps", () => {
    render(<WorkspaceRunCard upload={{ ...run, status: "Failed", pipeline: { preprocessing: "OpenVAE", postprocessing: "ShapeKit" }, pipelineStages: [
      { id: "preprocessing", model: "OpenVAE", status: "completed", started_at: null, completed_at: null, error: null },
      { id: "segmentation", model: "ePAI", status: "failed", started_at: null, completed_at: null, error: "failed" },
      { id: "postprocessing", model: "ShapeKit", status: "queued", started_at: null, completed_at: null, error: null },
    ] }} phase="running" />);
    const list = within(screen.getByRole("list", { name: "Pipeline progress" }));
    expect(list.getByText("Reconstruct CT · OpenVAE").closest("li")).toHaveTextContent("Complete");
    expect(list.getByText("Segment scan · ePAI").closest("li")).toHaveTextContent("Step failed");
    expect(list.getByText("Refine organ masks · ShapeKit").closest("li")).toHaveTextContent("Pending");
    expect(screen.queryByRole("heading", { name: "Your results are ready" })).not.toBeInTheDocument();
  });
});
