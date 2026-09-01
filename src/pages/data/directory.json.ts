import { getCollection } from "astro:content";

// Public, machine-readable feed of our directory-census dataset (Program A).
// Generated at build time from src/content/census/ — the same single source
// the article tables render from. Cross-origin reads are deliberate: this is
// a citation asset. CF Pages defaults (max-age=0, must-revalidate + ETag)
// keep it fresh without a custom Cache-Control (board ruling 2026-08-24).
export async function GET() {
  const snaps = await getCollection("census");
  const byEcosystem: Record<string, object[]> = {};
  for (const s of snaps) {
    (byEcosystem[s.data.ecosystem] ??= []).push({
      counted_at: s.data.counted_at,
      total: s.data.total,
      categories: s.data.categories,
      method: s.data.method,
    });
  }
  for (const list of Object.values(byEcosystem)) {
    list.sort((a: any, b: any) => b.counted_at.localeCompare(a.counted_at));
  }
  return new Response(
    JSON.stringify(
      {
        source: "https://yesmcp.com/writing/claude-connectors-for-business/",
        license: "CC BY 4.0, cite yesmcp.com",
        ecosystems: byEcosystem,
      },
      null,
      1
    ),
    { headers: { "Content-Type": "application/json; charset=utf-8" } }
  );
}
