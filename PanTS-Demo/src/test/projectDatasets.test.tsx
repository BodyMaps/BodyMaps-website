import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation, useParams } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AssignmentBar from "../components/viewer/AssignmentBar";
import { AuthProvider } from "../contexts/authContext";
import AssignmentsPage from "../routes/AssignmentsPage";
import ProjectsSettings from "../routes/Settings/ProjectsSettings";
import { SettingsContext } from "../routes/Settings/context";
import { type Fake, assignment, makeFake } from "./assignmentsFakeServer";

// A project's own dataset: the Upload dataset window, how the hand-out window counts a project's scans, a project's case in the
// list and in the viewer's strip, and the admin page that creates projects and names their owners.

const P = "3924f4cb-1111-2222-3333-444455556666";
const CODE = "3924f4cb";
const STAN = { id: P, name: "Stanford Lab", slug: "stanford-lab", is_default: false, allow_training: false };

type Scan = { number: number; case_id: string; original_name: string; modality: "ct" | "mri"; size_bytes: number; shape: number[]; spacing: number[]; uploaded_at: string | null };
const scan = (number: number, over: Partial<Scan> = {}): Scan => ({
	number, case_id: `PRJ_${CODE}_${String(number).padStart(8, "0")}`, original_name: `patient${number}.nii.gz`, modality: "ct",
	size_bytes: 120 * 1024 ** 2, shape: [512, 512, 300], spacing: [0.8, 0.8, 1.5], uploaded_at: null, ...over,
});

let fake: Fake;
let scans: Scan[];
let configured: boolean;
let projectCalls: { method: string; url: string; body?: Record<string, unknown> }[];
let addOutcome: { status: number; body: Record<string, unknown> } | null;

const reply = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => "", headers: { get: () => "application/json" } }) as unknown as Response;

/** The assignments stand-in from the other suites, with the project scan routes and the chunked upload added in front of it. */
function install(me: Parameters<typeof makeFake>[0]) {
	fake = makeFake(me);
	fake.accounts.push({ id: "m1", name: "Owner", email: "m@x.org", annotator: false, manager: true });
	fake.install();
	const rest = global.fetch;
	global.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
		const u = String(url);
		const method = init?.method ?? "GET";
		const body = init?.body && typeof init.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
		if (u.includes("/upload-inference-chunk")) return reply({ ok: true });
		if (u.includes("/finalize-upload")) return reply({ uploaded_filename: "BDMAP_00000001/ct.nii.gz" });
		const m = /\/api\/projects\/([^/?]+)\/scans(?:\/(\d+))?$/.exec(u);
		if (m) {
			projectCalls.push({ method, url: u, body });
			if (method === "GET") return reply({ scans, configured });
			if (method === "POST") {
				if (addOutcome) return reply(addOutcome.body, addOutcome.status);
				const made = scan(scans.length + 1, { original_name: String(body?.original_name), modality: body?.modality as "ct" | "mri" });
				scans = [...scans, made];
				return reply(made, 201);
			}
			if (method === "DELETE") {
				scans = scans.filter((s) => s.number !== Number(m[2]));
				return reply({ deleted: true });
			}
		}
		return rest(url, init);
	}) as unknown as typeof fetch;
}

const owner = (...extra: { id: string; name: string; slug: string; is_default?: boolean; allow_training?: boolean }[]) => ({
	id: "m1", email: "m@x.org", name: "Owner", roles: [], projects: [{ ...STAN, role: "owner" }, ...extra.map((p) => ({ ...p, role: "owner" }))],
});

const openPage = () =>
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
	scans = [];
	configured = true;
	projectCalls = [];
	addOutcome = null;
});
afterEach(() => vi.restoreAllMocks());

const openUpload = async () => {
	await userEvent.click(await screen.findByTestId("open-upload"));
	return within(await screen.findByTestId("upload-dataset"));
};

const png = (name: string, bytes = 1000) => new File([new Uint8Array(bytes)], name);

