#!/usr/bin/env node
/**
 * Type snapshot — a before/after witness for typography refactors.
 *
 * Renames a size in the markup and you have changed nothing visible, or you
 * have changed everything: from the source alone there is no way to tell. This
 * walks the built pages, records the computed font of every leaf text node, and
 * writes a stable digest. Run it before the edit, run it after, diff the two.
 *
 * Usage:  node scripts/type-snapshot.mjs <out.json>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, extname } from "node:path";
import { createServer } from "node:http";

const ROOT = new URL("..", import.meta.url).pathname;
const OUT = process.argv[2] || "type-snapshot.json";
const PORT = 4398;
const PAGES = ["/", "/ua/", "/connect/", "/ua/connect/", "/scenario-map/", "/ua/scenario-map/", "/about/", "/writing/", "/privacy/"];

const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json",
               ".svg": "image/svg+xml", ".woff2": "font/woff2", ".png": "image/png", ".jpg": "image/jpeg",
               ".webp": "image/webp", ".xml": "application/xml", ".txt": "text/plain", ".ico": "image/x-icon" };

const server = createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  const candidate = url.endsWith("/") ? join(ROOT, "dist", url, "index.html") : join(ROOT, "dist", url);
  try {
    res.writeHead(200, { "content-type": MIME[extname(candidate)] || "application/octet-stream" });
    res.end(readFileSync(candidate));
  } catch {
    res.writeHead(404).end("not found");
  }
});
await new Promise((r) => server.listen(PORT, r));

const { chromium } = await import("playwright");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

const snapshot = {};
for (const path of PAGES) {
  const res = await page.goto(`http://localhost:${PORT}${path}`, { waitUntil: "load" }).catch(() => null);
  if (!res?.ok()) { snapshot[path] = "UNREACHABLE"; continue; }
  snapshot[path] = await page.evaluate(() => {
    const rows = [];
    document.querySelectorAll("body *").forEach((n) => {
      if (n.children.length || !n.textContent?.trim()) return;
      const cs = getComputedStyle(n);
      rows.push([
        n.textContent.trim().slice(0, 40),
        Math.round(parseFloat(cs.fontSize) * 100) / 100,
        cs.fontWeight,
        cs.fontFamily.split(",")[0].replace(/"/g, ""),
        cs.letterSpacing,
        cs.lineHeight,
      ].join("|"));
    });
    return rows.sort();
  });
}

await browser.close();
server.close();
writeFileSync(OUT.startsWith("/") ? OUT : join(ROOT, OUT), JSON.stringify(snapshot, null, 1));
console.log(`wrote ${OUT}: ${Object.values(snapshot).reduce((a, b) => a + (Array.isArray(b) ? b.length : 0), 0)} text nodes over ${PAGES.length} pages`);
