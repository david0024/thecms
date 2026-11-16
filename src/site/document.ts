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

const clean = (html: string): string => html.replace(/<!--(\[-?\d*|\]|)-->/g, '');

/**
 * A page's markup and the styles its blocks set for themselves.
 *
 * Svelte marks where a browser would take the page over (`<!--[-->`). Nothing
 * does here, so the marks go. Every string an author wrote is escaped by then
 * (`<` is `&lt;`), so no comment in the markup can be theirs.
 *
 * With `editing`, text that can be typed on the page is marked for the editor.
 */
export function renderParts(site: Site, theme: Theme, page: Page, menu: MenuItem[], editing = false): { body: string; css: string } {
  const body = clean(render(Layout, { props: { site, page, menu, editing } }).body);
  // Generated only from checked values (`blocksCss`); `</style` cannot occur in it.
  return { body, css: blocksCss(page.blocks, theme) };
}

export function renderPage(site: Site, theme: Theme, page: Page, menu: MenuItem[]): string {
  const { body, css: own } = renderParts(site, theme, page, menu);
  const title = page.slug ? `${page.title} · ${site.name}` : site.name;
  const description = pageDescription(page);
  const canonical = site.url ? `${site.url}${pagePath(page.slug)}` : '';
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
