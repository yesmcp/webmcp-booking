import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

// Shared frontmatter schema for both language versions of an article.
const articleSchema = z.object({
  title: z.string(),
  description: z.string(),
  /** og:title — the social headline, which is longer than the <title> tag. */
  ogTitle: z.string(),
  ogDescription: z.string(),
  /** Schema.org headline; matches the on-page <h1>. */
  headline: z.string(),
  /** Longer description used in the BlogPosting JSON-LD. */
  schemaDescription: z.string(),
  date: z.string(),
  dateModified: z.string(),
  /** The provenance line under the byline, e.g. "verified against npm". */
  provenance: z.string(),
  ogImage: z.string(),
  /** The lede paragraph, rendered above the body and reused on /writing/. */
  lede: z.string(),
  /** The listing blurb from the old front page's Writing section. */
  blurb: z.string(),
  /** Pre-strategy technical notes; listed under a muted "Engineering notes" section on /writing/. */
  engineeringNote: z.boolean().default(false),
});

// The article ids are the URL slugs of the previously deployed static site and
// MUST NOT change: /writing/<id>/ is live, indexed and linked from llms.txt.
const writing = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/writing" }),
  schema: articleSchema,
});

// Ukrainian versions of articles. Same schema, base writing-ua; an article's id
// (file name) MUST equal its English twin's id — that identity is what builds
// the /writing/<id>/ ↔ /ua/writing/<id>/ hreflang pair automatically.
const writingUa = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/writing-ua" }),
  schema: articleSchema,
});

// Directory-census snapshots (Program A / the evergreen data layer).
// One JSON per count: src/content/census/<ecosystem>-<YYYY-MM-DD>.json.
// The id enum is deliberately strict: a taxonomy change on the platform must
// FAIL the build here (board ruling 2026-08-24), never render a broken table.
export const CENSUS_CATEGORY_IDS = [
  "productivity",
  "data",
  "sales-marketing",
  "code",
  "financial-services",
  "communication",
  "design",
  "legal",
  "life-sciences",
  "health",
] as const;

const census = defineCollection({
  loader: glob({ pattern: "**/*.json", base: "./src/content/census" }),
  schema: z
    .object({
      ecosystem: z.enum(["claude", "chatgpt"]),
      counted_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      /** Total distinct connectors/apps; categories overlap, so sums exceed it. */
      total: z.number().int().positive(),
      categories: z.array(
        z.object({
          id: z.enum(CENSUS_CATEGORY_IDS),
          count: z.number().int().nonnegative(),
        })
      ),
      /** How the count was taken — published verbatim as provenance. */
      method: z.string(),
    })
    .refine((s) => s.categories.length > 0, { message: "empty categories" })
    .refine((s) => s.categories.reduce((a, c) => a + c.count, 0) >= s.total * 0.5, {
      message: "category sum implausibly low vs total — partial crawl?",
    }),
});

export const collections = { writing, writingUa, census };
