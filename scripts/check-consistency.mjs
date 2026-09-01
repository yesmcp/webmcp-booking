// Cross-surface truth gate. Born 2026-08-30 after the board review of the
// showcase plan: the connector's tool count lived in six unlinked places and
// three of them disagreed (llms.txt said 5, privacy said 10 with a stale
// "other five" sentence, the homepage fallback said 9). A claim that lives on
// several surfaces needs a machine holding them together, not discipline.
//
// Checks (each surface must carry ALL ten tool names, or none of them):
//   1. public/llms.txt         — the machine-facing inventory
//   2. src/pages/privacy.astro + ua/privacy.astro — the legal disclosure
//   3. liveFallback.tools in both homepages equals TOOLS.length
//   4. llms.txt links the open dataset
//   5. no "other five tools" era arithmetic anywhere in pages
//
// Exit 1 on any failure; wired into predeploy. Update TOOLS when the
// connector's tool set changes — every gated surface then fails loudly
// until it tells the same story.

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(resolve(root, p), "utf8");

const TOOLS = [
  "list_availability",
  "book_consult",
  "cancel_booking",
  "reschedule_booking",
  "get_services",
  "advise_scenarios",
  "demo_walkthrough",
  "directory_census",
  "booking_widget",
  "services_widget",
];

const failures = [];

const mustCarryAllTools = {
  "public/llms.txt": read("public/llms.txt"),
  "src/pages/privacy.astro": read("src/pages/privacy.astro"),
  "src/pages/ua/privacy.astro": read("src/pages/ua/privacy.astro"),
};
for (const [file, text] of Object.entries(mustCarryAllTools)) {
  const missing = TOOLS.filter((t) => !text.includes(t));
  if (missing.length)
    failures.push(`${file}: missing tool name(s): ${missing.join(", ")}`);
}

for (const file of ["src/pages/index.astro", "src/pages/ua/index.astro"]) {
  const m = read(file).match(/tools:\s*(\d+)/);
  if (!m) failures.push(`${file}: liveFallback.tools not found`);
  else if (Number(m[1]) !== TOOLS.length)
    failures.push(
      `${file}: liveFallback.tools = ${m[1]}, expected ${TOOLS.length}`
    );
}

if (!mustCarryAllTools["public/llms.txt"].includes("/data/directory.json"))
  failures.push("public/llms.txt: open dataset link /data/directory.json missing");

for (const file of [
  "public/llms.txt",
  "src/pages/privacy.astro",
  "src/pages/ua/privacy.astro",
]) {
  if (/other five tools|Решта п'ять інструментів/i.test(mustCarryAllTools[file] ?? read(file)))
    failures.push(`${file}: stale "other five tools" era phrasing`);
}

if (failures.length) {
  console.error("✗ consistency gate failed:");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log(
  `✓ consistency gate: ${TOOLS.length} tool names aligned across llms.txt, privacy (en+ua), homepage fallbacks`
);
