// The account control in the nav bar. What it puts on screen is the whole
// point of it: the name once the account has one, the email until then — an
// address is what we have to fall back on, not what anyone wants to see.
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AuthButton from "../components/AuthButton";
import { AuthProvider } from "../contexts/authContext";

const USER = {
	id: "u1",
	email: "test.user@example.com",
	name: null as string | null,
	plan: "free",
};

const json = (body: unknown) => ({
	ok: true,
	status: 200,
	json: async () => body,
	text: async () => "",
	headers: { get: () => "application/json" },
});

beforeEach(() => {
	USER.name = null;
	localStorage.clear();
	global.fetch = vi.fn(async (url: RequestInfo | URL) => {
		const u = String(url);
		if (u.includes("/api/auth/oauth/providers")) return json({ google: true, github: true });
		if (u.includes("/api/auth/me")) return json({ user: { ...USER } });
		return json({});
	}) as unknown as typeof fetch;
});

afterEach(() => vi.restoreAllMocks());

const renderButton = () =>
	render(
		<AuthProvider>
			<MemoryRouter>
				<AuthButton />
			</MemoryRouter>
		</AuthProvider>
	);

describe("the signed-in account control", () => {
	it("shows the name once one is set", async () => {
		USER.name = "Ada Lovelace";
		renderButton();

		expect(await screen.findByText("Ada Lovelace")).toBeInTheDocument();
		// The email is still in the dropdown, but the dropdown is closed.
		expect(screen.queryByText("test.user@example.com")).not.toBeInTheDocument();
	});

	it("falls back to the email until there is one", async () => {
		renderButton();

		expect(await screen.findByText("test.user@example.com")).toBeInTheDocument();
	});
});


const Location = () => <output aria-label="Current path">{useLocation().pathname}</output>;
const renderSidebar = (onWalkthrough = vi.fn()) => render(
    <AuthProvider><MemoryRouter initialEntries={["/dashboard"]}>
        <AuthButton variant="sidebar" onWalkthrough={onWalkthrough} /><Location />
    </MemoryRouter></AuthProvider>
);

describe("sidebar account actions", () => {
    it("opens profile settings and supports keyboard menu navigation", async () => {
        const user = userEvent.setup();
        renderSidebar();
        await user.click(await screen.findByRole("button", { name: "Settings" }));
        expect(screen.getByRole("menuitem", { name: /Profile and settings/ })).toHaveFocus();
        await user.keyboard("{ArrowDown}");
        expect(screen.getByRole("menuitem", { name: /Walkthrough/ })).toHaveFocus();
        await user.keyboard("{Escape}");
        expect(screen.queryByRole("menu")).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Settings" })).toHaveFocus();
        await user.click(screen.getByRole("button", { name: "Settings" }));
        await user.click(screen.getByRole("menuitem", { name: /Profile and settings/ }));
        expect(screen.getByLabelText("Current path")).toHaveTextContent("/account");
    });

    it("replays the actual walkthrough callback and closes the menu", async () => {
        const user = userEvent.setup(), walkthrough = vi.fn();
        renderSidebar(walkthrough);
        await user.click(await screen.findByRole("button", { name: "Settings" }));
        await user.click(screen.getByRole("menuitem", { name: /Walkthrough/ }));
        expect(walkthrough).toHaveBeenCalledOnce();
        expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });

    it("revokes the backend session from the sign-out control", async () => {
        const user = userEvent.setup();
        renderSidebar();
        await user.click(await screen.findByRole("button", { name: "Settings" }));
        await user.click(screen.getByRole("menuitem", { name: "Sign out" }));
        await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url, init]) => String(url).includes("/api/auth/logout") && init?.method === "POST")).toBe(true));
        expect(screen.getByLabelText("Current path")).toHaveTextContent("/");
        expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
    });
});