describe("the Upload dataset button", () => {
	it("is on the Manage view of a project that is not the library", async () => {
		install(owner());
		openPage();
		expect(await screen.findByTestId("open-upload")).toHaveTextContent("Upload dataset");
	});

	it("is not on the built-in project, which is changed on the server", async () => {
		install({ id: "m1", email: "m@x.org", name: "Owner", roles: ["annotation_manager"], projects: [{ id: "jhu", name: "JHU", slug: "jhu", is_default: true, role: "owner" }] });
		openPage();
		await screen.findByTestId("manage-panel");
		expect(screen.queryByTestId("open-upload")).not.toBeInTheDocument();
	});
});

describe("the Upload dataset window", () => {
	it("lists the project's scans with their numbers and says how many there are", async () => {
		scans = [scan(1), scan(2, { modality: "mri", original_name: "knee.nii" })];
		install(owner());
		openPage();
		const w = await openUpload();
		const list = await w.findByTestId("scan-list");
		expect(within(list).getAllByRole("listitem")).toHaveLength(2);
		expect(list).toHaveTextContent("Case 1");
		expect(list).toHaveTextContent("patient1.nii.gz · CT · 120 MB");
		expect(list).toHaveTextContent("knee.nii · MRI");
		expect(w.getByText("Scans in this project (2)")).toBeInTheDocument();
	});

	it("says so when there are no scans yet", async () => {
		install(owner());
		openPage();
		const w = await openUpload();
		expect(await w.findByTestId("no-scans")).toBeInTheDocument();
	});

	it("says when the server has no dataset folder, and offers no upload", async () => {
		configured = false;
		install(owner());
		openPage();
		const w = await openUpload();
		expect(await w.findByTestId("not-configured")).toHaveTextContent("Dataset uploads are not set up on this server yet.");
		expect(w.getByTestId("start-upload")).toBeDisabled();
	});

	it("uploads the chosen files one after the other and shows each as a numbered case", async () => {
		scans = [scan(1)];
		install(owner());
		openPage();
		const w = await openUpload();
		await userEvent.upload(w.getByTestId("scan-files"), [png("a.nii.gz"), png("b.nii.gz")]);
		expect(w.getByTestId("start-upload")).toHaveTextContent("Upload 2 scans");
		await userEvent.click(w.getByTestId("start-upload"));
		await waitFor(() => expect(w.getAllByText(/Stored as case/)).toHaveLength(2));
		expect(w.getByText("Stored as case 2.")).toBeInTheDocument();
		expect(w.getByText("Stored as case 3.")).toBeInTheDocument();
		const posts = projectCalls.filter((c) => c.method === "POST");
		expect(posts.map((c) => c.body?.original_name)).toEqual(["a.nii.gz", "b.nii.gz"]);
		expect(posts.every((c) => c.body?.modality === "ct")).toBe(true);
		await waitFor(() => expect(w.getByText("Scans in this project (3)")).toBeInTheDocument());
	});

	it("sends the modality that was chosen", async () => {
		install(owner());
		openPage();
		const w = await openUpload();
		await userEvent.click(w.getByRole("radio", { name: "MRI" }));
		await userEvent.upload(w.getByTestId("scan-files"), png("mr.nii.gz"));
		await userEvent.click(w.getByTestId("start-upload"));
		await waitFor(() => expect(projectCalls.some((c) => c.method === "POST")).toBe(true));
		expect(projectCalls.find((c) => c.method === "POST")!.body?.modality).toBe("mri");
	});

	it("does not send a file that is not a NIfTI, and says why", async () => {
		install(owner());
		openPage();
		const w = await openUpload();
		await userEvent.upload(w.getByTestId("scan-files"), [png("slice.dcm")], { applyAccept: false });
		expect(await w.findByText("Only .nii and .nii.gz files can be uploaded.")).toBeInTheDocument();
		expect(w.getByTestId("start-upload")).toBeDisabled();
		expect(projectCalls.filter((c) => c.method === "POST")).toHaveLength(0);
	});

	it("says a scan is already in the project, with its number, and goes on with the next file", async () => {
		install(owner());
		openPage();
		const w = await openUpload();
		addOutcome = { status: 409, body: { error: "This scan is already in the project.", reason: "duplicate", number: 4 } };
		await userEvent.upload(w.getByTestId("scan-files"), [png("dup.nii.gz")]);
		await userEvent.click(w.getByTestId("start-upload"));
		expect(await w.findByText("Already in this project as case 4.")).toBeInTheDocument();
	});

	it("shows the server's reason when a file is refused", async () => {
		install(owner());
		openPage();
		const w = await openUpload();
		addOutcome = { status: 400, body: { error: "That file is not a 3D scan volume (.nii or .nii.gz).", reason: "not_a_volume" } };
		await userEvent.upload(w.getByTestId("scan-files"), [png("bad.nii.gz")]);
		await userEvent.click(w.getByTestId("start-upload"));
		expect(await w.findByRole("alert", { name: "" })).toHaveTextContent("That file is not a 3D scan volume");
	});

	it("removes a scan only after it is confirmed", async () => {
		scans = [scan(1), scan(2)];
		install(owner());
		openPage();
		const w = await openUpload();
		const row = (await w.findByText("Case 2")).closest("li") as HTMLElement;
		await userEvent.click(within(row).getByRole("button", { name: "Remove" }));
		expect(projectCalls.some((c) => c.method === "DELETE")).toBe(false);
		await userEvent.click(within(row).getByRole("button", { name: "Keep" }));
		expect(projectCalls.some((c) => c.method === "DELETE")).toBe(false);
		await userEvent.click(within(row).getByRole("button", { name: "Remove" }));
		await userEvent.click(within(row).getByRole("button", { name: "Yes, remove" }));
		await waitFor(() => expect(w.getByText("Scans in this project (1)")).toBeInTheDocument());
		expect(projectCalls.find((c) => c.method === "DELETE")!.url).toMatch(/\/scans\/2$/);
	});
});

