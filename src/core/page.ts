/** A page and the site it belongs to, as documents. */
import { type Block, blocksText, cleanImage, cleanLink, type ImageValue, type LinkValue, normalizeBlocks } from './blocks.ts';
import { type MenuNode, normalizeMenu } from './menu.ts';
import { type Issue, isObject, safeHref, slugify, str } from './util.ts';

export interface Page {
  /** '' is the home page; anything else is served at `/<slug>/`. */
  slug: string;
  title: string;
  /** For search engines and link previews. Empty means "taken from the page's words". */
  description: string;
  inMenu: boolean;
  blocks: Block[];
}

export interface Site {
  name: string;
  /** A BCP 47 tag: `en`, `ro`, `pt-BR`. */
  language: string;
  /** `https://example.com`, no trailing slash. Empty until the owner sets it. */
  url: string;
  /** Shown in the header in place of the name. What the header looks like is the theme's (ADR 0006). */
  logo: ImageValue | null;
  /** One button in the header: "Ask for a quote". */
  action: LinkValue | null;
  footer: string;
  /** Links in the footer: a privacy page, a social profile. */
  footerLinks: LinkValue[];
  /** The menu as the owner arranged it; null while the site makes one from its pages (ADR 0008). */
  menu: MenuNode[] | null;
  /** What the blog is called in the menu and at the top of its list. */
  blogTitle: string;
}

const MAX_FOOTER_LINKS = 12;

const LANGUAGE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

export function normalizePage(input: unknown): { page: Page; issues: Issue[] } {
  const raw = isObject(input) ? input : {};
  const { blocks, issues } = normalizeBlocks(raw.blocks);
  const title = str(raw.title, 200).trim();
  if (!title) issues.push({ path: 'title', message: 'a page has a title' });
  return {
    page: {
      slug: slugify(raw.slug),
      title,
      description: str(raw.description, 300).trim(),
      inMenu: raw.inMenu !== false,
      blocks,
    },
    issues,
  };
}

export function normalizeSite(input: unknown): Site {
  const raw = isObject(input) ? input : {};
  const url = safeHref(raw.url);
  return {
    name: str(raw.name, 120).trim() || 'My site',
    language: typeof raw.language === 'string' && LANGUAGE.test(raw.language) ? raw.language : 'en',
    url: /^https?:\/\//i.test(url) ? url.replace(/\/+$/, '') : '',
    logo: cleanImage(raw.logo),
    action: cleanLink(raw.action),
    footer: str(raw.footer, 300).trim(),
    footerLinks: (Array.isArray(raw.footerLinks) ? raw.footerLinks : [])
      .slice(0, MAX_FOOTER_LINKS)
      .map(cleanLink)
      .filter((link): link is LinkValue => link !== null),
    menu: normalizeMenu(raw.menu),
    blogTitle: str(raw.blogTitle, 60).trim() || 'Blog',
  };
}

export const pagePath = (slug: string): string => (slug ? `/${slug}/` : '/');

/** What a search engine shows under the title. */
export const pageDescription = (page: Page): string => page.description || blocksText(page.blocks);
