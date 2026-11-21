/**
 * Static export (ADR 0001 d9): the published site as plain files that any
 * host can serve. Nothing here runs when a visitor arrives.
 */
import { mkdir, readdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  type Block,
  categoriesOf,
  type ContentType,
  contentTypes,
  entryPath,
  feedPath,
  mediaSources,
  mediaKindOf,
  mediaNameOf,
  type MediaSize,
  mediaPath,
  listed,
  listPath,
  type MenuList,
  POSTS_TYPE,
  type Page,
  paginate,
  pagePath,
  type Post,
  type ShownComment,
  typeById,
  postExcerpt,
  postImageSources,
  typeCategoryPath,
  typeTagPath,
  type Redirect,
  redirectFile,
  redirectsFile,
  htaccessFile,
  type Site,
  type Theme,
  themeCss,
  alternates,
  pagesIn,
  fillSections,
  withAreas,
  languageOf,
} from '../core/index.ts';
import { wordsFor } from '../blocks/words.ts';
import { lockedPage } from './locks.ts';
import { menuOf, pageSetting, renderBlogList, renderPage, renderPost, STYLESHEET } from './document.ts';
import { checkRedirects, checkSeo, checkSite, describeCheck, type SiteCheck, serverOnly } from './check.ts';
import { BASE_CSS } from './shipped.ts';
import type { Store } from './store.ts';

const MARKER = '.thecms-export';
const FEED_ENTRIES = 30;

const xml = (v: string): string => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Gives a stored image's bytes by name; null when the site does not have it. */
export type MediaSource = (name: string) => Uint8Array | null | Promise<Uint8Array | null>;

/** `/blog/` → `blog/index.html`. */
const fileOf = (path: string): string => `${path.slice(1)}index.html`;

/** The newest posts as an Atom feed, for people who follow the site in a reader. */
function feed(site: Site, type: ContentType, posts: Post[]): string {
  const day = (date: string): string => `${date}T00:00:00Z`;
  const entries = posts.slice(0, FEED_ENTRIES).map((post) => {
    const url = xml(`${site.url}${entryPath(type, post.slug)}`);
    return [
      '  <entry>',
      `    <title>${xml(post.title)}</title>`,
      `    <link href="${url}"/>`,
      `    <id>${url}</id>`,
      `    <updated>${day(post.date)}</updated>`,
      `    <summary>${xml(postExcerpt(post))}</summary>`,
      ...[...post.categories, ...post.tags].map((name) => `    <category term="${xml(name)}"/>`),
      '  </entry>',
    ].join('\n');
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="${xml(site.language)}">`,
    `  <title>${xml(type.id === POSTS_TYPE ? site.name : `${site.name}: ${type.name}`)}</title>`,
    `  <id>${xml(`${site.url}${listPath(type)}`)}</id>`,
    `  <link href="${xml(`${site.url}${listPath(type)}`)}"/>`,
    `  <link rel="self" href="${xml(`${site.url}${feedPath(type)}`)}"/>`,
    `  <updated>${day(posts[0]?.date ?? '1970-01-01')}</updated>`,
    `  <author><name>${xml(site.name)}</name></author>`,
    ...entries,
    '</feed>',
    '',
  ].join('\n');
}

/** What marks a page behind a password, for the runtime: its content is the page's address in the main language. */
export const LOCK_META = 'thecms-locked';

/** The page behind a password a built file is, or null. */
export const lockOf = (html: string): string | null => {
  const found = new RegExp(`<meta name="${LOCK_META}" content="([^"]*)">`).exec(html);
  return found ? (found[1] as string).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>') : null;
};

/**
 * The whole site as `path → contents`, without touching the disk. Of the
 * stored images, only those something published shows are included.
 */
