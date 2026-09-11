import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../contexts/authContext";
import UploadPage from "../routes/UploadPage";

const USER = { id: "u1", email: "test.user@example.com", name: null, plan: "pro" };

const json = (body: unknown) => ({
  ok: true,
  status: 200,
  json: async () => body,
  text: async () => "",
  headers: { get: () => "application/json" },
});

describe("completed inference actions", () => {
  beforeEach(() => {
    global.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const endpoint = String(url);
      if (endpoint.includes("/api/auth/me")) return json({ user: USER });
      if (endpoint.includes("/api/auth/oauth/providers")) return json({ google: true });
      if (endpoint.includes("/api/upload-inference-chunk")) return json({ ok: true });
      if (endpoint.includes("/api/finalize-upload")) {
        return json({ uploaded_filename: "scan.nii.gz" });
      }
      if (endpoint.includes("/api/run-epai-inference")) {
        const sessionId = String((init?.body as FormData).get("session_id"));
        return json({ message: "Segmentation started", session_id: sessionId });
      }
      if (endpoint.includes("/api/inference-status/")) {
        return json({ status: "completed" });
      }
      return json({ items: [], total: 0, ids: [] });
    }) as unknown as typeof fetch;
    localStorage.clear();
  });

  afterEach(() => vi.restoreAllMocks());

  // A finished run used to render its "Inference Complete" panel AS A CHILD of
  // the drop zone - that made the box's own rendered size depend on whether a
  // run had finished (undoing the "drop zone is always the same size"
  // fix) and visually overlapped the dashed border. It's now a sibling card
  // directly beneath the drop zone instead: same prominent spot, but the
  // drop zone itself never changes shape.
  it("renders the completed panel as its own card below the drop zone, not nested inside it", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <AuthProvider>
        <MemoryRouter>
          <UploadPage />
        </MemoryRouter>
      </AuthProvider>,
    );

    await waitFor(() =>
      expect(screen.queryByText(/to run inference/)).not.toBeInTheDocument(),
    );

    const dropzone = container.querySelector(".dropzone")!;
    const dropzoneClassBefore = dropzone.className;

    const input = container.querySelector<HTMLInputElement>('input[accept=".nii,.gz"]')!;
    await user.upload(input, new File([new Uint8Array([1, 2, 3])], "scan.nii.gz"));
    await screen.findByText(/ready/);
    await user.click(screen.getByRole("button", { name: "Run" }));

    const completedPanel = await screen.findByRole("status");
    expect(completedPanel).toHaveTextContent("Inference Complete");
    // Not nested inside the drop zone...
    expect(completedPanel.closest(".dropzone")).toBeNull();
    // ...and the drop zone's own classes are unaffected by the result existing.
    expect(dropzone.className).toBe(dropzoneClassBefore);
  });
});
