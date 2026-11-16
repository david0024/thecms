/**
 * Static export (ADR 0001 d9): the published site as plain files that any
 * host can serve. Nothing here runs when a visitor arrives.
 */
import { mkdir, readdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { type Page, pagePath, type Site, type Theme, themeCss } from '../core/index.ts';
import { type MenuItem, renderPage, STYLESHEET } from './document.ts';
import type { Store } from './store.ts';

const MARKER = '.thecms-export';
const BASE_CSS = new URL('../blocks/base.css', import.meta.url);

const xml = (v: string): string => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The whole site as `path → contents`, without touching the disk. */
export async function buildSite(site: Site, theme: Theme, pages: Page[]): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const menu: MenuItem[] = pages.filter((p) => p.inMenu).map((p) => ({ title: p.title, slug: p.slug }));

  files.set(STYLESHEET.slice(1), `${themeCss(theme)}${await Bun.file(BASE_CSS).text()}`);
  for (const page of pages) {
    files.set(`${pagePath(page.slug).slice(1)}index.html`, renderPage(site, theme, page, menu));
  }
  files.set(
    '404.html',
    renderPage(site, theme, { slug: '404', title: 'Page not found', description: '', inMenu: false, blocks: [] }, menu),
  );
  if (site.url) {
    const urls = pages.map((p) => `  <url><loc>${xml(`${site.url}${pagePath(p.slug)}`)}</loc></url>`).join('\n');
    files.set('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
  }
  files.set('robots.txt', `User-agent: *\nAllow: /\n${site.url ? `Sitemap: ${site.url}/sitemap.xml\n` : ''}`);
  return files;
}

/**
 * Writes the published site into `outDir` and returns the paths written.
 *
 * The folder is emptied first, so it is only ever a folder this function
 * made: one that does not exist, is empty, or carries the marker of an earlier
 * export. Anything else is refused, because the alternative is deleting
 * someone's files.
 */
export async function exportSite(store: Store, outDir: string): Promise<string[]> {
  const theme = store.theme();
  if (!theme) throw new Error('this site has no theme yet');
  const pages = store.published();
  if (pages.length === 0) throw new Error('nothing is published yet');
  if (!pages.some((p) => p.slug === '')) throw new Error('the home page is not published');

  const existing = await readdir(outDir).catch(() => [] as string[]);
  if (existing.length > 0 && !existing.includes(MARKER)) {
    throw new Error(`${outDir} is not empty and was not made by an export; choose another folder`);
  }
  await rm(outDir, { recursive: true, force: true });

  const files = await buildSite(store.site(), theme, pages);
  files.set(MARKER, 'Made by thecms export. This folder is replaced on every export.\n');
  for (const [path, contents] of files) {
    const target = join(outDir, path);
    await mkdir(dirname(target), { recursive: true });
    await Bun.write(target, contents);
  }
  return [...files.keys()].sort();
}
