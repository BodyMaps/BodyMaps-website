import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useParams } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import AssignmentBar from "../components/viewer/AssignmentBar";
import { AuthProvider } from "../contexts/authContext";
import { memberProjects, ownedProjects } from "../helpers/assignments";
import AssignmentsPage from "../routes/AssignmentsPage";
import { type Fake, type Me, assignment, makeFake } from "./assignmentsFakeServer";

// Assignments per project: an owner of several projects chooses which one they are managing, a project other than the
// shared library is searched by full email only and has no library numbers, and a collaborator of a project is a person who
// can be given cases like any other.

let fake: Fake;

const JHU = { id: "jhu", name: "JHU", slug: "jhu", is_default: true, allow_training: false };
const STAN = { id: "p-stan", name: "Stanford Lab", slug: "stanford-lab", is_default: false, allow_training: false };
const MIT = { id: "p-mit", name: "MIT Lab", slug: "mit-lab", is_default: false, allow_training: false };

const as = (projects: NonNullable<Me["projects"]>, roles: string[] = []) => {
	fake = makeFake({ id: "m1", email: "m@x.org", name: "Owner", roles, projects });
	fake.accounts.push({ id: "m1", name: "Owner", email: "m@x.org", annotator: false, manager: true });
	fake.install();
};

const open = () =>
	render(
		<AuthProvider>
			<MemoryRouter initialEntries={["/assignments"]}>
				<Routes>
					<Route path="/assignments" element={<AssignmentsPage />} />
					<Route path="/dashboard" element={<p>dataset page</p>} />
					<Route path="/" element={<p>home page</p>} />
				</Routes>
			</MemoryRouter>
		</AuthProvider>,
	);

beforeEach(() => {
	localStorage.clear();
});

describe("which projects an account belongs to", () => {
	const user = (roles: string[], projects?: NonNullable<Me["projects"]>) => ({
		roles,
		projects: projects?.map((p) => ({
			id: p.id, name: p.name, slug: p.slug, isDefault: p.is_default === true, allowTraining: false,
			role: p.role as "owner" | "collaborator" | null,
		})),
	});

	it("lists the projects with a role and leaves out the ones an admin only sees", () => {
		const u = user([], [{ ...JHU, role: "collaborator" }, { ...STAN, role: "owner" }, { ...MIT, role: null }]);
		expect(memberProjects(u).map((p) => [p.id, p.role])).toEqual([["jhu", "collaborator"], ["p-stan", "owner"]]);
		expect(ownedProjects(u).map((p) => p.id)).toEqual(["p-stan"]);
	});

	it("gives an account with only the older roles the built-in project, so nothing disappears for it", () => {
		expect(memberProjects(user(["annotation_manager"])).map((p) => [p.id, p.role])).toEqual([["jhu", "owner"]]);
		expect(memberProjects(user(["annotator"])).map((p) => [p.id, p.role])).toEqual([["jhu", "collaborator"]]);
		expect(memberProjects(user(["admin"]))).toEqual([]);
		expect(memberProjects(null)).toEqual([]);
	});

	it("does not add the built-in project twice, or over what the server said", () => {
		const u = user(["annotation_manager"], [{ ...JHU, role: "owner" }, { ...STAN, role: "collaborator" }]);
		expect(memberProjects(u).map((p) => p.id)).toEqual(["jhu", "p-stan"]);
	});
});

