import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import UploadPage from "../routes/UploadPage";
import { setRecentUploadsAccount } from "../helpers/recentUploads";

vi.mock("../contexts/authContext", () => ({ useAuth: () => ({ isAuthenticated: true, promptAuth: vi.fn(), refreshUsage: vi.fn(), user: { id: "sample-owner", plan: "pro", roles: [] } }) }));
vi.mock("../helpers/pendingUploads", () => ({ loadPendingUploads: async () => [], deletePendingUpload: vi.fn(), savePendingUpload: vi.fn(), setPendingNextChunk: vi.fn(), setPendingUploaded: vi.fn(), chunkSizeOf: vi.fn() }));
const sampleUrl = (input: unknown) => String(input).endsWith("/api/get-main-nifti/35.nii.gz");
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
beforeEach(() => { localStorage.clear(); setRecentUploadsAccount("sample-owner"); });
afterEach(() => { vi.unstubAllGlobals(); setRecentUploadsAccount(null); });
async function mountViewOnly() {
  const user = userEvent.setup();
  const view = render(<MemoryRouter><UploadPage /></MemoryRouter>);
  await user.click(await screen.findByRole("button", { name: /^ePAI$/ }));
  await user.click(within(document.getElementById("segmentation-options")!).getByText("None", { exact: true }));
  return { user, view };
}

it("loads the real sample into the composer without starting inference", async () => {
  vi.stubGlobal("fetch", vi.fn(async (input) => sampleUrl(input)
    ? new Response(new Uint8Array([31, 139, 8]), { headers: { "Content-Type": "application/gzip" } })
    : json({ items: [], total: 0, ids: [] })));
  const { user } = await mountViewOnly();
  await user.click(screen.getByRole("button", { name: "Sample case", exact: true }));
  expect(await screen.findByText("PanTS_00000035.nii.gz")).toBeInTheDocument();
  expect(screen.getByText(/Sample case 35 is ready/)).toBeInTheDocument();
  expect(vi.mocked(fetch).mock.calls.some(([input]) => /run-inference|run-epai-inference|upload-inference-chunk/.test(String(input)))).toBe(false);
  expect(vi.mocked(fetch).mock.calls.find(([input]) => sampleUrl(input))?.[1]).toEqual(expect.objectContaining({ credentials: "include" }));
});

it("shows a useful outage error without adding a pretend sample", async () => {
  vi.stubGlobal("fetch", vi.fn(async (input) => sampleUrl(input) ? new Response("Unavailable", { status: 503 }) : json({ items: [], total: 0 })));
  const { user } = await mountViewOnly();
  await user.click(screen.getByRole("button", { name: "Sample case", exact: true }));
  expect(await screen.findByText(/sample dataset is temporarily unavailable/)).toBeInTheDocument();
  expect(screen.queryByText("PanTS_00000035.nii.gz")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Sample case", exact: true })).toBeEnabled();
});

it("aborts sample loading on account change and ignores late data", async () => {
  let finish!: (response: Response) => void;
  let signal: AbortSignal | undefined;
  vi.stubGlobal("fetch", vi.fn(async (input, init) => {
    if (sampleUrl(input)) { signal = init.signal; return new Promise<Response>((resolve) => { finish = resolve; }); }
    return json({ items: [], total: 0 });
  }));
  const { user } = await mountViewOnly();
  await user.click(screen.getByRole("button", { name: "Sample case", exact: true }));
  await waitFor(() => expect(signal).toBeDefined());
  await act(async () => {
    setRecentUploadsAccount("another-owner");
    finish(new Response(new Uint8Array([1]), { headers: { "Content-Type": "application/gzip" } }));
  });
  expect(signal?.aborted).toBe(true);
  expect(screen.queryByText("PanTS_00000035.nii.gz")).not.toBeInTheDocument();
});
