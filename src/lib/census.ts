import { getCollection } from "astro:content";

// Shared helpers for the census dataset (Program D).
// expandDataTokens() lets article FRONTMATTER strings (description, og fields,
// blurb, lede) carry live numbers without going stale: `{{census:<eco>:<field>}}`
// is replaced from the LATEST snapshot at build time, wherever the string is
// rendered (article page, archive card, JSON-LD). Supported fields:
//   total             → "2,105" / "2 105" (locale-formatted)
//   total-connectors  → "2,105 connectors" / "2 105 конекторів" (uk agreement)
//   date              → counted_at of the latest snapshot
//   categories        → number of categories
// An unknown token or missing ecosystem FAILS the build — silent staleness is
// the failure mode this whole layer exists to kill.

export type Ecosystem = "claude" | "chatgpt";
export type Lang = "en" | "uk";

/** Ukrainian noun agreement for «конектор» after a numeral. */
export const ukConnectors = (n: number): string => {
  const d10 = n % 10,
    d100 = n % 100;
  if (d10 === 1 && d100 !== 11) return "конектор";
  if (d10 >= 2 && d10 <= 4 && (d100 < 12 || d100 > 14)) return "конектори";
  return "конекторів";
};

export const fmtTotal = (n: number, lang: Lang): string =>
  n.toLocaleString(lang === "uk" ? "uk-UA" : "en-US");

export async function censusSnapshots(ecosystem: Ecosystem) {
  return (await getCollection("census"))
    .filter((s) => s.data.ecosystem === ecosystem)
    .sort((a, b) => b.data.counted_at.localeCompare(a.data.counted_at));
}

export async function latestCensus(ecosystem: Ecosystem) {
  const snaps = await censusSnapshots(ecosystem);
  if (snaps.length === 0) throw new Error(`census: no snapshots for "${ecosystem}"`);
  return snaps[0].data;
}

const TOKEN_RE = /\{\{census:(\w+):([a-z-]+)\}\}/g;

export async function expandDataTokens(text: string, lang: Lang): Promise<string> {
  const jobs: Record<string, string> = {};
  for (const m of text.matchAll(TOKEN_RE)) {
    const [token, eco, field] = m;
    if (token in jobs) continue;
    if (eco !== "claude" && eco !== "chatgpt")
      throw new Error(`census token: unknown ecosystem in ${token}`);
    const latest = await latestCensus(eco);
    switch (field) {
      case "total":
        jobs[token] = fmtTotal(latest.total, lang);
        break;
      case "total-connectors":
        jobs[token] =
          lang === "uk"
            ? `${fmtTotal(latest.total, "uk")} ${ukConnectors(latest.total)}`
            : `${fmtTotal(latest.total, "en")} connectors`;
        break;
      case "date":
        jobs[token] = latest.counted_at;
        break;
      case "categories":
        jobs[token] = String(latest.categories.length);
        break;
      default:
        throw new Error(`census token: unknown field in ${token}`);
    }
  }
  return text.replace(TOKEN_RE, (token) => jobs[token]);
}
