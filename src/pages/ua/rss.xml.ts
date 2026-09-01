import rss from "@astrojs/rss";
import { getCollection } from "astro:content";
import { expandDataTokens } from "../../lib/census";

// Ukrainian writing feed — mirrors ../rss.xml.ts over the writingUa collection.
export async function GET() {
  const posts = (await getCollection("writingUa")).sort((a, b) =>
    b.data.date.localeCompare(a.data.date)
  );
  return rss({
    title: "yesmcp: нотатки з живого MCP-сервера",
    description:
      "Нотатки й дані з Model Context Protocol сервера, який працює наживо, плюс щотижневий перепис каталогів конекторів у ШІ-чатах.",
    site: "https://yesmcp.com/ua/",
    items: await Promise.all(
      posts.map(async (p) => ({
        title: p.data.headline,
        link: `https://yesmcp.com/ua/writing/${p.id}/`,
        pubDate: new Date(p.data.date),
        description: await expandDataTokens(p.data.blurb, "uk"),
      }))
    ),
    customData: "<language>uk</language>",
  });
}
