import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../contexts/authContext";
import UploadPage from "../routes/UploadPage";

// "pro" so the plan-aware default effect settles on ePAI; the comparison
// section is still shown until the user actively picks.
const USER = { id: "u1", email: "test.user@example.com", name: null, plan: "pro" };

const json = (body: unknown) => ({
  ok: true,
  status: 200,
  json: async () => body,
  text: async () => "",
  headers: { get: () => "application/json" },
});

describe("model comparison cards", () => {
  beforeEach(() => {
    global.fetch = vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("/api/auth/me")) return json({ user: USER });
      if (u.includes("/api/auth/oauth/providers")) return json({ google: true });
      return json({ items: [], total: 0, ids: [] });
    }) as unknown as typeof fetch;
    localStorage.clear();
  });

  afterEach(() => vi.restoreAllMocks());

  const renderPage = async () => {
    render(
      <AuthProvider>
        <MemoryRouter>
          <UploadPage />
        </MemoryRouter>
      </AuthProvider>,
    );
    await waitFor(() =>
      expect(screen.queryByText(/to run inference/)).not.toBeInTheDocument(),
    );
  };

  it("shows an info card for every model before a choice is made", async () => {
    await renderPage();
    await screen.findByText("Choose a model");
    // The dropdown is closed, so each model's description text appears exactly
    // once - in its own comparison card.
    expect(screen.getByText(/Full abdominal organ segmentation/)).toBeInTheDocument();
    expect(screen.getByText(/anatomically consistent/)).toBeInTheDocument();
    expect(screen.getByText(/fast pancreatic lesion detection/)).toBeInTheDocument();
    expect(screen.getByText(/View only — files never leave your browser/)).toBeInTheDocument();
  });

  it("hides the comparison once a model card is clicked", async () => {
    const user = userEvent.setup();
    await renderPage();
    await screen.findByText("Choose a model");
    // Click the Atlas-Net card (via its description text -> nearest card).
    await user.click(screen.getByText(/anatomically consistent/));
    await waitFor(() => expect(screen.queryByText("Choose a model")).not.toBeInTheDocument());
  });
});
