#!/usr/bin/env bun
/**
 * Sitemap hygiene gate.
 *
 *     bun scripts/check-sitemap.mjs            # warn only
 *     bun scripts/check-sitemap.mjs --strict   # exit 1 on any finding
 *
 * `public/sitemap.xml` is written by hand, and nothing bumped `lastmod` when a
 * page changed: on 2026-08-29 the front page still advertised 2026-08-22 while
 * its real last edit was the 27th, and /privacy/ was five days behind. For a
 * site whose whole strategy is being recrawled and cited, a stale `lastmod` is
 * an instruction to crawlers NOT to come back.
 *
 * Three checks, all mechanical:
 *   1. every indexable built page is listed, and every listed URL exists in the
 *      build (a 404 in a sitemap is a crawl budget burned on nothing);
 *   2. no noindex page is listed;
 *   3. `lastmod` is not older than the newest git commit touching the sources
 *      that page is built from.
 *
 * Check 3 needs a source map, kept below. A page whose sources are not mapped
 * is reported rather than skipped: an unmapped page is how this rots again.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = resolve(HERE, "..");
const REPO = resolve(SITE, "..");
const DIST = join(SITE, "dist");
const SITEMAP = join(SITE, "public", "sitemap.xml");

const strict = process.argv.includes("--strict");
const findings = [];
const note = (msg, detail) => findings.push({ msg, detail });

/** Which sources decide a page's content. Layout/global changes are excluded on
 *  purpose: a shared-component tweak is not a content change, and treating it
 *  as one would bump all 21 dates at once and make the signal meaningless. */
const SOURCES = {
  "/": ["src/pages/index.astro", "src/data/diagnostic.json"],
  "/ua/": ["src/pages/ua/index.astro", "src/data/diagnostic.uk.json"],
  "/about/": ["src/pages/about.astro"],
  "/ua/about/": ["src/pages/ua/about.astro"],
  "/connect/": ["src/pages/connect.astro"],
  "/ua/connect/": ["src/pages/ua/connect.astro"],
  "/book/": ["src/pages/book.astro"],
  "/ua/book/": ["src/pages/ua/book.astro"],
  "/privacy/": ["src/pages/privacy.astro"],
  "/ua/privacy/": ["src/pages/ua/privacy.astro"],
  "/scenario-map/": ["src/pages/scenario-map.astro", "src/data/diagnostic.json"],
  "/ua/scenario-map/": ["src/pages/ua/scenario-map.astro", "src/data/diagnostic.uk.json"],
  "/for/professional-services/": ["src/pages/for/professional-services.astro"],
  "/ua/for/professional-services/": ["src/pages/ua/for/professional-services.astro"],
  "/writing/": ["src/pages/writing/index.astro"],
  "/ua/writing/": ["src/pages/ua/writing/index.astro"],
  "/writing/claude-connectors-for-business/": [
    "src/content/writing/claude-connectors-for-business.mdx",
  ],
  "/ua/writing/claude-connectors-for-business/": [
    "src/content/writing-ua/claude-connectors-for-business.mdx",
  ],
  "/writing/spec-shipped-after-its-sdk/": ["src/content/writing/spec-shipped-after-its-sdk.md"],
  "/writing/tool-results-read-as-injection/": [
    "src/content/writing/tool-results-read-as-injection.md",
  ],
  "/writing/what-the-host-does-not-deliver/": [
    "src/content/writing/what-the-host-does-not-deliver.md",
  ],
};

if (!existsSync(DIST)) {
  console.error("check-sitemap: dist/ not found. Run `bun run build` first.");
  process.exit(1);
}

// ── read the sitemap ──────────────────────────────────────────────────────
const xml = readFileSync(SITEMAP, "utf8");
const listed = new Map();
for (const m of xml.matchAll(/<loc>https:\/\/yesmcp\.com([^<]*)<\/loc>\s*<lastmod>([^<]+)<\/lastmod>/g)) {
  listed.set(m[1], m[2]);
}
if (listed.size === 0) {
  console.error("check-sitemap: parsed zero <loc>/<lastmod> pairs — the format changed?");
  process.exit(1);
}

// ── walk the build ────────────────────────────────────────────────────────
const built = new Map(); // url -> { noindex }
const walk = (dir, prefix) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, `${prefix}${entry.name}/`);
    else if (entry.name === "index.html") {
      const html = readFileSync(full, "utf8");
      built.set(prefix || "/", { noindex: /<meta name="robots" content="noindex"/.test(html) });
    }
  }
};
walk(DIST, "/");

for (const [url, { noindex }] of built) {
  if (noindex) {
    if (listed.has(url)) note(`${url} is noindex but listed in the sitemap`);
    continue;
  }
  if (!listed.has(url)) note(`${url} is built and indexable but missing from the sitemap`);
}
for (const url of listed.keys()) {
  if (!built.has(url)) note(`${url} is in the sitemap but not in the build`);
}

// ── lastmod vs git ────────────────────────────────────────────────────────
const gitDate = (paths) => {
  const out = execFileSync(
    "git",
    ["log", "-1", "--format=%cd", "--date=short", "--", ...paths.map((p) => join("site", p))],
    { cwd: REPO, encoding: "utf8" },
  ).trim();
  return out || null;
};

for (const [url, lastmod] of listed) {
  const sources = SOURCES[url];
  if (!sources) {
    note(`${url} has no source mapping in check-sitemap.mjs, so its lastmod is unverifiable`);
    continue;
  }
  const missing = sources.filter((s) => !existsSync(join(SITE, s)));
  if (missing.length) {
    note(`${url} maps to a source that does not exist`, missing.join(", "));
    continue;
  }
  const newest = gitDate(sources);
  if (!newest) continue; // never committed yet: nothing to compare against
  if (lastmod < newest) {
    note(`${url} lastmod ${lastmod} is older than its newest source commit ${newest}`);
  }
}

// ── report ────────────────────────────────────────────────────────────────
if (findings.length === 0) {
  console.log("check-sitemap: clean — every indexable page listed, every lastmod current.");
  process.exit(0);
}
console.log(`check-sitemap: ${findings.length} finding(s)`);
for (const f of findings) {
  console.log(`  ! ${f.msg}`);
  if (f.detail) console.log(`      ${f.detail}`);
}
console.log(
  strict
    ? "  (--strict: failing)"
    : "  (advisory; run with --strict to fail)",
);
process.exit(strict ? 1 : 0);