describe("handing out a project's cases", () => {
	const openHandOut = async () => {
		await userEvent.click(await screen.findByTestId("open-hand-out"));
		return within(await screen.findByTestId("hand-out"));
	};

	it("says how many scans the project has", async () => {
		scans = [scan(1), scan(2), scan(3)];
		install(owner());
		openPage();
		const form = await openHandOut();
		expect(await form.findByTestId("project-size")).toHaveTextContent("This project has 3 scans: cases 1 to 3.");
	});

	it("points at Upload dataset when the project has no scans", async () => {
		install(owner());
		openPage();
		const form = await openHandOut();
		expect(await form.findByTestId("project-size")).toHaveTextContent("This project has no scans yet. Press Upload dataset first.");
		await userEvent.type(form.getByLabelText("Cases"), "1 to 2");
		await userEvent.type(form.getByLabelText("What to annotate"), "Veins");
		expect(await form.findByText("This project has no scans yet. Upload a dataset first.", { selector: "span" })).toBeInTheDocument();
		expect(form.getByRole("button", { name: "Hand out cases" })).toBeDisabled();
	});

	it("refuses a range past the project's last case and accepts the last one", async () => {
		scans = [scan(1), scan(2), scan(3)];
		install(owner());
		openPage();
		const form = await openHandOut();
		await form.findByTestId("project-size");
		await userEvent.type(form.getByLabelText("Cases"), "2 to 9");
		await userEvent.type(form.getByLabelText("What to annotate"), "Veins");
		await userEvent.click(await form.findByRole("checkbox", { name: /Rad One/ }));
		expect(await form.findByText("This project has cases 1 to 3. Choose cases up to 3.")).toBeInTheDocument();
		expect(form.getByRole("button", { name: "Hand out cases" })).toBeDisabled();
		await userEvent.clear(form.getByLabelText("Cases"));
		await userEvent.type(form.getByLabelText("Cases"), "2 to 3");
		expect(form.getByRole("button", { name: "Hand out cases" })).toBeEnabled();
	});
});

