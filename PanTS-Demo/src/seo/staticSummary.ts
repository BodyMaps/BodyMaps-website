// Static content of every public page, for readers that do not run JavaScript (AI assistants' fetch tools, link
// previews, simple crawlers). The build writes public content into the SPA fallback and emits
// a page-specific shell for each indexed subpage.
// The Terms of Service are deliberately left out (the maintainers do not want AI assistants reading them): no Terms
// section, links to /terms render as plain text, and robots.txt disallows /terms.
// Visitors never see it (index.html hides .bm-static whenever scripts run) and React replaces it on mount.
// The text comes from the same modules the pages render, so it cannot drift from the site.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Plugin } from "vite";
import { FOOTER_INQUIRY_LEAD, NONCLINICAL_WARNING } from "../helpers/copy";
import { titleForPath } from "../helpers/routeTitles";
import { LAST_UPDATED, PRIVACY, PRIVACY_INTRO, type Section } from "../routes/legalText";
import { MEMBERS } from "../routes/TeamPage/members";

export const MARKER = "<!-- bm-static:pages -->";

/** Pages kept out of the summary and out of crawlers' reach (see robots.txt). */
export const NOT_FOR_CRAWLERS = ["/terms"];

const escape = (text: string): string =>
	text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Legal text with [label](target) links, as LegalPage renders them ("contact" is the contact page). */
const withLinks = (text: string): string => {
	let out = "";
	let from = 0;
	for (const m of text.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)) {
		out += escape(text.slice(from, m.index));
		const href = m[2] === "contact" ? "/contact" : m[2];
		out += NOT_FOR_CRAWLERS.includes(href) ? escape(m[1]) : `<a href="${escape(href)}">${escape(m[1])}</a>`;
		from = (m.index ?? 0) + m[0].length;
	}
	return out + escape(text.slice(from));
};

const legal = (id: string, title: string, intro: string, sections: Section[]): string =>
	`<section id="${id}"><h2><a href="/${id}">${title}</a></h2>` +
	`<p>Provisional, under review. ${escape(LAST_UPDATED)}.</p><p>${withLinks(intro)}</p>` +
	sections.map((s) => `<h3>${escape(s.heading)}</h3><p>${withLinks(s.body)}</p>`).join("") +
	"</section>";

/** One section per public page, in sitemap order after the landing page. */
function publicSections() {
	const team = MEMBERS.map((m) => {
		const link = m.links?.linkedin ? ` (<a href="${escape(m.links.linkedin)}">LinkedIn</a>)` : "";
		return `<li>${escape(m.name)}: ${escape(m.role)}${link}</li>`;
	}).join("");
	return {
		dashboard: '<section id="dashboard"><h2><a href="/dashboard">Dataset</a></h2>' +
			"<p>The CT library: search body CT scans from public research datasets, including PanTS and CancerVerse, by case " +
			"number and filter them by tumor status, sex and age. Each case opens in a 2D and 3D viewer with its organ and tumor " +
			"labels; opening a case needs an account.</p></section>",
		statistics: '<section id="statistics"><h2><a href="/statistics">Statistics</a></h2>' +
			"<p>Interactive charts of the CT library that follow the current search filters: contrast phase, sex, age at scan, " +
			"scanner make, most-used scanner models, tumor status and the country of each scan, with how many scans have each " +
			"field recorded.</p></section>",
		upload: '<section id="upload"><h2><a href="/upload">Workspace</a></h2>' +
			"<p>Upload a CT (NIfTI .nii or .nii.gz, or a DICOM series) and run AI segmentation with ePAI, Atlas-Net or " +
			"LesionSegmenter, then review, annotate and refine the result in the browser.</p></section>",
		team: `<section id="team"><h2><a href="/team">Team</a></h2><p>BodyMaps is built at Johns Hopkins University by:</p><ul>${team}</ul></section>`,
		contact: '<section id="contact"><h2><a href="/contact">Contact</a></h2>' +
			`<p>${escape(FOOTER_INQUIRY_LEAD)} the <a href="/contact">contact form</a>. Describe your organization, the imaging ` +
			"modalities and scale, and whether you are evaluating, piloting or ready to contract. Do not send protected health " +
			"information.</p></section>",
		privacy: legal("privacy", "Privacy Notice", PRIVACY_INTRO, PRIVACY),
	};
}

export function renderPublicSections(): string {
	return Object.values(publicSections()).join("\n        ");
}

/** index.html with the page sections written in at the marker. Throws if the marker is missing or repeated. */
export function injectPublicSections(html: string): string {
	const parts = html.split(MARKER);
	if (parts.length !== 2) throw new Error(`index.html must contain ${MARKER} exactly once (found ${parts.length - 1})`);
	return parts[0] + renderPublicSections() + parts[1];
}

/** Reuse Vite's built shell, including its hashed assets, for each indexed subpage. */
export function renderPublicPages(html: string): Record<string, string> {
	const sections = publicSections();
	const descriptions: Record<Exclude<keyof typeof sections, "upload">, string> = {
		dashboard: "Search and explore annotated CT scans from BodyMaps research datasets, including PanTS and CancerVerse.",
		statistics: "Explore BodyMaps CT library statistics by contrast phase, demographics, scanner and tumor status.",
		team: "Meet the Johns Hopkins University research team behind BodyMaps.",
		contact: "Contact BodyMaps about the CT library, segmentation tools and licensing.",
		privacy: "Read the BodyMaps Privacy Notice about accounts, CT uploads and data rights.",
	};
	// The workspace is represented by the homepage in the sitemap.
	return Object.fromEntries((Object.keys(descriptions) as (keyof typeof descriptions)[]).map((slug) => {
		const path = `/${slug}`;
		const url = `https://bodymaps.wse.jhu.edu${path}`;
		const title = escape(titleForPath(path));
		const description = escape(descriptions[slug]);
		const summary = sections[slug].replace(/<h2><a [^>]+>([^<]+)<\/a><\/h2>/, "<h1>$1</h1>");
		const page = html
			.replace(/<title>[^<]*<\/title>/, `<title>${title}</title>\n    <link rel="canonical" href="${url}" />`)
			.replace(/(<meta (?:name|property)="(?:description|og:description|twitter:description)" content=")[^"]*/g, `$1${description}`)
			.replace(/(<meta (?:property|name)="(?:og:title|twitter:title)" content=")[^"]*/g, `$1${title}`)
			.replace(/(<meta property="og:url" content=")[^"]*/, `$1${url}`)
			.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/, "")
			.replace(/<main class="bm-static">[\s\S]*?<\/main>/, () =>
				`<main class="bm-static">${summary}<p>${escape(NONCLINICAL_WARNING)}</p><p><a href="/">BodyMaps home</a></p></main>`);
		return [slug, page];
	}));
}

/** Fill the SPA fallback and generate crawler-readable subpages after Vite writes its assets. */
export function staticSummaryPlugin(): Plugin {
	return {
		name: "bodymaps-static-summary",
		transformIndexHtml: { order: "pre", handler: injectPublicSections },
		async writeBundle({ dir }) {
			if (!dir) throw new Error("A build output directory is required for the public pages");
			const html = await readFile(join(dir, "index.html"), "utf8");
			const pageDir = join(dir, "_public_pages");
			await mkdir(pageDir, { recursive: true });
			await Promise.all(Object.entries(renderPublicPages(html)).map(([slug, page]) =>
				writeFile(join(pageDir, `${slug}.html`), page)));
		},
	};
}
