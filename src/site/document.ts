/**
 * One page as a complete HTML document. The same functions serve the static
 * export and the editor's canvas, so what the author sees while editing is
 * what a visitor gets.
 */
// The language packs are read here, so whatever draws a page has their words (ADR 0021).
import './languages.ts';
import { render } from 'svelte/server';
import BlogLayout from '../blocks/BlogLayout.svelte';
import type { EntryLists } from '../blocks/editing.ts';
import Layout from '../blocks/Layout.svelte';
import PostLayout from '../blocks/PostLayout.svelte';
import { ALTERNATES } from '../blocks/words.ts';
import {
  type Alternate,
  alternates as alternatesOf,
  type Block,
  blocksCss,
  type ContentType,
  entryPath,
  feedPath,
  type MenuLists,
  postsType,
  type MenuLink,
  type MenuPage,
  type Page,
  pageDescription,
  pagePath,
  type Post,
  postDescription,
  resolveMenu,
  type Site,
  type Theme,
  languageOf,
  pagesIn,
  siteIn,
} from '../core/index.ts';

const esc = (v: string): string =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export type MenuItem = MenuLink;

/** The menu these pages get: the one the owner arranged, or the pages in order and then the blog. */
export const menuOf = (site: Site, pages: MenuPage[], lists: MenuLists): MenuItem[] => resolveMenu(site, pages, lists);

export const STYLESHEET = '/assets/site.css';

/**
 * What a page is drawn with in its own language (ADR 0024): the site's words
 * and menu in that language, and where the page is in the others.
 */
export function pageSetting(site: Site, slug: string, pages: MenuPage[], lists: MenuLists): { site: Site; menu: MenuItem[]; alternates: Alternate[] } {
  const language = languageOf(site, slug);
  const local = siteIn(site, language);
  return { site: local, menu: menuOf(local, pagesIn(site, language, pages), language === site.language ? lists : []), alternates: alternatesOf(site, slug, pages) };
}

/** The other languages reach the header through the context of the render. */
const withAlternates = (alternates: Alternate[]) => new Map<string, unknown>([[ALTERNATES, alternates]]);

/**
 * Svelte marks where a browser would take the page over (`<!--[-->`). Nothing
 * does here, so the marks go. Every string an author wrote is escaped by then
 * (`<` is `&lt;`), so no comment in the markup can be theirs.
 */
const clean = (html: string): string => html.replace(/<!--(\[-?\d*|\]|)-->/g, '');

// Generated only from checked values (`blocksCss`); `</style` cannot occur in it.
const own = (blocks: Block[], theme: Theme): string => blocksCss(blocks, theme);

/**
 * A page's markup and the styles its blocks set for themselves. With
 * `editing`, text that can be typed on the page is marked for the editor.
 */
export function renderParts(site: Site, theme: Theme, page: Page, menu: MenuItem[], editing = false, lists: EntryLists = {}, alternates: Alternate[] = []): { body: string; css: string } {
  return { body: clean(render(Layout, { props: { site, page, menu, editing, lists }, context: withAlternates(alternates) }).body), css: own(page.blocks, theme) };
}

/** The same for an entry of a content type; a blog post when no type is named. */
export function renderPostParts(
  site: Site,
  theme: Theme,
  post: Post,
  menu: MenuItem[],
  editing = false,
  type: ContentType = postsType(),
  lists: EntryLists = {},
  /** The type's own page (ADR 0015); null draws the default one. */
  template: Block[] | null = null,
  /** The editor is changing the type's page, with this entry as the example. */
  designing = false,
  alternates: Alternate[] = [],
): { body: string; css: string } {
  return {
    body: clean(render(PostLayout, { props: { site, post, menu, editing, type, lists, template, designing }, context: withAlternates(alternates) }).body),
    css: own([...(template ?? []), ...post.blocks], theme),
  };
}

interface Head {
  /** What the browser's tab says. */
  title: string;
  /** What a link preview says: the page's own title, without the site's name. */
  shareTitle: string;
  description: string;
  path: string;
  type: 'website' | 'article';
  /** A picture for link previews: an address on this site or elsewhere. */
  image?: string;
  /** The feed to point a reader at, when this part of the site has one. */
  feed?: string;
  /** The same page in the site's other languages. */
  alternates?: Alternate[];
  /** What the page is, said for search engines as schema.org data (ADR 0030). */
  data?: Record<string, unknown>[];
}

/** The business behind the site, as schema.org names it: who publishes every page. */
const organization = (site: Site): Record<string, unknown> => ({
  '@type': 'Organization',
  '@id': `${site.url}/#organization`,
  name: site.name,
  url: `${site.url}/`,
  ...(site.logo ? { logo: absolute(site, site.logo.src) } : {}),
});
const absolute = (site: Site, src: string): string => (src.startsWith('/') ? `${site.url}${src}` : src);

/**
 * Data for search engines, in the head (ADR 0030): JSON, never run. `<` is
 * written as `\u003c` so nothing in a title can close the script element.
 */