describe("a project's case", () => {
	it("opens by its own id and has no thumbnail, on the collaborator's list", async () => {
		install({ id: "u1", email: "r1@x.org", name: "Rad One", roles: [], projects: [{ ...STAN, role: "collaborator" }] });
		fake.assignments = [assignment({ id: "s1", project_id: P, start: 1, end: 3, total: 3, todo: 3, task: "Ducts" })];
		openPage();
		const cards = await screen.findAllByTestId("assignment-case");
		expect(cards).toHaveLength(3);
		expect(within(cards[0]).getByRole("link")).toHaveAttribute("href", `/case/PRJ_${CODE}_00000001`);
		expect(within(cards[1]).getByRole("link")).toHaveAttribute("href", `/case/PRJ_${CODE}_00000002`);
		expect(within(cards[0]).getByText(`PRJ_${CODE}_00000001`)).toBeInTheDocument();
		expect(within(cards[0]).getByText("Case 1")).toBeInTheDocument();
		expect(cards[0].querySelector("img")).toBeNull();
		expect(screen.getByRole("link", { name: /Start with case 1/ })).toHaveAttribute("href", `/case/PRJ_${CODE}_00000001`);
	});

	it("still opens a library case by its number", async () => {
		install({ id: "u1", email: "r1@x.org", name: "Rad One", roles: ["annotator"], projects: [{ id: "jhu", name: "JHU", slug: "jhu", is_default: true, role: "collaborator" }] });
		fake.assignments = [assignment({ id: "j1", project_id: "jhu", start: 55, end: 56, total: 2, todo: 2 })];
		openPage();
		const cards = await screen.findAllByTestId("assignment-case");
		expect(within(cards[0]).getByRole("link")).toHaveAttribute("href", "/case/55");
		expect(cards[0].querySelector("img")).not.toBeNull();
	});
});

describe("the strip over the viewer for a project's case", () => {
	function Host() {
		const { caseId = "" } = useParams();
		return (
			<>
				<p data-testid="where">{useLocation().pathname}</p>
				<AssignmentBar caseId={caseId} />
			</>
		);
	}
	const openCase = (id: string) =>
		render(
			<AuthProvider>
				<MemoryRouter initialEntries={[`/case/${id}`]}>
					<Routes><Route path="/case/:caseId" element={<Host />} /></Routes>
				</MemoryRouter>
			</AuthProvider>,
		);
	const asCollaborator = (projects: { id: string; name: string; slug: string; is_default?: boolean; role: string }[]) => {
		install({ id: "u1", email: "r1@x.org", name: "Rad One", roles: [], projects });
	};

	it("shows the task of the project's assignment, by the scan's own number", async () => {
		asCollaborator([{ ...STAN, role: "collaborator" }]);
		fake.assignments = [assignment({ id: "s1", project_id: P, start: 1, end: 3, total: 3, todo: 3, task: "Ducts" })];
		openCase(`PRJ_${CODE}_00000002`);
		const bar = await screen.findByTestId("assignment-bar");
		expect(bar).toHaveTextContent("Ducts");
		expect(bar).toHaveTextContent("Case 2 · your cases 1 to 3");
	});

	it("moves on to the project's next scan, not to a library case", async () => {
		asCollaborator([{ ...STAN, role: "collaborator" }]);
		fake.assignments = [assignment({ id: "s1", project_id: P, start: 1, end: 3, total: 3, todo: 3, task: "Ducts" })];
		openCase(`PRJ_${CODE}_00000001`);
		await userEvent.click(await screen.findByRole("button", { name: "Done, next case" }));
		await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(`/case/PRJ_${CODE}_00000002`));
		expect(fake.calls.find((c) => c.method === "PUT")!.url).toMatch(/\/assignments\/s1\/cases\/1$/);
	});

	it("ignores an assignment of another project, and a library assignment, for the same number", async () => {
		asCollaborator([{ ...STAN, role: "collaborator" }, { id: "p-mit", name: "MIT", slug: "mit", role: "collaborator" }, { id: "jhu", name: "JHU", slug: "jhu", is_default: true, role: "collaborator" }]);
		fake.assignments = [
			assignment({ id: "m1", project_id: "p-mit", start: 1, end: 3, task: "Other lab" }),
			assignment({ id: "j1", project_id: "jhu", start: 1, end: 3, task: "Library" }),
		];
		openCase(`PRJ_${CODE}_00000002`);
		await waitFor(() => expect(fake.calls.some((c) => c.url.endsWith("/assignments/mine"))).toBe(true));
		await new Promise((r) => setTimeout(r, 50));
		expect(screen.queryByTestId("assignment-bar")).not.toBeInTheDocument();
	});

	it("is not shown for a project case that is in no assignment", async () => {
		asCollaborator([{ ...STAN, role: "collaborator" }]);
		fake.assignments = [assignment({ id: "s1", project_id: P, start: 1, end: 3, task: "Ducts" })];
		openCase(`PRJ_${CODE}_00000009`);
		await waitFor(() => expect(fake.calls.some((c) => c.url.endsWith("/assignments/mine"))).toBe(true));
		await new Promise((r) => setTimeout(r, 50));
		expect(screen.queryByTestId("assignment-bar")).not.toBeInTheDocument();
	});
});

