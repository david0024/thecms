/**
 * One page as a complete HTML document. The same function serves the static
 * export and, later, the editor's canvas, so what the author sees while
 * editing is what a visitor gets.
 */
import { render } from 'svelte/server';
import Layout from '../blocks/Layout.svelte';
import { blocksCss, type Page, pageDescription, pagePath, type Site, type Theme } from '../core/index.ts';

const esc = (v: string): string =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface MenuItem {
  title: string;
  slug: string;
}

export const STYLESHEET = '/assets/site.css';

export function renderPage(site: Site, theme: Theme, page: Page, menu: MenuItem[]): string {
  // Svelte marks where a browser would take the page over (`<!--[-->`). Nothing
  // does here, so the marks go. Every string an author wrote is escaped by now
  // (`<` is `&lt;`), so no comment in `body` can be theirs.
  const body = render(Layout, { props: { site, page, menu } }).body.replace(/<!--(\[-?\d*|\]|)-->/g, '');
  const title = page.slug ? `${page.title} · ${site.name}` : site.name;
  const description = pageDescription(page);
  const canonical = site.url ? `${site.url}${pagePath(page.slug)}` : '';
  // Generated only from checked values (`blocksCss`); `</style` cannot occur in it.
  const own = blocksCss(page.blocks, theme);
  const head = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${esc(title)}</title>`,
    description ? `<meta name="description" content="${esc(description)}">` : '',
    canonical ? `<link rel="canonical" href="${esc(canonical)}">` : '',
    `<meta property="og:title" content="${esc(page.slug ? page.title : site.name)}">`,
    description ? `<meta property="og:description" content="${esc(description)}">` : '',
    canonical ? `<meta property="og:url" content="${esc(canonical)}">` : '',
    '<meta property="og:type" content="website">',
    `<link rel="stylesheet" href="${STYLESHEET}">`,
    own ? `<style>${own}</style>` : '',
  ].filter(Boolean);
  return `<!doctype html>\n<html lang="${esc(site.language)}">\n<head>\n${head.join('\n')}\n</head>\n<body>\n${body}\n</body>\n</html>\n`;
}