export async function buildSite(
  site: Site,
  theme: Theme,
  pages: Page[],
  media: MediaSource = () => null,
  /** Published entries: the posts alone, or every type's by the type's name. */
  entries: Post[] | Record<string, Post[]> = [],
  redirects: Redirect[] = [],
  /** Each type's own page (ADR 0015), by the type's name; a type without one uses the default page. */
  templates: Record<string, Block[] | null> = {},
  /** Published sections (ADR 0033): drawn where a page shows them, in the page's language. */
  sections: Page[] = [],
  /** The stored pictures' sizes and smaller copies (ADR 0005 d8): each picture is offered at the size that fits. */
  images: Record<string, MediaSize> = {},
  /** The approved comments (ADR 0040), by `type/entry`: shown under the entries of a type that takes them. */
  comments: Record<string, ShownComment[]> = {},
  /** The pages behind a password (ADR 0043): each address, with the page it belongs to. */
  locked: Record<string, string> = {},
): Promise<Map<string, string | Uint8Array>> {
  const files = new Map<string, string | Uint8Array>();
  site = { ...site, pictures: { sizes: images, widths: theme.tokens.width } };
  // Each section block holds its section's blocks from here on, so the pages, their pictures and their links include them.
  pages = pages.map((p) => ({ ...p, blocks: fillSections(p.blocks, sections, languageOf(site, p.slug)) }));
  const filledEntries = Object.fromEntries(Object.entries(Array.isArray(entries) ? { [POSTS_TYPE]: entries } : entries).map(([id, list]) => [id, list.map((post) => ({ ...post, blocks: fillSections(post.blocks, sections, site.language), ...(typeById(site, id)?.comments ? { comments: comments[`${id}/${post.slug}`] ?? [] } : {}) }))]));
  templates = Object.fromEntries(Object.entries(templates).map(([id, blocks]) => [id, blocks && fillSections(blocks, sections, site.language)]));
  const byType = filledEntries;
  const types = contentTypes(site)
    .map((type) => ({ type, posts: listed(type, byType[type.id] ?? []) }))
    .filter((t) => t.posts.length > 0);
  const posts = types.flatMap((t) => t.posts);
  // A type with nothing published has no list, and so no place in the menu.
  const lists = types.map(({ type }): MenuList => ({ id: type.id, title: type.name, href: listPath(type) }));
  // Posts and entries are in the main language (ADR 0024): their menu is its menu, and the switcher leads to each language's home.
  const menu = menuOf(site, pagesIn(site, site.language, pages), lists);
  const homes = alternates(site, null, pages);
  /** Every address a visitor can open, for the sitemap. */
  const paths: string[] = [];
  const page = (path: string, html: string, hidden = false): void => {
    files.set(fileOf(path), html);
    // A page hidden from search engines is not in the sitemap (ADR 0050 d3).
    if (!hidden) paths.push(path);
  };

  // The structure first, the theme after it: where both set the same thing, the theme wins.
  files.set(STYLESHEET.slice(1), `${BASE_CSS}${themeCss(theme)}`);
  // What a block that lists entries shows: only what is published.
  const listable = Object.fromEntries(types.map(({ type, posts: own }) => [type.id, { type, entries: own }]));
  for (const p of pages) {
    const setting = pageSetting(site, p.slug, pages, lists);
    page(pagePath(p.slug), renderPage(withAreas(setting.site, sections, setting.site.language), theme, p, setting.menu, listable, setting.alternates), p.noindex);
  }
  // A page behind a password says so to the runtime, which asks for it; search engines are asked to keep none of it.
  for (const [path, slug] of Object.entries(locked)) {
    const html = files.get(fileOf(path));
    if (typeof html !== 'string') continue;
    files.set(fileOf(path), html.replace('<head>', `<head>\n<meta name="robots" content="noindex">\n<meta name="${LOCK_META}" content="${xml(slug)}">`));
    if (paths.includes(path)) paths.splice(paths.indexOf(path), 1);
  }
  // Entries and their lists are in the main language, and so is what their layouts show (ADR 0035).
  const framed = withAreas(site, sections, site.language);

  for (const { type, posts: own } of types) {
    for (const post of own) page(entryPath(type, post.slug), renderPost(framed, theme, post, menu, type, listable, templates[type.id] ?? null, homes), post.noindex);
    const lists = [
      { heading: type.name, path: (n: number) => listPath(type, n), posts: own },
      ...categoriesOf(own).map((c) => ({ heading: c.name, path: (n: number) => typeCategoryPath(type, c.name, n), posts: c.posts })),
      ...categoriesOf(own, 'tags').map((c) => ({ heading: `#${c.name}`, path: (n: number) => typeTagPath(type, c.name, n), posts: c.posts })),
    ];
    for (const list of lists) {
      const cut = paginate(list.posts);
      cut.forEach((some, i) => {
        const path = list.path(i + 1);
        page(path, renderBlogList(framed, { heading: list.heading, path, posts: some, newer: i > 0 ? list.path(i) : '', older: i < cut.length - 1 ? list.path(i + 2) : '' }, menu, type, homes));
      });
    }
    // A feed names every entry by its full address, so it needs the site's own.
    if (site.url && type.feed) files.set(feedPath(type).slice(1), feed(site, type, own));
  }

  const shown: [string, string][] = [
    ...pages.flatMap((p) => [...mediaSources(p.blocks), ...(p.shareImage ? [p.shareImage.src] : [])].map((src): [string, string] => [`the page "${p.title}"`, src])),
    ...posts.flatMap((p) => postImageSources(p).map((src): [string, string] => [`the entry "${p.title}"`, src])),
    ...types.flatMap(({ type }) => mediaSources(templates[type.id] ?? []).map((src): [string, string] => [`the page of "${type.name}"`, src])),
  ];
  for (const [name, blocks] of Object.entries(framed.areas ?? {})) for (const src of mediaSources(blocks)) shown.push([`the section "${name}" of a layout`, src]);
  if (site.logo) shown.push(['the header', site.logo.src]);
  if (site.shareImage) shown.push(['the picture for sharing, in Site settings', site.shareImage.src]);
  for (const [where, src] of shown) {
    const name = mediaNameOf(src);
    if (!name || files.has(src.slice(1))) continue;
    const bytes = await media(name);
    // A site that would show a broken picture, or link to a missing file, is not published quietly.
    if (!bytes) throw new Error(`${where} ${mediaKindOf(name) === 'image' ? 'shows an image' : 'links to a file'} this site does not have: ${src}`);
    files.set(src.slice(1), bytes);
    // Its smaller copies go with it, for the srcset that names them.
    for (const variant of images[name]?.variants ?? []) {
      const copy = await media(variant);
      if (copy) files.set(mediaPath(variant).slice(1), copy);
    }
  }

  // An old address is kept only where nothing lives now and what it leads to is published.
  const written: Redirect[] = [];
  for (const { from, to } of redirects) {
    const file = redirectFile(from);
    if (files.has(file) || !paths.includes(to.split('#')[0] as string)) continue;
    written.push({ from, to });
    const href = xml(to);
    files.set(
      file,
      `<!doctype html><html lang="${xml(site.language)}"><head><meta charset="utf-8"><title>${xml(site.name)}</title>` +
        `<link rel="canonical" href="${xml(site.url)}${href}"><meta name="robots" content="noindex"><meta http-equiv="refresh" content="0; url=${href}"></head>` +
        `<body><p><a href="${href}">${xml(site.name)}</a></p></body></html>\n`,
    );
  }

  // A host that reads a list of redirects answers with a real 301; any other serves the small pages above (ADR 0036).
  if (written.length) {
    files.set('_redirects', redirectsFile(written));
    files.set('.htaccess', htaccessFile(written));
  }
  files.set(
    '404.html',
    renderPage(framed, theme, { slug: '404', title: wordsFor(site.language).notFound, description: '', inMenu: false, blocks: [] }, menu),
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
export async function exportSite(store: Store, outDir: string, warn: (line: string) => void = () => {}): Promise<string[]> {
  const files = await publishedSite(store);
  // A link that would lead nowhere is not published quietly either (ADR 0029).
  const { problems, warnings } = describeCheck(await fullCheck(store, files));
  if (problems.length) throw new Error(`Nothing was exported. A link leads to an address the site does not have:\n${problems.map((p) => `  ${p}`).join('\n')}`);
  for (const line of warnings) warn(line);
  // A page behind a password is not written out: a static host cannot ask for it (ADR 0043).
  const frame = String(files.get('404.html'));
  for (const [path, contents] of files) if (typeof contents === 'string' && lockOf(contents) !== null) files.set(path, lockedPage(frame, null));

  const existing = await readdir(outDir).catch(() => [] as string[]);
  if (existing.length > 0 && !existing.includes(MARKER)) {
    throw new Error(`${outDir} is not empty and was not made by an export; choose another folder`);
  }
  await rm(outDir, { recursive: true, force: true });

  files.set(MARKER, 'Made by thecms export. This folder is replaced on every export.\n');
  for (const [path, contents] of files) {
    const target = join(outDir, path);
    await mkdir(dirname(target), { recursive: true });
    await Bun.write(target, contents);
  }
  return [...files.keys()].sort();
}

/** What is wrong with the built site, and what of it only its own server answers (ADR 0029, ADR 0044). */
export async function fullCheck(store: Store, files: Map<string, string | Uint8Array>): Promise<SiteCheck> {
  const routes = (await store.extensions()).some((e) => e.enabled && e.manifest.routes.length > 0);
  return {
    ...checkSite(files),
    untranslated: await store.untranslated(),
    redirects: checkRedirects(files, await store.redirects()),
    server: serverOnly(files, { formsElsewhere: (await store.site()).forms !== '', routes }),
    seo: checkSeo(files),
  };
}

/**
 * The published site as the files an export writes, in memory: what is checked
 * before anything is written. `served`: for the runtime, which reads documents,
 * sound and video from the library as they are asked for, so they are only
 * checked to be there and stand in the map empty (ADR 0046).
 */
export async function publishedSite(store: Store, served = false): Promise<Map<string, string | Uint8Array>> {
  const theme = await store.publishedTheme();
  if (!theme) throw new Error('the theme is not published yet');
  const pages = await store.published();
  if (pages.length === 0) throw new Error('nothing is published yet');
  if (!pages.some((p) => p.slug === '')) throw new Error('the home page is not published');
  // Each form block is drawn with the form it names (ADR 0049).
  const site = { ...(await store.site()), formDefs: await store.formsByName() };
  const entries: Record<string, Post[]> = {};
  const templates: Record<string, Block[] | null> = {};
  for (const type of contentTypes(site)) {
    entries[type.id] = await store.publishedEntries(type.id);
    templates[type.id] = await store.publishedTemplate(type.id);
  }
  const locks = new Set(await store.lockedPages());
  const locked = Object.fromEntries(pages.filter((p) => locks.has(p.of)).map((p) => [pagePath(p.slug), p.of]));
  const media: MediaSource = async (name) =>
    served && mediaKindOf(name) !== 'image' ? ((await store.hasMedia(name)) ? new Uint8Array(0) : null) : ((await store.mediaFile(name))?.bytes ?? null);
  return buildSite(site, theme, pages, media, entries, await store.redirects(), templates, await store.publishedSections(), await store.mediaSizes(), await store.shownComments(), locked);
}
