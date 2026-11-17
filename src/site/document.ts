/**
 * One page as a complete HTML document. The same functions serve the static
 * export and the editor's canvas, so what the author sees while editing is
 * what a visitor gets.
 */
import { render } from 'svelte/server';
import BlogLayout from '../blocks/BlogLayout.svelte';
import Layout from '../blocks/Layout.svelte';
import PostLayout from '../blocks/PostLayout.svelte';
import {
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
} from '../core/index.ts';

const esc = (v: string): string =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export type MenuItem = MenuLink;

/** The menu these pages get: the one the owner arranged, or the pages in order and then the blog. */
export const menuOf = (site: Site, pages: MenuPage[], lists: MenuLists): MenuItem[] => resolveMenu(site, pages, lists);

export const STYLESHEET = '/assets/site.css';

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
export function renderParts(site: Site, theme: Theme, page: Page, menu: MenuItem[], editing = false): { body: string; css: string } {
  return { body: clean(render(Layout, { props: { site, page, menu, editing } }).body), css: own(page.blocks, theme) };
}

/** The same for an entry of a content type; a blog post when no type is named. */
export function renderPostParts(site: Site, theme: Theme, post: Post, menu: MenuItem[], editing = false, type: ContentType = postsType(site.blogTitle)): { body: string; css: string } {
  return { body: clean(render(PostLayout, { props: { site, post, menu, editing, type } }).body), css: own(post.blocks, theme) };
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
    `<link rel="stylesheet" href="${STYLESHEET}">`,
    css ? `<style>${css}</style>` : '',
  ].filter(Boolean);
  return `<!doctype html>\n<html lang="${esc(site.language)}">\n<head>\n${lines.join('\n')}\n</head>\n<body>\n${body}\n</body>\n</html>\n`;
}

export function renderPage(site: Site, theme: Theme, page: Page, menu: MenuItem[]): string {
  const { body, css } = renderParts(site, theme, page, menu);
  return documentHtml(
    site,
    {
      title: page.slug ? `${page.title} · ${site.name}` : site.name,
      shareTitle: page.slug ? page.title : site.name,
      description: pageDescription(page),
      path: pagePath(page.slug),
      type: 'website',
    },
    body,
    css,
  );
}

const feedOf = (site: Site, type: ContentType): string => (site.url && type.feed ? feedPath(type) : '');

export function renderPost(site: Site, theme: Theme, post: Post, menu: MenuItem[], type: ContentType = postsType(site.blogTitle)): string {
  const { body, css } = renderPostParts(site, theme, post, menu, false, type);
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
  type: ContentType = postsType(site.blogTitle),
): string {
  const body = clean(render(BlogLayout, { props: { site, menu, heading: list.heading, posts: list.posts, newer: list.newer, older: list.older, type } }).body);
  return documentHtml(
    site,
    { title: `${list.heading} · ${site.name}`, shareTitle: list.heading, description: '', path: list.path, type: 'website', feed: feedOf(site, type) },
    body,
    '',
  );
}
