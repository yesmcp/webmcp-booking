#!/usr/bin/env bun
/**
 * Sync the connector's H4 diagnostic content into the site.
 *
 * The connector repo (yesmcp-connector) owns every customer-visible English
 * sentence in the scenario map: `content/diagnostic.yaml` (the two intake
 * questions + the feasibility verdicts) and `content/playbooks/*.md` (the two
 * shelves per vertical). This script copies them, verbatim, into
 * `src/data/diagnostic.json`, which IS committed — the site builds without the
 * connector repo present.
 *
 * Run manually (there is no build hook, on purpose: a build must never depend
 * on a sibling checkout):
 *
 *     bun scripts/sync-diagnostic.mjs
 *     CONNECTOR_CONTENT_DIR=/path/to/yesmcp-connector/content bun scripts/sync-diagnostic.mjs
 *
 * Fail-hard everywhere. A half-parsed playbook would render as a half-empty
 * scenario map in front of a prospect and nobody would find out from outside.
 */

import { readdirSync, readFileSync, existsSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = resolve(HERE, "..");
const DATA_DIR = join(SITE, "src", "data");
const OUT = join(DATA_DIR, "diagnostic.json");
const UK = join(DATA_DIR, "diagnostic.uk.json");

// Mirrors content.ts in the connector — same headings, same mechanical split.
const CUSTOMERS_HEADING = "What your customers could do in the chat";
const TEAM_HEADING = "What your team could do in the chat";
const VERDICTS = new Set(["green", "yellow"]);

/**
 * Short answer codes for the Telegram deep link (`map_<vertical>_<s>_<c>`).
 * The bot's copy.ts holds the same tables — Telegram start payloads are capped
 * at 64 bytes and charset [A-Za-z0-9_-], so full option keys cannot travel.
 * A yaml option without a code here fails the sync: an uncoded answer would
 * silently fall out of the deep link.
 */
const ANSWER_CODES = {
  systems: {
    saas_with_api: "s1",
    spreadsheets_calendars: "s2",
    custom_software: "s3",
    mostly_offline: "s4",
  },
  customer_channel: {
    phone_messengers: "c1",
    website_forms: "c2",
    walk_in: "c3",
    mixed: "c4",
  },
};

function die(message) {
  console.error(`sync-diagnostic: ${message}`);
  process.exit(1);
}

function contentDir() {
  const fromEnv = process.env.CONNECTOR_CONTENT_DIR;
  const dir = fromEnv ? resolve(fromEnv) : resolve(HERE, "..", "..", "..", "yesmcp-connector", "content");
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    die(
      `connector content directory not found: ${dir}\n` +
        `  The scenario map is copied from the yesmcp-connector repo. Clone it next to\n` +
        `  this one, or point CONNECTOR_CONTENT_DIR at its content/ directory:\n` +
        `      CONNECTOR_CONTENT_DIR=/path/to/yesmcp-connector/content bun scripts/sync-diagnostic.mjs`,
    );
  }
  return dir;
}

/** `---\n<yaml>\n---\n<body>` → { frontmatter, body }. */
function splitFrontmatter(raw, ref) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!match) die(`${ref}: no YAML frontmatter block (expected the file to start with '---')`);
  let frontmatter;
  try {
    frontmatter = Bun.YAML.parse(match[1]);
  } catch (err) {
    die(`${ref}: frontmatter is not valid YAML: ${err instanceof Error ? err.message : String(err)}`);
  }
  const body = match[2].trim();
  if (!body) die(`${ref}: the body below the frontmatter is empty`);
  return { frontmatter, body };
}

/** `## X` → the raw text under it, in file order. */
function splitSections(body) {
  const sections = new Map();
  let heading = null;
  let buffer = [];
  const flush = () => {
    if (heading !== null) sections.set(heading, buffer.join("\n").trim());
    buffer = [];
  };
  for (const line of body.split(/\r?\n/)) {
    const match = /^##\s+(.*\S)\s*$/.exec(line);
    if (match) {
      flush();
      heading = match[1];
      continue;
    }
    buffer.push(line);
  }
  flush();
  return sections;
}

/**
 * The `- ` items of one section, continuation lines rejoined with a space.
 * Markdown syntax is left alone (bold markers stay) — only the list marker and
 * the author's 80-column soft wrap are removed. The lead paragraph the team
 * sections open with starts no item of its own and is dropped.
 */