describe("managing more than one project", () => {
	it("offers a project choice to someone who owns several, starting on the first", async () => {
		as([{ ...JHU, role: "owner" }, { ...STAN, role: "owner" }], ["annotation_manager"]);
		open();
		const pick = await screen.findByTestId("project-select");
		expect(within(pick).getAllByRole("option").map((o) => o.textContent)).toEqual(["JHU", "Stanford Lab"]);
		expect(pick).toHaveValue("jhu");
		expect(await screen.findByTestId("manage-panel")).toBeInTheDocument();
		// the built-in project's requests carry no project at all, as before
		expect(fake.calls.filter((c) => c.method === "GET").map((c) => c.url).every((u) => !u.includes("project="))).toBe(true);
	});

	it("shows no choice to someone who owns one project", async () => {
		as([{ ...STAN, role: "owner" }]);
		open();
		await screen.findByTestId("manage-panel");
		expect(screen.queryByTestId("project-select")).not.toBeInTheDocument();
		// the panel loads its project's cases and people just after it appears, so wait for them
		await waitFor(() => expect(fake.calls.some((c) => c.url.includes("project=p-stan"))).toBe(true));
	});

	it("asks for the other project's people and cases when it is chosen, and hands cases out into it", async () => {
		as([{ ...JHU, role: "owner" }, { ...STAN, role: "owner" }], ["annotation_manager"]);
		open();
		await userEvent.selectOptions(await screen.findByTestId("project-select"), "p-stan");
		await waitFor(() => expect(fake.calls.some((c) => c.method === "GET" && c.url.includes("/people?project=p-stan"))).toBe(true));
		expect(fake.calls.some((c) => c.method === "GET" && /\/assignments\?project=p-stan$/.test(c.url))).toBe(true);
		await userEvent.click(await screen.findByTestId("open-hand-out"));
		const form = within(await screen.findByTestId("hand-out"));
		await userEvent.type(form.getByLabelText("Cases"), "1 to 5");
		await userEvent.type(form.getByLabelText("What to annotate"), "Veins");
		await userEvent.click(await form.findByRole("checkbox", { name: /Rad One/ }));
		await userEvent.click(form.getByRole("button", { name: "Hand out cases" }));
		await waitFor(() => expect(fake.calls.some((c) => c.method === "POST")).toBe(true));
		expect(fake.calls.find((c) => c.method === "POST")!.body).toMatchObject({ assignee_id: "u1", start: 1, end: 5, project_id: "p-stan" });
	});

	it("does not send a project id when handing out in the built-in project", async () => {
		as([{ ...JHU, role: "owner" }, { ...STAN, role: "owner" }], ["annotation_manager"]);
		open();
		await userEvent.click(await screen.findByTestId("open-hand-out"));
		const form = within(await screen.findByTestId("hand-out"));
		await userEvent.type(form.getByLabelText("Cases"), "1 to 5");
		await userEvent.type(form.getByLabelText("What to annotate"), "Veins");
		await userEvent.click(await form.findByRole("checkbox", { name: /Rad One/ }));
		await userEvent.click(form.getByRole("button", { name: "Hand out cases" }));
		await waitFor(() => expect(fake.calls.some((c) => c.method === "POST")).toBe(true));
		expect(fake.calls.find((c) => c.method === "POST")!.body).not.toHaveProperty("project_id");
	});

	it("leaves out the library size and the dataset lines for a project that is not the library", async () => {
		fake = makeFake({ id: "m1", email: "m@x.org", name: "Owner", roles: ["annotation_manager"], projects: [{ ...JHU, role: "owner" }, { ...STAN, role: "owner" }] });
		fake.library = { cancerverse: 24422, abdomenatlas: 9262 };
		fake.accounts.push({ id: "m1", name: "Owner", email: "m@x.org", annotator: false, manager: true });
		fake.install();
		open();
		await userEvent.click(await screen.findByTestId("open-hand-out"));
		expect(await within(await screen.findByTestId("hand-out")).findByTestId("library-size")).toBeInTheDocument();
		await userEvent.keyboard("{Escape}");
		await userEvent.selectOptions(screen.getByTestId("project-select"), "p-stan");
		await userEvent.click(await screen.findByTestId("open-hand-out"));
		const form = within(await screen.findByTestId("hand-out"));
		await userEvent.type(form.getByLabelText("Cases"), "20,000-42,000");
		expect(await form.findByText(/That is 22,001 cases/)).toBeInTheDocument();
		expect(form.queryByTestId("library-size")).not.toBeInTheDocument();
		expect(form.queryByTestId("dataset-shares")).not.toBeInTheDocument();
		// and a range past the library's end is not refused: a project counts its own cases
		await userEvent.clear(form.getByLabelText("Cases"));
		await userEvent.type(form.getByLabelText("Cases"), "50000 to 60000");
		expect(form.queryByText(/The library has cases/)).not.toBeInTheDocument();
	});
});

