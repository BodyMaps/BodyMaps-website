import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PermissionsOverview from "../routes/Settings/PermissionsOverview";
import { PLAN_LIMITS } from "../helpers/accountProfile";

const auth = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("../contexts/authContext", () => ({ useAuth: () => ({ user: auth.user }) }));

const account = (over: Record<string, unknown> = {}) => ({
	plan: "free",
	roles: [] as string[],
	emailVerified: false,
	profile: { organization: "", occupation: "", roleDescription: "" },
	...over,
});

afterEach(() => {
	auth.user = null;
	cleanup();
});

const select = () => screen.getByRole("combobox", { name: /Status/ }) as HTMLSelectElement;

describe("Permissions overview", () => {
	it("opens on the viewer's own status and marks it", () => {
		auth.user = account();
		render(<PermissionsOverview />);
		expect(select().value).toBe("free");
		expect(within(select()).getByRole("option", { name: "Free account (you)" })).toBeTruthy();
		expect(screen.getByText("LesionSegmenter, SuPreM")).toBeTruthy();
	});

	it("puts a free account with a verified email and complete profile on the verified tier", () => {
		auth.user = account({ emailVerified: true, profile: { organization: "JHU", occupation: "PhD", roleDescription: "CT research" } });
		render(<PermissionsOverview />);
		expect(select().value).toBe("verified");
	});

	it("opens a signed-out visitor on Guest, who cannot open scans or run models", () => {
		render(<PermissionsOverview />);
		expect(select().value).toBe("guest");
		expect(screen.getByText("Open any other scan").nextSibling?.textContent).toBe("No");
		expect(screen.getByText("Open the 8 showcase cases (read-only)").nextSibling?.textContent).toBe("Yes");
	});

	it("opens an admin on Admin, and any status can be inspected from the dropdown", async () => {
		auth.user = account({ roles: ["admin"] });
		render(<PermissionsOverview />);
		expect(select().value).toBe("admin");
		expect(screen.getByText("Usage, People and Diagnostics pages")).toBeTruthy();

		await userEvent.selectOptions(select(), "verified");
		expect(screen.getByText("Scans per day").nextSibling?.textContent).toBe(String(PLAN_LIMITS.pro.dailyScans));
		expect(screen.getByText("Models").nextSibling?.textContent).toBe("All models");

		await userEvent.selectOptions(select(), "enterprise");
		expect(screen.getByText("Scans per day").nextSibling?.textContent).toBe("Unlimited");
	});
});
