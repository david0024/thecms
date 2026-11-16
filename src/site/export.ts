/**
 * Static export (ADR 0001 d9): the published site as plain files that any
 * host can serve. Nothing here runs when a visitor arrives.
 */
import { mkdir, readdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  blogPath,
  categoriesOf,
  categoryPath,
  FEED_PATH,
  imageSources,
  mediaNameOf,
  newestFirst,
  type Page,
  paginate,
  pagePath,
  type Post,
  postExcerpt,
  postImageSources,
  postPath,
  type Site,
  type Theme,
  themeCss,
} from '../core/index.ts';
import { wordsFor } from '../blocks/words.ts';
import { menuOf, renderBlogList, renderPage, renderPost, STYLESHEET } from './document.ts';
import type { Store } from './store.ts';

const MARKER = '.thecms-export';
const BASE_CSS = new URL('../blocks/base.css', import.meta.url);
const FEED_ENTRIES = 30;

const xml = (v: string): string => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Gives a stored image's bytes by name; null when the site does not have it. */
export type MediaSource = (name: string) => Uint8Array | null;

/** `/blog/` → `blog/index.html`. */
const fileOf = (path: string): string => `${path.slice(1)}index.html`;

/** The newest posts as an Atom feed, for people who follow the site in a reader. */
function feed(site: Site, posts: Post[]): string {
  const day = (date: string): string => `${date}T00:00:00Z`;
  const entries = posts.slice(0, FEED_ENTRIES).map((post) => {
    const url = xml(`${site.url}${postPath(post.slug)}`);
    return [
      '  <entry>',
      `    <title>${xml(post.title)}</title>`,
      `    <link href="${url}"/>`,
      `    <id>${url}</id>`,
      `    <updated>${day(post.date)}</updated>`,
      `    <summary>${xml(postExcerpt(post))}</summary>`,
      ...post.categories.map((name) => `    <category term="${xml(name)}"/>`),
      '  </entry>',
    ].join('\n');
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="${xml(site.language)}">`,
    `  <title>${xml(site.name)}</title>`,
    `  <id>${xml(`${site.url}${blogPath()}`)}</id>`,
    `  <link href="${xml(`${site.url}${blogPath()}`)}"/>`,
    `  <link rel="self" href="${xml(`${site.url}${FEED_PATH}`)}"/>`,
    `  <updated>${day(posts[0]?.date ?? '1970-01-01')}</updated>`,
    `  <author><name>${xml(site.name)}</name></author>`,
    ...entries,
    '</feed>',
    '',
  ].join('\n');
}

/**
 * The whole site as `path → contents`, without touching the disk. Of the
 * stored images, only those something published shows are included.
 */
export async function buildSite(
  site: Site,
  theme: Theme,
  pages: Page[],
  media: MediaSource = () => null,
  allPosts: Post[] = [],
): Promise<Map<string, string | Uint8Array>> {
  const files = new Map<string, string | Uint8Array>();
  const posts = newestFirst(allPosts);
  const menu = menuOf(site, pages, posts.length > 0);
  /** Every address a visitor can open, for the sitemap. */
  const paths: string[] = [];
  const page = (path: string, html: string): void => {
    files.set(fileOf(path), html);
    paths.push(path);
  };

  // The structure first, the theme after it: where both set the same thing, the theme wins.
  files.set(STYLESHEET.slice(1), `${await Bun.file(BASE_CSS).text()}${themeCss(theme)}`);
  for (const p of pages) page(pagePath(p.slug), renderPage(site, theme, p, menu));

  if (posts.length) {
    for (const post of posts) page(postPath(post.slug), renderPost(site, theme, post, menu));
    const lists = [
      { heading: site.blogTitle, path: blogPath, posts },
      ...categoriesOf(posts).map((c) => ({ heading: c.name, path: (n: number) => categoryPath(c.name, n), posts: c.posts })),
    ];
    for (const list of lists) {
      const cut = paginate(list.posts);
      cut.forEach((some, i) => {
        const path = list.path(i + 1);
        page(path, renderBlogList(site, { heading: list.heading, path, posts: some, newer: i > 0 ? list.path(i) : '', older: i < cut.length - 1 ? list.path(i + 2) : '' }, menu));
      });
    }
    // A feed names every post by its full address, so it needs the site's own.
    if (site.url) files.set(FEED_PATH.slice(1), feed(site, posts));
  }

  const shown: [string, string][] = [
    ...pages.flatMap((p) => imageSources(p.blocks).map((src): [string, string] => [`the page "${p.title}"`, src])),
    ...posts.flatMap((p) => postImageSources(p).map((src): [string, string] => [`the post "${p.title}"`, src])),
  ];
  if (site.logo) shown.push(['the header', site.logo.src]);
  for (const [where, src] of shown) {
    const name = mediaNameOf(src);
    if (!name || files.has(src.slice(1))) continue;
    const bytes = media(name);
    // A site that would show a broken picture is not published quietly.
    if (!bytes) throw new Error(`${where} shows an image this site does not have: ${src}`);
    files.set(src.slice(1), bytes);
  }

  files.set(
    '404.html',
    renderPage(site, theme, { slug: '404', title: wordsFor(site.language).notFound, description: '', inMenu: false, blocks: [] }, menu),
  );
  if (site.url) {
    const urls = paths.map((path) => `  <url><loc>${xml(`${site.url}${path}`)}</loc></url>`).join('\n');
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
  const theme = store.publishedTheme();
  if (!theme) throw new Error('the theme is not published yet');
  const pages = store.published();
  if (pages.length === 0) throw new Error('nothing is published yet');
  if (!pages.some((p) => p.slug === '')) throw new Error('the home page is not published');

  const existing = await readdir(outDir).catch(() => [] as string[]);
  if (existing.length > 0 && !existing.includes(MARKER)) {
    throw new Error(`${outDir} is not empty and was not made by an export; choose another folder`);
  }
  await rm(outDir, { recursive: true, force: true });

  const files = await buildSite(store.site(), theme, pages, (name) => store.mediaFile(name)?.bytes ?? null, store.publishedPosts());
  files.set(MARKER, 'Made by thecms export. This folder is replaced on every export.\n');
  for (const [path, contents] of files) {
    const target = join(outDir, path);
    await mkdir(dirname(target), { recursive: true });
    await Bun.write(target, contents);
  }
  return [...files.keys()].sort();
}
