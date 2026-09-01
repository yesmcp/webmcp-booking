import rss from "@astrojs/rss";
import { getCollection } from "astro:content";
import { expandDataTokens } from "../lib/census";

// English writing feed. Blurbs may carry {{census:...}} tokens — expanded so
// the feed stays as fresh as the dataset (same rule as the archive cards).
export async function GET() {
  const posts = (await getCollection("writing")).sort((a, b) =>
    b.data.date.localeCompare(a.data.date)
  );
  return rss({
    title: "yesmcp: notes from a production MCP server",
    description:
      "Field notes and data from a Model Context Protocol server that runs in production, plus the weekly census of the AI-chat connector directories.",
    site: "https://yesmcp.com/",
    items: await Promise.all(
      posts.map(async (p) => ({
        title: p.data.headline,
        link: `https://yesmcp.com/writing/${p.id}/`,
        pubDate: new Date(p.data.date),
        description: await expandDataTokens(p.data.blurb, "en"),
      }))
    ),
    customData: "<language>en</language>",
  });
}