describe("adding a collaborator to a project that is not the library", () => {
	const openCollaborators = async () => {
		as([{ ...STAN, role: "owner" }]);
		open();
		await userEvent.click(await screen.findByTestId("open-annotators"));
		return within(await screen.findByTestId("annotators"));
	};

	it("searches only once a full email address is typed, and sends it with the project", async () => {
		const p = await openCollaborators();
		const box = p.getByLabelText("Find a person to add as a collaborator");
		expect(box).toHaveAttribute("placeholder", "Their full email address");
		await userEvent.type(box, "maria@clinic");
		expect(p.getByText("Type their full email address.")).toBeInTheDocument();
		expect(fake.calls.some((c) => c.url.includes("/accounts"))).toBe(false);
		await userEvent.type(box, ".org");
		await waitFor(() => expect(fake.calls.some((c) => c.url.includes("/accounts?q=maria%40clinic.org&project=p-stan"))).toBe(true));
	});

	it("adds the person to that project and says so", async () => {
		const p = await openCollaborators();
		await userEvent.type(p.getByLabelText("Find a person to add as a collaborator"), "maria@clinic.org");
		await userEvent.click(await within(await p.findByRole("list", { name: "Matching accounts" })).findByRole("button", { name: "Add as collaborator" }));
		expect(await screen.findByText("Maria Newcomer is now a collaborator and can be handed cases.")).toBeInTheDocument();
		expect(fake.calls.find((c) => c.method === "POST" && c.url.includes("/annotators"))?.body).toEqual({ user_id: "u4", project_id: "p-stan" });
	});

	it("takes a collaborator out of that project only", async () => {
		const p = await openCollaborators();
		const row = (await p.findByText("Rad One")).closest("li") as HTMLElement;
		await userEvent.click(within(row).getByRole("button", { name: "Remove" }));
		await userEvent.click(await screen.findByRole("button", { name: "Yes, remove" }));
		await waitFor(() => expect(fake.calls.some((c) => c.method === "DELETE" && c.url.endsWith("/annotators/u1?project=p-stan"))).toBe(true));
	});

	it("says there is no account when the address matches nobody", async () => {
		const p = await openCollaborators();
		await userEvent.type(p.getByLabelText("Find a person to add as a collaborator"), "nobody@nowhere.org");
		expect(await p.findByTestId("no-accounts")).toHaveTextContent("No account has that email address.");
	});
});

describe("a collaborator of a project", () => {
	it("gets the Assignments page, with their cases and no Manage view", async () => {
		as([{ ...STAN, role: "collaborator" }]);
		fake.me = { ...fake.me, id: "u1", email: "r1@x.org", name: "Rad One" };
		fake.assignments = [assignment({ id: "s1", project_id: "p-stan", task: "Ducts" })];
		open();
		expect(await screen.findByTestId("summary")).toBeInTheDocument();
		expect(screen.queryByTestId("manage-panel")).not.toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "Manage" })).not.toBeInTheDocument();
	});

	it("is sent away when they belong to no project", async () => {
		as([{ ...STAN, role: null }]);
		open();
		expect(await screen.findByText("dataset page")).toBeInTheDocument();
	});
});

describe("the strip over the viewer", () => {
	function Host() {
		const { caseId = "" } = useParams();
		return <AssignmentBar caseId={caseId} />;
	}
	const openCase = (n: number) =>
		render(
			<AuthProvider>
				<MemoryRouter initialEntries={[`/case/${n}`]}>
					<Routes><Route path="/case/:caseId" element={<Host />} /></Routes>
				</MemoryRouter>
			</AuthProvider>,
		);

	it("ignores another project's cases, whose numbers only look like library numbers", async () => {
		as([{ ...JHU, role: "collaborator" }, { ...STAN, role: "collaborator" }]);
		fake.me = { ...fake.me, id: "u1", email: "r1@x.org" };
		fake.assignments = [assignment({ id: "s1", project_id: "p-stan", start: 55, end: 60, task: "Ducts" })];
		openCase(57);
		await waitFor(() => expect(fake.calls.some((c) => c.url.endsWith("/assignments/mine"))).toBe(true));
		await new Promise((r) => setTimeout(r, 50));
		expect(screen.queryByTestId("assignment-bar")).not.toBeInTheDocument();
		expect(screen.queryByText(/Ducts/)).not.toBeInTheDocument();
	});

	it("still shows a library assignment for the same case number", async () => {
		as([{ ...JHU, role: "collaborator" }, { ...STAN, role: "collaborator" }]);
		fake.me = { ...fake.me, id: "u1", email: "r1@x.org" };
		fake.assignments = [
			assignment({ id: "s1", project_id: "p-stan", start: 55, end: 60, task: "Ducts" }),
			assignment({ id: "j1", project_id: "jhu", start: 55, end: 60, task: "Veins" }),
		];
		openCase(57);
		expect(await screen.findByText(/Veins/)).toBeInTheDocument();
		expect(screen.queryByText(/Ducts/)).not.toBeInTheDocument();
	});
});