function structured(site: Site, data: Record<string, unknown>[] | undefined): string {
  if (!site.url || !data?.length) return '';
  const json = JSON.stringify({ '@context': 'https://schema.org', '@graph': data }).replace(/</g, '\\u003c');
  return `<script type="application/ld+json">${json}</script>`;
}

function documentHtml(site: Site, head: Head, body: string, css: string): string {
  const canonical = site.url ? `${site.url}${head.path}` : '';
  const image = head.image ? (head.image.startsWith('/') ? (site.url ? `${site.url}${head.image}` : '') : head.image) : '';
  const lines = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${esc(head.title)}</title>`,
    head.description ? `<meta name="description" content="${esc(head.description)}">` : '',
    canonical ? `<link rel="canonical" href="${esc(canonical)}">` : '',
    `<meta property="og:title" content="${esc(head.shareTitle)}">`,
    head.description ? `<meta property="og:description" content="${esc(head.description)}">` : '',
    canonical ? `<meta property="og:url" content="${esc(canonical)}">` : '',
    `<meta property="og:type" content="${head.type}">`,
    image ? `<meta property="og:image" content="${esc(image)}">` : '',
    head.feed ? `<link rel="alternate" type="application/atom+xml" title="${esc(site.name)}" href="${head.feed}">` : '',
    // Search engines are told where each language's page is; only with the site's address, as they want it whole.
    ...(site.url ? (head.alternates ?? []).map((a) => `<link rel="alternate" hreflang="${esc(a.language)}" href="${esc(`${site.url}${a.href}`)}">`) : []),
    `<link rel="stylesheet" href="${STYLESHEET}">`,
    css ? `<style>${css}</style>` : '',
    structured(site, head.data),
  ].filter(Boolean);
  return `<!doctype html>\n<html lang="${esc(site.language)}">\n<head>\n${lines.join('\n')}\n</head>\n<body>\n${body}\n</body>\n</html>\n`;
}

export function renderPage(site: Site, theme: Theme, page: Page, menu: MenuItem[], lists: EntryLists = {}, alternates: Alternate[] = []): string {
  const { body, css } = renderParts(site, theme, page, menu, false, lists, alternates);
  return documentHtml(
    site,
    {
      title: page.slug ? `${page.title} · ${site.name}` : site.name,
      shareTitle: page.slug ? page.title : site.name,
      description: pageDescription(page),
      path: pagePath(page.slug),
      type: 'website',
      // Only a page's own translations: a language's home page is not this page in that language.
      alternates: alternates.filter((a) => a.translated).length > 1 ? alternates.filter((a) => a.translated) : [],
      // The home page says what the site is, and whose.
      data: page.slug === '' ? [{ '@type': 'WebSite', '@id': `${site.url}/#website`, name: site.name, url: `${site.url}/`, inLanguage: site.language, publisher: { '@id': `${site.url}/#organization` } }, organization(site)] : undefined,
    },
    body,
    css,
  );
}

const feedOf = (site: Site, type: ContentType): string => (site.url && type.feed ? feedPath(type) : '');

export function renderPost(
  site: Site,
  theme: Theme,
  post: Post,
  menu: MenuItem[],
  type: ContentType = postsType(),
  lists: EntryLists = {},
  template: Block[] | null = null,
  alternates: Alternate[] = [],
): string {
  const { body, css } = renderPostParts(site, theme, post, menu, false, type, lists, template, false, alternates);
  return documentHtml(
    site,
    {
      title: `${post.title} · ${site.name}`,
      shareTitle: post.title,
      description: postDescription(post),
      path: entryPath(type, post.slug),
      type: 'article',
      image: post.cover?.src,
      feed: feedOf(site, type),
      // A dated entry is an article: its headline, its day, its picture, and who published it.
      data: type.dated
        ? [
            {
              '@type': 'BlogPosting',
              headline: post.title,
              datePublished: post.date,
              url: `${site.url}${entryPath(type, post.slug)}`,
              inLanguage: site.language,
              ...(postDescription(post) ? { description: postDescription(post) } : {}),
              ...(post.cover ? { image: absolute(site, post.cover.src) } : {}),
              ...(post.categories.length ? { articleSection: post.categories[0] } : {}),
              ...(post.tags.length ? { keywords: post.tags.join(', ') } : {}),
              publisher: { '@id': `${site.url}/#organization` },
              author: { '@id': `${site.url}/#organization` },
            },
            organization(site),
          ]
        : undefined,
    },
    body,
    css,
  );
}

/** One page of a list of posts: the blog itself, or one category of it. */
export function renderBlogList(
  site: Site,
  list: { heading: string; path: string; posts: Post[]; newer?: string; older?: string },
  menu: MenuItem[],
  type: ContentType = postsType(),
  alternates: Alternate[] = [],
): string {
  const body = clean(render(BlogLayout, { props: { site, menu, heading: list.heading, posts: list.posts, newer: list.newer, older: list.older, type }, context: withAlternates(alternates) }).body);
  return documentHtml(
    site,
    { title: `${list.heading} · ${site.name}`, shareTitle: list.heading, description: '', path: list.path, type: 'website', feed: feedOf(site, type) },
    body,
    '',
  );
}
