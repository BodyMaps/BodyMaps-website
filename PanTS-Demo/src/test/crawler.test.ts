/**
 * Crawler-readable guard: search engines, link previews and AI assistants mostly do not run JavaScript, so
 * index.html carries a static summary inside #root (React replaces it on mount), and public/ ships
 * robots.txt, sitemap.xml and llms.txt. Every page those files point to must be a real guest-accessible route,
 * and robots.txt must never block one of them.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { LANDING_SUBTITLE, NONCLINICAL_WARNING, SITE_DESCRIPTION } from "../helpers/copy";
import { MARKER, injectPublicSections, renderPublicPages, renderPublicSections } from "../seo/staticSummary";
import { titleForPath } from "../helpers/routeTitles";
import { PRIVACY, PRIVACY_INTRO, TERMS, TERMS_INTRO } from "../routes/legalText";
import { MEMBERS } from "../routes/TeamPage/members";

// Normalized so a Windows checkout (CRLF) reads the same as the LF files in the repo.
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8").replace(/\r\n/g, "\n");
const ORIGIN = "https://bodymaps.wse.jhu.edu";

const app = read("src/App.tsx");
/** Paths in App.tsx's publicPage list ("" is the landing page). */
const publicPages = (): string[] => {
  const m = app.match(/const publicPage = \[([^\]]*)\]/);
  if (!m) throw new Error("publicPage list not found in App.tsx");
  return [...m[1].matchAll(/"([^"]*)"/g)].map((x) => x[1] || "/");
};
const routePaths = new Set([...app.matchAll(/<Route path="([^"]+)"/g)].map((x) => x[1]));

const staticBlock = (): string => {
  const html = read("index.html");
  const m = html.match(/<div id="root">([\s\S]*?)<\/div>\s*<script type="module"/);
  if (!m) throw new Error("#root block not found");
  return m[1];
};
const sitemapPaths = (): string[] =>
  [...read("public/sitemap.xml").matchAll(/<loc>([^<]+)<\/loc>/g)].map((x) => x[1].replace(ORIGIN, "") || "/");
const disallowed = (): string[] =>
  read("public/robots.txt").split("\n").filter((l) => l.startsWith("Disallow:")).map((l) => l.slice(9).trim());

describe("crawler-readable site", () => {
  it("React replaces the static summary rather than hydrating it", () => {
    const main = read("src/main.tsx");
    expect(main).toContain("createRoot(document.getElementById('root')!)");
    expect(main).not.toContain("hydrateRoot");
  });

  it("visitors never see the summary: hidden by default in <head>, shown only when JavaScript is off", () => {
    const html = read("index.html");
    const head = html.slice(0, html.indexOf("<body>"));
    // hidden by the base rule itself, so no script has to run before the first paint
    expect(head).toMatch(/\.bm-static \{ display: none;/);
    expect(head).toContain("<noscript><style>.bm-static { display: block; }</style></noscript>");
    expect(html).not.toContain("bm-js");
  });

  it("index.html has readable text for non-JavaScript readers, in the canonical copy", () => {
    const block = staticBlock();
    for (const text of [LANDING_SUBTITLE, NONCLINICAL_WARNING]) expect(block).toContain(text);
    expect(block).toMatch(/<h1>BodyMaps<\/h1>/);
    expect(block).not.toContain("Browse the library in 2D and 3D");
    for (const model of ["ePAI", "Atlas-Net", "LesionSegmenter"]) expect(block).toContain(model);
    expect(block).not.toMatch(/—/);
    expect(read("index.html")).toContain('"application/ld+json"');
  });

  it("the SPA fallback contains every public summary", () => {
    const html = read("index.html");
    expect(html.split(MARKER).length).toBe(2);
    expect(staticBlock()).toContain(MARKER);
    expect(read("vite.config.ts")).toMatch(/plugins: \[[^\]]*staticSummaryPlugin\(\)/);
    const built = injectPublicSections(html);
    expect(built).not.toContain(MARKER);
    const inRoot = built.slice(built.indexOf('<div id="root">'), built.indexOf('<script type="module"'));
    for (const m of MEMBERS) {
      expect(inRoot).toContain(m.name.replace(/&/g, "&amp;"));
      expect(inRoot).toContain(m.role);
    }
    for (const id of ["dashboard", "statistics", "upload", "team", "contact"]) {
      expect(inRoot).toContain(`<section id="${id}"><h2><a href="/${id}">`);
    }
    expect(() => injectPublicSections(html.replace(MARKER, ""))).toThrow();
    expect(() => injectPublicSections(html + MARKER)).toThrow();
  });

  it("gives each indexed subpage its own canonical HTML without changing the SPA entry", () => {
    const fallback = injectPublicSections(read("index.html"));
    const pages = renderPublicPages(fallback);
    const slugs = sitemapPaths().filter((path) => path !== "/").map((path) => path.slice(1));
    const nginx = read("../flask-server/deploy/nginx-bodymaps.conf");
    const nginxPages = nginx.match(/\(\?<public_page>([^)]+)\)/)?.[1]?.split("|");
    expect(Object.keys(pages).sort()).toEqual(slugs.sort());
    expect(nginxPages?.sort()).toEqual(slugs);
    const descriptions = new Set<string>();
    for (const [slug, html] of Object.entries(pages)) {
      const title = titleForPath(`/${slug}`);
      expect(html).toContain(`<title>${title}</title>`);
      expect(html).toContain(`<link rel="canonical" href="${ORIGIN}/${slug}"`);
      expect(html).toContain(`<meta property="og:url" content="${ORIGIN}/${slug}"`);
      expect(html).toContain(`<meta property="og:title" content="${title}"`);
      const description = html.match(/<meta name="description" content="([^"]+)"/)?.[1];
      expect(description).toBeTruthy();
      descriptions.add(description!);
      expect(html).toContain(`<section id="${slug}"><h1>`);
      expect(html.match(/<section id=/g)).toHaveLength(1);
      expect(html).toContain('<script type="module" src="/src/main.tsx">');
    }
    expect(descriptions.size).toBe(slugs.length);
  });

  it.each([
    { path: "/terms", intro: TERMS_INTRO, sections: TERMS },
    { path: "/privacy", intro: PRIVACY_INTRO, sections: PRIVACY },
  ])("excludes $path from crawler content and discovery but keeps the browser route", ({ path, intro, sections }) => {
    const built = injectPublicSections(read("index.html"));
    const slug = path.slice(1);
    const pages = renderPublicPages(built);
    expect(pages).not.toHaveProperty(slug);
    for (const html of [built, ...Object.values(pages)]) {
      expect(html).not.toContain(`<section id="${slug}"`);
      expect(html).not.toContain(`href="${path}"`);
      expect(html).not.toContain(intro.slice(0, 60));
      for (const s of sections) expect(html).not.toContain(s.body.slice(0, 80).replace(/&/g, "&amp;"));
    }
    expect(read("public/llms.txt")).not.toContain(path);
    expect(sitemapPaths()).not.toContain(path);
    expect(disallowed()).toContain(path);
    expect(routePaths.has(path)).toBe(true);
    expect(publicPages()).toContain(path);
  });

  it("every link in the static summary, sitemap and llms.txt is a real, guest-accessible route", () => {
    const pub = new Set(publicPages());
    const links = [
      ...[...staticBlock().matchAll(/href="([^"]+)"/g)].map((x) => x[1]),
      ...[...renderPublicSections().matchAll(/href="(\/[^"]*)"/g)].map((x) => x[1]),
      ...sitemapPaths(),
      ...[...read("public/llms.txt").matchAll(/\]\((https?:\/\/[^)]+)\)/g)].map((x) => x[1].replace(ORIGIN, "") || "/"),
    ];
    expect(links.length).toBeGreaterThan(10);
    for (const link of links) {
      expect(link.startsWith("/"), `${link} is not on this site`).toBe(true);
      expect(routePaths.has(link), `${link} is not a route in App.tsx`).toBe(true);
      expect(pub.has(link), `${link} is not in App.tsx's publicPage list`).toBe(true);
    }
  });

  it("robots.txt allows crawling, points at the sitemap, and blocks none of the listed pages", () => {
    const robots = read("public/robots.txt");
    expect(robots).toMatch(/^User-agent: \*$/m);
    expect(robots).toMatch(/^Allow: \/$/m);
    expect(robots).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`);
    const blocked = disallowed();
    expect(blocked).not.toContain("/");
    expect(blocked).toContain("/api/");
    for (const page of sitemapPaths()) {
      for (const prefix of blocked) expect(page.startsWith(prefix), `${page} blocked by ${prefix}`).toBe(false);
    }
  });

  it("the sitemap covers every guest page except auth flows, local-file viewers and legal pages", () => {
    const skip = new Set(["/upload", "/local-nifti", "/dicom", "/reset-password", "/verify-email", "/signup", "/login", "/terms", "/privacy"]);
    expect(new Set(sitemapPaths())).toEqual(new Set(publicPages().filter((p) => !skip.has(p))));
  });

  it("ships exactly one IndexNow key file whose content is its own name", () => {
    const keys = readdirSync(resolve(process.cwd(), "public")).filter((f) => /^[0-9a-f]{32}\.txt$/.test(f));
    expect(keys).toHaveLength(1);
    expect(read(`public/${keys[0]}`)).toBe(keys[0].slice(0, 32));
    expect(read("scripts/indexnow-submit.mjs")).toContain("api.indexnow.org/indexnow");
  });

  it("llms.txt opens with the site description", () => {
    const llms = read("public/llms.txt");
    expect(llms.startsWith("# BodyMaps\n")).toBe(true);
    expect(llms).toContain(`> ${SITE_DESCRIPTION}`);
    expect(llms).toContain(NONCLINICAL_WARNING);
  });
});
