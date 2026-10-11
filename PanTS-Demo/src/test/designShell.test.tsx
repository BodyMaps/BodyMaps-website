import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DesignShell from "../components/DesignShell";
import { recentUploadsStorageKey, setRecentUploadsAccount } from "../helpers/recentUploads";

vi.mock("../components/AuthButton", () => ({ default: () => <button type="button">Account controls</button> }));
vi.mock("../components/WorkspaceTour", () => ({ default: () => null }));
vi.mock("../components/SiteFooter", () => ({ default: () => <footer>Site footer</footer> }));
const Location = () => <output aria-label="Current route">{useLocation().pathname}</output>;
const mount = (path = "/dashboard") => render(<MemoryRouter initialEntries={[path]}>
    <Routes><Route element={<DesignShell />}><Route path="*" element={<Location />} /></Route></Routes>
</MemoryRouter>);
beforeEach(() => { localStorage.clear(); setRecentUploadsAccount("u1"); });

describe("workspace sidebar", () => {
    it("uses real routes for workspace, dataset and team", async () => {
        const user = userEvent.setup();
        mount();
        expect(screen.getByRole("link", { name: "Dataset" })).toHaveAttribute("aria-current", "page");
        await user.click(screen.getByRole("link", { name: "Team" }));
        expect(screen.getByLabelText("Current route")).toHaveTextContent("/team");
        await user.click(screen.getByRole("link", { name: "Workspace" }));
        expect(screen.getByLabelText("Current route")).toHaveTextContent("/");
    });

    it("persists collapsing while retaining labelled navigation", async () => {
        const user = userEvent.setup();
        mount();
        await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));
        expect(localStorage.getItem("bodymaps.sidebar.collapsed")).toBe("true");
        expect(screen.getByRole("button", { name: "Expand sidebar" })).toHaveAttribute("aria-expanded", "false");
        expect(screen.getByRole("link", { name: "Dataset" })).toHaveAttribute("href", "/dashboard");
    });

    it("opens a completed result using its real session and retains other recent runs", async () => {
        const user = userEvent.setup();
        localStorage.setItem(recentUploadsStorageKey("u1"), JSON.stringify([
            { sessionId: "scan-a", label: "First scan", model: "cads551", status: "Completed", timestamp: Date.now() },
            { sessionId: "scan-b", label: "Second scan", model: "epai", status: "Processing", timestamp: Date.now() - 1 },
        ]));
        mount();
        await user.click(screen.getByRole("button", { name: /First scan/ }));
        expect(screen.getByLabelText("Current route")).toHaveTextContent("/session/scan-a");
        expect(JSON.parse(localStorage.getItem(recentUploadsStorageKey("u1")) ?? "[]")).toHaveLength(2);
    });

    it("New run navigates to the composer without clearing previous runs", async () => {
        const user = userEvent.setup();
        const saved = JSON.stringify([{ sessionId: "scan-a", label: "Existing scan", model: "epai", status: "Completed", timestamp: Date.now() }]);
        localStorage.setItem(recentUploadsStorageKey("u1"), saved);
        mount();
        await user.click(screen.getByRole("button", { name: "New run" }));
        expect(screen.getByLabelText("Current route")).toHaveTextContent("/upload");
        expect(localStorage.getItem(recentUploadsStorageKey("u1"))).toBe(saved);
    });

    it("mobile navigation closes on Escape and returns focus to its opener", async () => {
        const user = userEvent.setup();
        mount();
        await user.click(screen.getByRole("button", { name: "Open navigation" }));
        expect(screen.getByRole("button", { name: "Open navigation" })).toHaveAttribute("aria-expanded", "true");
        await user.keyboard("{Escape}");
        expect(screen.getByRole("button", { name: "Open navigation" })).toHaveAttribute("aria-expanded", "false");
        expect(screen.getByRole("button", { name: "Open navigation" })).toHaveFocus();
    });
});
