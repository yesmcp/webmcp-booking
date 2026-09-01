// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import { renameSync, rmdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import tailwindcss from '@tailwindcss/vite';

/**
 * Cloudflare Pages picks the error page by walking UP from the requested path
 * looking for a literal `404.html`: "/ua/404.html" first, then "/404.html"
 * (docs: pages/configuration/serving-pages). Astro's default directory build
 * format special-cases only the ROOT 404, so `src/pages/ua/404.astro` lands at
 * `ua/404/index.html`, where Pages will never look, and a broken Ukrainian URL
 * would keep falling through to the English page (site audit, 2026-08-29).
 *
 * Flattening it here rather than in the deploy script keeps the gate honest:
 * check:design and the predeploy build see exactly the tree that ships.
 */
function flattenLocale404() {
  return {
    name: 'yesmcp:flatten-locale-404',
    hooks: {
      /** @param {{ dir: URL }} ctx */
      'astro:build:done': ({ dir }) => {
        const root = fileURLToPath(dir);
        for (const locale of ['ua']) {
          const nested = join(root, locale, '404', 'index.html');
          if (!existsSync(nested)) continue;
          renameSync(nested, join(root, locale, '404.html'));
          rmdirSync(join(root, locale, '404'));
        }
      },
    },
  };
}

// https://astro.build/config
export default defineConfig({
  site: 'https://yesmcp.com',
  integrations: [mdx(), flattenLocale404()],
  vite: {
    plugins: [tailwindcss()]
  }
});