// ---- the admin page ----------------------------------------------------------------------------------------------------

describe("the admin Projects page", () => {
	let projects: { id: string; name: string; slug: string; is_default: boolean; allow_training: boolean; role: string | null }[];
	let members: { id: string; name: string | null; email: string; role: "owner" | "collaborator" }[];
	let calls: { method: string; url: string; body?: Record<string, unknown> }[];
	let known: Record<string, { id: string; name: string | null; email: string }>;

	beforeEach(() => {
		calls = [];
		projects = [
			{ id: "jhu", name: "JHU", slug: "jhu", is_default: true, allow_training: false, role: null },
			{ id: P, name: "Stanford Lab", slug: "stanford-lab", is_default: false, allow_training: false, role: null },
		];
		members = [{ id: "o1", name: "Dr Owner", email: "owner@stanford.edu", role: "owner" }, { id: "c1", name: null, email: "c@stanford.edu", role: "collaborator" }];
		known = { "newowner@stanford.edu": { id: "o2", name: "New Owner", email: "newowner@stanford.edu" } };
		global.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
			const u = String(url);
			const method = init?.method ?? "GET";
			const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
			if (u.includes("/api/auth/me")) return reply({ user: { id: "a1", email: "admin@x.org", name: "Admin", plan: "free", roles: ["admin"], projects } });
			if (u.includes("/api/auth/oauth/providers")) return reply({});
			if (!u.includes("/api/projects")) return reply({});
			calls.push({ method, url: u, body });
			if (method === "GET" && /\/api\/projects$/.test(u)) return reply({ projects });
			if (method === "POST" && /\/api\/projects$/.test(u)) {
				const made = { id: "new-id", name: String(body?.name), slug: "x", is_default: false, allow_training: false, role: null };
				projects = [...projects, made];
				return reply(made, 201);
			}
			if (method === "PATCH") {
				const id = /\/api\/projects\/([^/]+)$/.exec(u)![1];
				projects = projects.map((p) => (p.id === id ? { ...p, allow_training: Boolean(body?.allow_training) } : p));
				return reply(projects.find((p) => p.id === id));
			}
			if (method === "GET" && u.endsWith("/members")) return reply({ members });
			if (method === "GET" && u.includes("/find?email=")) {
				const email = decodeURIComponent(u.split("email=")[1]);
				return reply({ account: known[email] ?? null });
			}
			if (method === "POST" && u.endsWith("/members")) {
				const who = Object.values(known).find((k) => k.id === body?.user_id)!;
				members = [...members, { ...who, role: "owner" }];
				return reply({ ...who, role: "owner" });
			}
			if (method === "DELETE") {
				members = members.filter((m) => !u.endsWith(`/members/${m.id}`));
				return reply({ removed: true });
			}
			return reply({});
		}) as unknown as typeof fetch;
	});

	const notices: string[] = [];
	const fails: string[] = [];
	const renderPageAsAdmin = () => {
		notices.length = 0;
		fails.length = 0;
		return render(
			<AuthProvider>
				<MemoryRouter>
					<SettingsContext.Provider value={{
						busy: false,
						run: async (fn) => { try { await fn(); } catch (e) { fails.push(e instanceof Error ? e.message : "?"); } },
						notify: (m) => notices.push(m),
						fail: (m) => fails.push(m),
					}}>
						<ProjectsSettings />
					</SettingsContext.Provider>
				</MemoryRouter>
			</AuthProvider>,
		);
	};
	const card = async (name: string) => within((await screen.findAllByTestId("project-card")).find((c) => c.textContent?.includes(name))!);

	it("lists every project, and explains the built-in one instead of offering to change it", async () => {
		renderPageAsAdmin();
		const jhu = await card("JHU");
		expect(jhu.getByText(/Its owners are set on the server/)).toBeInTheDocument();
		expect(jhu.queryByRole("switch")).not.toBeInTheDocument();
		const stan = await card("Stanford Lab");
		await waitFor(() => expect(stan.getByText("Dr Owner")).toBeInTheDocument());
		expect(stan.getByText("owner@stanford.edu")).toBeInTheDocument();
	});

	it("creates a project from its name", async () => {
		renderPageAsAdmin();
		await userEvent.type(await screen.findByLabelText(/New project/), "MIT Lab");
		await userEvent.click(screen.getByRole("button", { name: "Create project" }));
		await waitFor(() => expect(calls.find((c) => c.method === "POST" && /\/api\/projects$/.test(c.url))?.body).toEqual({ name: "MIT Lab" }));
		expect(await card("MIT Lab")).toBeTruthy();
		expect(notices.some((n) => n.startsWith("MIT Lab was created"))).toBe(true);
	});

	it("will not create a project with no name", async () => {
		renderPageAsAdmin();
		expect(await screen.findByRole("button", { name: "Create project" })).toBeDisabled();
	});

	it("makes someone an owner by their full email address", async () => {
		renderPageAsAdmin();
		const stan = await card("Stanford Lab");
		await userEvent.type(await stan.findByLabelText(/Add an owner/), "newowner@stanford.edu");
		await userEvent.click(stan.getByRole("button", { name: "Add owner" }));
		await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/members"))).toBe(true));
		expect(calls.find((c) => c.method === "POST" && c.url.endsWith("/members"))!.body).toEqual({ user_id: "o2", role: "owner" });
		expect(await stan.findByText("New Owner")).toBeInTheDocument();
		expect(notices.some((n) => n.includes("is now an owner of Stanford Lab"))).toBe(true);
	});

	it("says when no account has that address, and adds nobody", async () => {
		renderPageAsAdmin();
		const stan = await card("Stanford Lab");
		await userEvent.type(await stan.findByLabelText(/Add an owner/), "nobody@nowhere.org");
		await userEvent.click(stan.getByRole("button", { name: "Add owner" }));
		await waitFor(() => expect(fails.length).toBe(1));
		expect(fails[0]).toMatch(/No account has that email address/);
		expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/members"))).toBe(false);
	});

	it("removes an owner only after it is confirmed", async () => {
		renderPageAsAdmin();
		const stan = await card("Stanford Lab");
		await userEvent.click(await stan.findByRole("button", { name: "Remove Dr Owner as an owner" }));
		expect(calls.some((c) => c.method === "DELETE")).toBe(false);
		await userEvent.click(stan.getByRole("button", { name: "Yes, remove" }));
		await waitFor(() => expect(calls.some((c) => c.method === "DELETE")).toBe(true));
		expect(calls.find((c) => c.method === "DELETE")!.url).toMatch(/\/members\/o1$/);
	});

	it("turns training on and off for a project, off by default", async () => {
		renderPageAsAdmin();
		const stan = await card("Stanford Lab");
		const toggle = await stan.findByRole("switch", { name: /Allow training/ });
		expect(toggle).not.toBeChecked();
		await userEvent.click(toggle);
		await waitFor(() => expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({ allow_training: true }));
		await waitFor(() => expect(stan.getByRole("switch", { name: /Allow training/ })).toBeChecked());
		expect(notices.some((n) => n.includes("may now be used for training"))).toBe(true);
	});
});