function listItems(section) {
  const items = [];
  for (const line of section.split(/\r?\n/)) {
    const bullet = /^\s*-\s+(.*)$/.exec(line);
    if (bullet) {
      items.push(bullet[1].trim());
      continue;
    }
    const text = line.trim();
    if (!text) continue;
    if (items.length > 0) items[items.length - 1] += ` ${text}`;
  }
  return items.map((i) => i.trim()).filter((i) => i.length > 0);
}

function readDiagnostic(dir) {
  const ref = "diagnostic.yaml";
  const path = join(dir, ref);
  if (!existsSync(path)) die(`${ref}: not found in ${dir}`);
  let doc;
  try {
    doc = Bun.YAML.parse(readFileSync(path, "utf8"));
  } catch (err) {
    die(`${ref}: not valid YAML: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (doc?.draft === true) {
    if (process.env.SYNC_ALLOW_DRAFT === "1") {
      console.error(`sync-diagnostic: WARNING — ${ref} is draft: true; syncing anyway (SYNC_ALLOW_DRAFT=1, preview only, do NOT deploy)`);
    } else {
      die(`${ref}: draft: true — the owner has not signed this copy off yet`);
    }
  }
  if (!Array.isArray(doc?.questions) || doc.questions.length === 0) die(`${ref}: no questions`);
  for (const q of doc.questions) {
    if (!q?.id || !q?.ask) die(`${ref}: a question is missing 'id' or 'ask'`);
    if (!q.options || Object.keys(q.options).length === 0) die(`${ref}: question '${q.id}' has no options`);
  }
  if (!doc?.feasibility || Object.keys(doc.feasibility).length === 0) die(`${ref}: no feasibility block`);
  for (const [key, value] of Object.entries(doc.feasibility)) {
    if (!VERDICTS.has(value?.verdict)) {
      die(`${ref}: feasibility '${key}' has unknown verdict '${value?.verdict}' (expected green|yellow)`);
    }
    if (!value?.note) die(`${ref}: feasibility '${key}' has no note`);
  }

  // The feasibility keys must be exactly the option keys of the `systems`
  // question: the page derives the verdict from that answer alone.
  const systems = doc.questions.find((q) => q.id === "systems");
  if (!systems) die(`${ref}: no question with id 'systems' — the page derives feasibility from it`);
  const optionKeys = Object.keys(systems.options).sort();
  const feasKeys = Object.keys(doc.feasibility).sort();
  if (optionKeys.join("|") !== feasKeys.join("|")) {
    die(
      `${ref}: feasibility keys ${feasKeys.join(", ")} do not match the 'systems' options ${optionKeys.join(", ")}`,
    );
  }

  // Same agreement for the channel notes and their question.
  if (!doc?.channel_notes || Object.keys(doc.channel_notes).length === 0) die(`${ref}: no channel_notes block`);
  for (const [key, note] of Object.entries(doc.channel_notes)) {
    if (typeof note !== "string" || !note.trim()) die(`${ref}: channel note '${key}' is empty`);
  }
  const channel = doc.questions.find((q) => q.id === "customer_channel");
  if (!channel) die(`${ref}: no question with id 'customer_channel' — the channel notes derive from it`);
  const channelKeys = Object.keys(channel.options).sort();
  const noteKeys = Object.keys(doc.channel_notes).sort();
  if (channelKeys.join("|") !== noteKeys.join("|")) {
    die(
      `${ref}: channel_notes keys ${noteKeys.join(", ")} do not match the 'customer_channel' options ${channelKeys.join(", ")}`,
    );
  }

  // Every option must have a deep-link code, or an answer silently falls out
  // of the Telegram CTA.
  for (const [qid, table] of Object.entries(ANSWER_CODES)) {
    const q = doc.questions.find((x) => x.id === qid);
    if (!q) die(`${ref}: no question with id '${qid}' for the deep-link code table`);
    for (const key of Object.keys(q.options)) {
      if (!table[key]) die(`${ref}: option '${qid}.${key}' has no deep-link code in ANSWER_CODES`);
    }
  }

  return {
    questions: doc.questions.map((q) => ({ id: q.id, ask: q.ask, options: q.options })),
    feasibility: doc.feasibility,
    channelNotes: doc.channel_notes,
    codes: ANSWER_CODES,
  };
}

function readPlaybooks(dir) {
  const playbooksDir = join(dir, "playbooks");
  if (!existsSync(playbooksDir)) die(`playbooks/: not found in ${dir}`);
  const files = readdirSync(playbooksDir)
    .filter((f) => f.endsWith(".md"))
    .sort(); // filename alphabetical order is the page order
  if (files.length === 0) die(`playbooks/: no .md files in ${playbooksDir}`);

  return files.map((file) => {
    const ref = `playbooks/${file}`;
    const { frontmatter, body } = splitFrontmatter(readFileSync(join(playbooksDir, file), "utf8"), ref);
    if (frontmatter?.draft === true) die(`${ref}: draft: true — the owner has not signed this copy off yet`);
    if (!frontmatter?.vertical) die(`${ref}: frontmatter has no 'vertical'`);
    if (!frontmatter?.title) die(`${ref}: frontmatter has no 'title'`);

    const sections = splitSections(body);
    const shelf = (heading) => {
      const section = sections.get(heading);
      if (section === undefined) die(`${ref}: missing the '## ${heading}' section`);
      const items = listItems(section);
      if (items.length === 0) die(`${ref}: '## ${heading}' has no list items`);
      return items;
    };

    return {
      id: frontmatter.vertical,
      title: frontmatter.title,
      customers: shelf(CUSTOMERS_HEADING),
      team: shelf(TEAM_HEADING),
    };
  });
}

/**
 * Structural parity with the hand-authored Ukrainian file: every vertical id,
 * the same bullet count per shelf, every question / option / feasibility key.
 * A missing key means the /ua/ page would silently render an English string.
 */
function checkParity(en) {
  if (!existsSync(UK)) {
    die(
      `${UK} does not exist.\n` +
        `  ${OUT} was written, but the Ukrainian page needs a hand-authored translation\n` +
        `  file with the same structural keys. Create it, then re-run this script.`,
    );
  }
  let uk;
  try {
    uk = JSON.parse(readFileSync(UK, "utf8"));
  } catch (err) {
    die(`${UK}: not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }

  const problems = [];

  for (const q of en.questions) {
    const ukQ = (uk.questions ?? []).find((x) => x.id === q.id);
    if (!ukQ) {
      problems.push(`questions[${q.id}]: missing`);
      continue;
    }
    if (!ukQ.ask) problems.push(`questions[${q.id}].ask: missing`);
    for (const key of Object.keys(q.options)) {
      if (!ukQ.options?.[key]) problems.push(`questions[${q.id}].options.${key}: missing`);
    }
  }

  for (const key of Object.keys(en.feasibility)) {
    const ukF = uk.feasibility?.[key];
    if (!ukF) {
      problems.push(`feasibility.${key}: missing`);
      continue;
    }
    if (!ukF.note) problems.push(`feasibility.${key}.note: missing`);
    if (ukF.verdict !== undefined && ukF.verdict !== en.feasibility[key].verdict) {
      problems.push(
        `feasibility.${key}.verdict: '${ukF.verdict}' but the source says '${en.feasibility[key].verdict}'`,
      );
    }
  }

  for (const key of Object.keys(en.channelNotes)) {
    if (!uk.channelNotes?.[key]) problems.push(`channelNotes.${key}: missing`);
    else if (/[–—]/.test(uk.channelNotes[key])) {
      problems.push(`channelNotes.${key}: contains an en/em dash (brand rule: none in Ukrainian copy)`);
    }
  }

  for (const v of en.verticals) {
    const ukV = (uk.verticals ?? []).find((x) => x.id === v.id);
    if (!ukV) {
      problems.push(`verticals[${v.id}]: missing`);
      continue;
    }
    if (!ukV.title) problems.push(`verticals[${v.id}].title: missing`);
    for (const shelf of ["customers", "team"]) {
      const count = Array.isArray(ukV[shelf]) ? ukV[shelf].length : 0;
      if (count !== v[shelf].length) {
        problems.push(`verticals[${v.id}].${shelf}: ${count} bullets, source has ${v[shelf].length}`);
      }
    }
  }

  if (problems.length > 0) {
    console.error(`sync-diagnostic: ${UK} is out of parity with the source:`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }

  if (uk.draft === true) {
    console.log(`  note: ${UK} is still marked "draft": true (owner review pending).`);
  }
}

const dir = contentDir();
const { questions, feasibility, channelNotes, codes } = readDiagnostic(dir);
const verticals = readPlaybooks(dir);
const out = { questions, feasibility, channelNotes, codes, verticals };

mkdirSync(DATA_DIR, { recursive: true });
writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`, "utf8");

console.log(`sync-diagnostic: read ${dir}`);
console.log(
  `  wrote ${OUT}: ${questions.length} questions, ${Object.keys(feasibility).length} verdicts, ` +
    `${verticals.length} verticals (${verticals.reduce((n, v) => n + v.customers.length + v.team.length, 0)} bullets)`,
);

checkParity(out);
console.log(`  parity with ${UK}: ok`);
