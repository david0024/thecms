/**
 * A page an extension's route answers with (ADR 0062 d6): `{ title, blocks }`,
 * drawn in the site's layout, header and footer, in the visitor's language.
 * Its blocks are cleaned as any block is; it is not kept, and search engines
 * are asked not to list it.
 */
import { normalizeBlocks, type Site, siteIn, str, type Theme } from '../core/index.ts';
import { renderParts } from './document.ts';

const escape = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * The page, in `frame`: one of the site's built pages in the visitor's
 * language (its 404 page), whose `<main>` is replaced by the blocks.
 */
export function routePage(frame: string, site: Site, theme: Theme, page: { title: unknown; blocks: unknown }): string {
  const language = /<html lang="([^"]+)"/.exec(frame)?.[1] ?? site.language;
  const title = str(page.title, 200).replace(/\s+/g, ' ').trim();
  const { blocks } = normalizeBlocks(page.blocks);
  const local = siteIn(site, language);
  const { body, css } = renderParts(local, theme, { slug: '_', title, description: '', inMenu: false, blocks }, []);
  const main = /<main[^>]*>([\s\S]*)<\/main>/.exec(body)?.[1] ?? '';
  const heading = title ? `<section class="b b-text"><div class="b-in"><h1>${escape(title)}</h1></div></section>` : '';
  return frame
    .replace(/<title>[^<]*?(( · [^<]*)?)<\/title>/, (_whole, rest: string) => `<title>${escape(title || local.name)}${title ? rest : ''}</title>`)
    .replace(/<meta property="og:title" content="[^"]*">/, () => `<meta property="og:title" content="${escape(title || local.name)}">`)
    .replace('</head>', () => `<meta name="robots" content="noindex">\n${css ? `<style>${css}</style>\n` : ''}</head>`)
    .replace(/<main([^>]*)>[\s\S]*?<\/main>/, (_whole, attrs: string) => `<main${attrs}>${heading}${main}</main>`);
}
