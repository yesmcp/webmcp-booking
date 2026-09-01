#!/usr/bin/env node
/**
 * Design gate for yesmcp.com.
 *
 * Why this exists: every colour and size on this site used to be picked by eye,
 * and on 2026-08-26 that cost us five contrast failures shipped to production
 * (paper/40 at 3.52:1, paper/45 at 4.12:1, yes/80 at 3.75:1 among them), a grey
 * wash on black the owner rejected, and 96 one-off font sizes that added up to
 * 38 typographic variants on a single page. None of that is a taste problem —
 * it is arithmetic nobody was doing.
 *
 * The gate does the arithmetic. It runs in two halves:
 *
 *   STATIC   — reads the source. No browser. Catches hardcoded hex, one-off
 *              font sizes, and text opacities that are mathematically incapable
 *              of passing AA on our ink background.
 *   RUNTIME  — builds, serves, and walks the real pages with a browser. Catches
 *              what static analysis cannot see: composited backgrounds, overlaps,
 *              actual rendered contrast, and the axe-core rule set.
 *
 * Both halves are needed. A token-level check sees numbers; axe sees what the
 * reader sees. On 2026-08-26 a hand-rolled runtime check reported nonsense
 * (1.09:1 for body text on the dark section) while the token math was right —
 * and the reverse can happen just as easily.
 *
 * Default mode is ADVISORY: it reports and exits 0 (owner's call, 2026-08-26).
 * Pass --strict to make findings fail the run once the noise floor is known.
 *
 * Usage:  bun run check:design  [--strict] [--skip-runtime]
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SRC = join(ROOT, "src");
const STRICT = process.argv.includes("--strict");
const SKIP_RUNTIME = process.argv.includes("--skip-runtime");
const PORT = 4399;

// Pages the gate walks. Anything not listed here is not covered — say so out
// loud rather than implying the whole site is clean.
const PAGES = ["/", "/ua/", "/connect/", "/ua/connect/", "/scenario-map/", "/ua/scenario-map/", "/about/", "/writing/", "/book/", "/ua/book/", "/for/professional-services/", "/ua/for/professional-services/"];

const findings = [];
const note = (level, area, message, detail) => findings.push({ level, area, message, detail });

// ── colour maths ────────────────────────────────────────────────────────────
const hexToRgb = (h) => {
  const s = h.replace("#", "");
  const full = s.length === 3 ? s.split("").map((c) => c + c).join("") : s;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
};
const relLum = ([r, g, b]) => {
  const f = (c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (a, b) => {
  const [l1, l2] = [relLum(a), relLum(b)];
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
};
const over = (fg, bg, alpha) => fg.map((c, i) => Math.round(c * alpha + bg[i] * (1 - alpha)));

// ── the palette, read from the one place it is allowed to live ──────────────
function readTheme() {
  const css = readFileSync(join(SRC, "styles/global.css"), "utf8");
  const block = css.slice(css.indexOf("@theme"), css.indexOf("}", css.indexOf("@theme")));
  const colors = {};
  for (const m of block.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-fA-F]{3,8})/g)) colors[m[1]] = m[2];
  return colors;
}

// ── static half ─────────────────────────────────────────────────────────────
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if ([".astro", ".mdx"].includes(extname(p))) out.push(p);
  }
  return out;
}

function staticChecks(theme) {
  const files = walk(SRC).filter((f) => !f.endsWith("global.css"));
  const hardcoded = new Map();
  const sizes = new Map();
  const weakOnInk = new Map();

  // A colour value hardcoded in markup is a colour nobody can audit: it does
  // not appear in the theme, so no contrast check will ever see it.
  //
  // The exceptions are colours that are not ours to own: national flag colours
  // in the language tag, and the brand plate of the invented studio in the
  // widget mocks. Giving those theme tokens would imply they are part of our
  // palette, which is worse than leaving them literal.
  const FOREIGN = new Set(["#005bbb", "#ffd500", "#012169", "#c8102e", "#2f6f4e"]);
  const ALLOWED_HEX = new Set([...Object.values(theme).map((v) => v.toLowerCase()), ...FOREIGN]);

  for (const file of files) {
    const rel = relative(ROOT, file);
    const text = readFileSync(file, "utf8");

    for (const m of text.matchAll(/#[0-9a-fA-F]{6}\b/g)) {
      const hex = m[0].toLowerCase();
      if (ALLOWED_HEX.has(hex)) continue;
      const key = `${hex} · ${rel}`;
      hardcoded.set(key, (hardcoded.get(key) || 0) + 1);
    }

    for (const m of text.matchAll(/text-\[(\d+)px\]/g)) {
      const key = `${m[1]}px`;
      sizes.set(key, (sizes.get(key) || 0) + 1);
    }

    // Text opacity on the ink background: below 50% nothing can reach 4.5:1,
    // so this is decidable without rendering anything.
    for (const m of text.matchAll(/text-paper\/(\d{1,2})\b/g)) {
      const pct = Number(m[1]);
      if (pct >= 50) continue;
      const ratio = contrast(over(hexToRgb(theme.paper), hexToRgb(theme.ink), pct / 100), hexToRgb(theme.ink));
      weakOnInk.set(`text-paper/${pct} → ${ratio.toFixed(2)}:1 · ${rel}`, true);
    }
  }

  if (hardcoded.size)
    note("warn", "tokens", `${hardcoded.size} hardcoded colour(s) outside the theme`, [...hardcoded.keys()].slice(0, 12));
  if (sizes.size)
    note("warn", "type", `${[...sizes.values()].reduce((a, b) => a + b, 0)} one-off font sizes across ${sizes.size} distinct values`,
      [...sizes.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ×${v}`));
  if (weakOnInk.size)
    note("fail", "contrast", `${weakOnInk.size} text opacity below the AA floor on ink`, [...weakOnInk.keys()]);
}

// ── the token contrast table ────────────────────────────────────────────────
function tokenContrast(theme) {
  const surfaces = [["paper", theme.paper], ["paper-deep", theme["paper-deep"]], ["ink", theme.ink]];
  const inks = [["ink", theme.ink], ["ink-soft", theme["ink-soft"]], ["ink-faint", theme["ink-faint"]],
                ["yes", theme.yes], ["yes-deep", theme["yes-deep"]], ["paper", theme.paper]];
  const rows = [];
  for (const [sn, sv] of surfaces) {
    for (const [tn, tv] of inks) {
      if (!sv || !tv || sv === tv) continue;
      const r = contrast(hexToRgb(tv), hexToRgb(sv));
      if (r < 3) continue; // unusable in any role; not a pairing anyone would try
      rows.push({ pair: `${tn} on ${sn}`, ratio: +r.toFixed(2), body: r >= 4.5, large: r >= 3 });
    }
  }
  const largeOnly = rows.filter((r) => !r.body);
  if (largeOnly.length)
    note("warn", "contrast", `${largeOnly.length} token pairing(s) usable for LARGE text only`,
      largeOnly.map((r) => `${r.pair} · ${r.ratio}:1 · headings ≥24px or ≥18.66px bold only`));
  return rows;
}

// ── runtime half ────────────────────────────────────────────────────────────
async function runtimeChecks() {
  const { chromium } = await import("playwright");
  const AxeBuilder = (await import("@axe-core/playwright")).default;

  // A preview server left over from an earlier run will happily serve a STALE
  // dist, and the gate will then report findings that no longer exist — this
  // cost a full debugging detour on 2026-08-26 (axe insisted on a `text-yes/80`
  // class that was not in the build). Refuse to run rather than lie.
  const { execFileSync } = await import("node:child_process");
  const squatter = (() => {
    try { return execFileSync("lsof", ["-ti", `:${PORT}`], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); }
    catch { return ""; }
  })();
  if (squatter) {
    note("warn", "gate", `port ${PORT} already in use (pid ${squatter}) — runtime checks skipped so the gate cannot report stale results`);
    return;
  }

  // Serve dist ourselves. `astro preview` in this project is a wrapper that
  // reuses an already-running instance and ignores --port, so the gate would
  // either measure another server's build or measure nothing at all.
  const { createServer } = await import("node:http");
  const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json",
                 ".svg": "image/svg+xml", ".woff2": "font/woff2", ".png": "image/png", ".jpg": "image/jpeg",
                 ".webp": "image/webp", ".xml": "application/xml", ".txt": "text/plain", ".ico": "image/x-icon" };
  const server = createServer((req, res) => {
    const url = decodeURIComponent(req.url.split("?")[0]);
    const candidate = url.endsWith("/") ? join(ROOT, "dist", url, "index.html") : join(ROOT, "dist", url);
    try {
      const body = readFileSync(candidate);
      res.writeHead(200, { "content-type": MIME[extname(candidate)] || "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  await new Promise((r) => server.listen(PORT, r));
  const stop = () => { try { server.close(); } catch {} };
  process.on("exit", stop);

  try {
    // Poll for readiness instead of sleeping a guessed interval: a fixed wait
    // is either slower than it needs to be or, on a cold start, silently short
    // — and a short one makes every page "fail to load", which looks like a
    // site problem rather than a gate problem.
    let up = false;
    for (let i = 0; i < 60 && !up; i++) {
      await new Promise((r) => setTimeout(r, 500));
      up = await fetch(`http://localhost:${PORT}/`).then((r) => r.ok).catch(() => false);
    }
    if (!up) {
      note("warn", "gate", `preview server did not come up on :${PORT} within 30s — runtime checks skipped`);
      return;
    }

    const browser = await chromium.launch();
    // axe-core refuses a page created straight off the browser: it needs a real
    // context so it can inject into every frame
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();

    let axeTotal = 0;
    const typeVariants = new Set();
    const perPage = [];

    for (const path of PAGES) {
      const res = await page.goto(`http://localhost:${PORT}${path}`, { waitUntil: "load" }).catch(() => null);
      if (!res || !res.ok()) { note("warn", "pages", `could not load ${path}`); continue; }

      // The entrance animations start elements at opacity 0. Setting
      // element.style.opacity does NOT beat them — a running CSS animation wins
      // over an inline style, so axe went on measuring faded colours and
      // reported 159 contrast failures that do not exist (#9c9688 where the
      // token is #6b6455). Kill the animation itself with an injected rule,
      // then the elements sit at their real colours.
      await page.addStyleTag({
        content: `.reveal, .rise, .reveal *, .rise * {
          animation: none !important;
          transition: none !important;
          opacity: 1 !important;
          transform: none !important;
        }`,
      });

      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
      for (const v of results.violations) {
        axeTotal += v.nodes.length;
        note(v.impact === "critical" || v.impact === "serious" ? "fail" : "warn", "a11y",
          `${path} · ${v.id} (${v.nodes.length}×, ${v.impact})`, [v.help, ...v.nodes.slice(0, 2).map((n) => n.target.join(" "))]);
      }

      const variants = await page.evaluate(() => {
        const seen = new Set();
        document.querySelectorAll("main *, header *, footer *").forEach((n) => {
          if (n.children.length || !n.textContent?.trim()) return;
          // The hero card is a mock of somebody else's interface and copies its
          // typography on purpose (system-ui, Claude's own sizes). Counting it
          // is the same mistake as demanding a theme token for a foreign brand
          // colour: it would push us to "fix" a resemblance we built deliberately.
          if (n.closest("#chat-card")) return;
          const cs = getComputedStyle(n);
          seen.add(`${cs.fontFamily.split(",")[0].replace(/"/g, "")}|${Math.round(parseFloat(cs.fontSize))}|${cs.fontWeight}|${cs.letterSpacing}|${cs.textTransform}`);
        });
        return [...seen];
      });
      variants.forEach((v) => typeVariants.add(v));
      perPage.push([path, variants.length]);
    }

    // A PAGE-level budget, not a rule of taste: past ~12 the typeface has
    // stopped signalling hierarchy and started signalling noise. The union
    // across pages is a different number and a much weaker signal — a locale
    // pair shares its whole scale, so summing pages punishes nothing real.
    // Judge the worst page; report the union as context only.
    const BUDGET = 12;
    const worst = perPage.sort((a, b) => b[1] - a[1])[0] ?? ["—", 0];
    note(worst[1] > BUDGET ? "warn" : "info", "type",
      `${worst[1]} typographic variants on ${worst[0]} (budget ${BUDGET} per page; ${typeVariants.size} distinct across ${PAGES.length} pages)`,
      perPage.map(([p, n]) => `${n === worst[1] ? "→" : " "} ${String(n).padStart(3)}  ${p}`));
    note(axeTotal ? "info" : "info", "a11y", `axe-core: ${axeTotal} violation node(s) over ${PAGES.length} pages`);

    await browser.close();
  } finally {
    stop();
  }
}

// ── report ──────────────────────────────────────────────────────────────────
function report() {
  const order = { fail: 0, warn: 1, info: 2 };
  findings.sort((a, b) => order[a.level] - order[b.level]);
  const icon = { fail: "✗", warn: "!", info: "·" };

  console.log("\n── design gate ──────────────────────────────────────────────\n");
  for (const f of findings) {
    console.log(`${icon[f.level]} [${f.area}] ${f.message}`);
    if (Array.isArray(f.detail)) f.detail.forEach((d) => console.log(`      ${d}`));
    else if (f.detail) console.log(`      ${f.detail}`);
  }
  const fails = findings.filter((f) => f.level === "fail").length;
  const warns = findings.filter((f) => f.level === "warn").length;
  console.log(`\n${fails} failing · ${warns} warning(s)`);
  console.log("Automated checks catch a fraction of what matters; a clean run is not a design review.\n");

  if (STRICT && fails) process.exit(1);
}

const theme = readTheme();
staticChecks(theme);
tokenContrast(theme);
if (!SKIP_RUNTIME) await runtimeChecks();
report();
