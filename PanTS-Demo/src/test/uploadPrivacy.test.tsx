import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, Link } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import UploadPage from "../routes/UploadPage";
import { setRecentUploadsAccount } from "../helpers/recentUploads";

const auth = vi.hoisted(() => ({
  isAuthenticated: true, promptAuth: vi.fn(), refreshUsage: vi.fn(), redeemAdminCoupon: vi.fn(),
  user: { id: "u1", email: "first@example.com", name: "First", plan: "pro", roles: [] },
}));
vi.mock("../contexts/authContext", () => ({ useAuth: () => auth }));
vi.mock("../helpers/pendingUploads", async () => ({
  ...(await vi.importActual<object>("../helpers/pendingUploads")), loadPendingUploads: async () => [],
}));
const CHUNK_SIZE = 512 * 1024;
const file = (name: string, chunks = 1) => new File([new Uint8Array(CHUNK_SIZE * chunks)], name, { type: "application/gzip" });
const json = (data: unknown) => ({ ok: true, status: 200, json: async () => data, text: async () => "", headers: { get: () => "application/json" } }) as Response;
const transfers = () => vi.mocked(fetch).mock.calls.filter(([url]) => /upload-inference-chunk|finalize-upload|run-epai-inference|upload-dicom-slice|finalize-dicom/.test(String(url)));
const standardFetch = async (url: RequestInfo | URL) => {
  if (String(url).includes("finalize-upload")) return json({ uploaded_filename: "scan.nii.gz" });
  if (String(url).includes("inference-status")) return json({ status: "queued" });
  return json({ items: [], total: 0, ids: [], ok: true });
};
const mount = () => render(<MemoryRouter initialEntries={["/upload"]}>
  <Routes><Route path="/upload" element={<><Link to="/elsewhere">Leave upload page</Link><UploadPage /></>} />
    <Route path="/elsewhere" element={<h1>Another feature</h1>} />
    <Route path="/local-nifti" element={<h1>Local viewer</h1>} />
  </Routes></MemoryRouter>);
const pickModel = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
  await user.click(screen.getByRole("button", { name: /^(ePAI|None \(view scan\))$/ }));
  await user.click(within(document.querySelector<HTMLElement>("#segmentation-options")!).getByText(name, { exact: true }));
};
const selectFiles = async (user: ReturnType<typeof userEvent.setup>, files: File | File[]) => {
  await user.upload(document.querySelector<HTMLInputElement>('input[accept=".nii,.gz"]')!, files);
};
beforeEach(() => {
  localStorage.clear();
  setRecentUploadsAccount("u1");
  global.fetch = vi.fn(standardFetch);
});
afterEach(() => { setRecentUploadsAccount(null); vi.restoreAllMocks(); });

// A held first file leaves a second file queued. It observes AbortSignal like
// fetch does, so cancelling the transfer can drain the serial queue in tests.
const holdChunks = () => {
  const signals: AbortSignal[] = [];
  const releases: (() => void)[] = [];
  global.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url).includes("upload-inference-chunk")) {
      signals.push(init!.signal!);
      return await new Promise<Response>((resolve, reject) => {
        releases.push(() => resolve(json({ ok: true })));
        init!.signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      });
    }
    return standardFetch(url);
  });
  return { signals, releases };
};

describe("view-only upload boundary", () => {
  it("never sends selected view-only bytes and opens the local viewer", async () => {
    const user = userEvent.setup();
    mount();
    await pickModel(user, "None");
    await selectFiles(user, file("private.nii.gz"));
    await user.click(screen.getByRole("button", { name: "View", exact: true }));
    expect(await screen.findByRole("heading", { name: "Local viewer" })).toBeInTheDocument();
    expect(transfers()).toHaveLength(0);
  });

  it("starts pre-upload only after a real model is selected", async () => {
    const user = userEvent.setup();
    mount();
    await pickModel(user, "None");
    await selectFiles(user, file("private.nii.gz"));
    expect(transfers()).toHaveLength(0);
    await pickModel(user, "ePAI");
    await waitFor(() => expect(transfers().some(([url]) => String(url).includes("finalize-upload"))).toBe(true));
    expect(transfers().every(([, init]) => new Headers(init?.headers).get("X-Upload-Owner") === "u1")).toBe(true);
  });

  it("switching to None aborts the active pre-upload and cancels queued files", async () => {
    const user = userEvent.setup();
    const { signals } = holdChunks();
    mount();
    await selectFiles(user, [file("active.nii.gz"), file("queued.nii.gz")]);
    await waitFor(() => expect(signals).toHaveLength(1));
    await pickModel(user, "None");
    await waitFor(() => expect(signals[0].aborted).toBe(true));
    expect(transfers()).toHaveLength(1);
    expect(await screen.findByText(/some scan data may already be on the server/)).toBeInTheDocument();
  });

  it("warns when an upload completed before the mode changed", async () => {
    const user = userEvent.setup();
    mount();
    await selectFiles(user, file("already-sent.nii.gz"));
    await waitFor(() => expect(document.querySelector(".file-chip--done")).not.toBeNull());
    const count = transfers().length;
    await pickModel(user, "None");
    expect(await screen.findByText(/Switching modes cannot undo that transfer/)).toBeInTheDocument();
    expect(transfers()).toHaveLength(count);
  });
});

describe("uploads outliving the page", () => {
  it("continues an authorized upload through same-account route navigation", async () => {
    const user = userEvent.setup();
    const { signals, releases } = holdChunks();
    mount();
    await selectFiles(user, file("continuing.nii.gz"));
    await waitFor(() => expect(signals).toHaveLength(1));
    await user.click(screen.getByRole("link", { name: "Leave upload page" }));
    expect(screen.getByRole("heading", { name: "Another feature" })).toBeInTheDocument();
    expect(signals[0].aborted).toBe(false);
    await act(async () => releases[0]());
    await waitFor(() => expect(transfers().some(([url]) => String(url).includes("finalize-upload"))).toBe(true));
  });

  it("aborts old-account uploads after page unmount and never starts their queued files", async () => {
    const user = userEvent.setup();
    const { signals } = holdChunks();
    mount();
    await selectFiles(user, [file("active.nii.gz"), file("queued.nii.gz")]);
    await waitFor(() => expect(signals).toHaveLength(1));
    await user.click(screen.getByRole("link", { name: "Leave upload page" }));
    await act(async () => setRecentUploadsAccount("u2"));
    expect(signals[0].aborted).toBe(true);
    expect(transfers()).toHaveLength(1);
  });

  it("does not restart cancelled queued transfers when the original account signs back in", async () => {
    const user = userEvent.setup();
    const { signals } = holdChunks();
    mount();
    await selectFiles(user, [file("active.nii.gz"), file("queued.nii.gz")]);
    await waitFor(() => expect(signals).toHaveLength(1));
    await act(async () => {
      setRecentUploadsAccount(null);
      setRecentUploadsAccount("u1");
    });
    expect(signals[0].aborted).toBe(true);
    expect(transfers()).toHaveLength(1);
  });
});
