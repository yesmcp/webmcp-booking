/**
 * Helpers for the /scenario-map/ page.
 *
 * The shelf bullets are copied verbatim out of the connector's playbooks, so
 * they arrive as raw markdown with `**bold**` lead phrases and nothing else.
 * A ten-line converter beats pulling a markdown runtime into the bundle for
 * one syntax rule.
 */

export type Diagnostic = {
  questions: { id: string; ask: string; options: Record<string, string> }[];
  feasibility: Record<string, { verdict: "green" | "yellow"; note: string }>;
  /** One authored sentence per customer_channel option, shown in the map. */
  channelNotes: Record<string, string>;
  /** Deep-link answer codes (s1..s4 / c1..c4), mirrored in the bot's copy.ts. */
  codes: Record<string, Record<string, string>>;
  verticals: { id: string; title: string; customers: string[]; team: string[] }[];
  /** Only on the Ukrainian file: true until the owner has read the copy. */
  draft?: boolean;
};

/**
 * The imported JSON widens to a literal union with optional keys, which does
 * not overlap `Record<string, string>` for TypeScript's cast check. The files
 * are generated and parity-checked by scripts/sync-diagnostic.mjs, so the
 * structure is guaranteed there, not here.
 */
export function asDiagnostic(json: unknown): Diagnostic {
  return json as Diagnostic;
}

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };

/**
 * `**lead.** rest` → `<strong>lead.</strong> rest`, everything else escaped.
 * Deliberately handles ONLY bold: any other markdown in a playbook bullet
 * would show up as literal syntax on the page, which is a loud failure rather
 * than a silent one.
 */
export function boldToHtml(markdown: string): string {
  return markdown
    .replace(/[&<>]/g, (c) => ESCAPES[c]!)
    .replace(/\*\*(.+?)\*\*/g, '<strong class="font-600 text-ink">$1</strong>');
}

/** Telegram deep link the CTA carries, so the bot opens on the same map. */
export function botLink(verticalId?: string): string {
  // Telegram start payloads accept A-Z a-z 0-9 _ and -, so the vertical id
  // goes in unchanged and the bot can match it against the playbook filenames.
  return verticalId
    ? `https://t.me/yesmcp_bot?start=map_${verticalId}`
    : "https://t.me/yesmcp_bot?start=map";
}
