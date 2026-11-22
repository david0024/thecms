/** A page and the site it belongs to, as documents. */
import type { Form } from './form.ts';
import { type Block, cleanImage, describeBlocks, cleanLink, type ImageValue, type LinkValue, normalizeBlocks } from './blocks.ts';
import { type Layout, normalizeLayouts } from './layout.ts';
import { normalizeTranslations, type PageTranslation } from './localize.ts';
import { type MenuNode, normalizeMenu } from './menu.ts';
import type { Pictures } from './media.ts';
import { cleanSeo, type Seo } from './seo.ts';
import { pageSlug, prefixOf } from './translation.ts';
import { BLOG_SLUG, type ContentType, normalizeTypes, POSTS_TYPE, postsType, RESERVED_SLUGS } from './types.ts';
import { type Issue, isObject, safeHref, slugify, str } from './util.ts';

export interface Page extends Seo {
  /** '' is the home page; anything else is served at `/<slug>/`. */
  slug: string;
  title: string;
  /** For search engines and link previews. Empty means "taken from the page's words". */
  description: string;
  inMenu: boolean;
  blocks: Block[];
  /** The page in the site's other languages, by language (ADR 0032). Always there once the page is cleaned. */
  translations?: Record<string, PageTranslation>;
  /** The layout it is drawn in (ADR 0035); absent: its type's, or the standard one. */
  layout?: string;
}

export interface Site {
  name: string;
  /** A BCP 47 tag: `en`, `ro`, `pt-BR`. */
  language: string;
  /** The admin's language, when it is not the site's: empty means the same (ADR 0021). */
  adminLanguage: string;
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
  /** The content types the owner added. Posts are always there and are not listed here (ADR 0010). */
  types: ContentType[];
  /** Where the site's forms send what visitors write (ADR 0019): a form service elsewhere, for a site exported to a static host. Empty: the site's own server (ADR 0044). */
  forms: string;
  /** How many days a message a visitor sent is kept before it is deleted (ADR 0019). */
  keepMessages: number;
  /** The site's other languages, after `language` (ADR 0024). Empty: the site has one. */
  languages: string[];
  /** What the header and footer say in each other language, by language. */
  translations: Record<string, SiteText>;
  /** The site's layouts (ADR 0035); absent while it has the ready ones. */
  layouts?: Layout[];
  /** What each section a layout shows holds, in the language being drawn: filled in to draw a page, never kept. */
  areas?: Record<string, Block[]>;
  /** The site's forms, by name (ADR 0049): filled in to draw a page, never kept. */
  formDefs?: Record<string, Form>;
  /** The picture of a link preview for every page that has none of its own (ADR 0050 d2). */
  shareImage?: ImageValue;
  /** False: the breadcrumbs are said to search engines and not shown (ADR 0050 d4). Absent: shown. */
  breadcrumbs?: false;
  /** The codes Google and Bing give to prove the site is the owner's (ADR 0057 d4): each absent until set. */
  verify?: { google?: string; bing?: string };
  /** The owner's own lines for `robots.txt`, after the program's (ADR 0057 d5). Absent: none. */
  robots?: string;
  /** The stored pictures' sizes and smaller copies (ADR 0005 d8): filled in to draw a page for export, never kept. */
  pictures?: Pictures;
}

/** The site's own words in another language: the footer and the header's button. */
export interface SiteText {
  footer: string;
  action: LinkValue | null;
  footerLinks: LinkValue[];
}

/** A site has at most this many languages besides its main one. */
export const MAX_LANGUAGES = 9;

/** A form service's address: https, or http on this machine while trying it out. Nothing else, and never a path or a query. */
export function cleanFormsAddress(value: unknown): string {
  const v = str(value, 300).trim().replace(/\/+$/, '');
  // The site's own runtime, at the same address as its pages (ADR 0038).
  if (v === '/_') return v;
  try {
    const url = new URL(v);
    const local = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !local) || url.username || url.password || url.search || url.hash) return '';
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return '';
  }
}

/** Where forms, comments and search are answered: the form service set, or the site's own server (ADR 0044). */
export const formsAddress = (site: Pick<Site, 'forms'>): string => site.forms || '/_';

export const KEEP_MESSAGES_DAYS = 180;

const MAX_FOOTER_LINKS = 12;

const LANGUAGE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

export function normalizePage(input: unknown): { page: Page; issues: Issue[] } {
  const raw = isObject(input) ? input : {};
  const { blocks, issues } = normalizeBlocks(raw.blocks);
  const title = str(raw.title, 200).trim();
  if (!title) issues.push({ path: 'title', message: 'a page has a title' });
  return {
    page: {
      slug: pageSlug(raw.slug),
      title,
      description: str(raw.description, 300).trim(),
      inMenu: raw.inMenu !== false,
      blocks,
      translations: normalizeTranslations(raw.translations),
      ...(slugify(raw.layout) ? { layout: slugify(raw.layout) } : {}),
      ...cleanSeo(raw),
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
    adminLanguage: typeof raw.adminLanguage === 'string' && LANGUAGE.test(raw.adminLanguage) ? raw.adminLanguage : '',
    url: /^https?:\/\//i.test(url) ? url.replace(/\/+$/, '') : '',
    logo: cleanImage(raw.logo),
    action: cleanLink(raw.action),
    footer: str(raw.footer, 300).trim(),
    footerLinks: cleanFooterLinks(raw.footerLinks),
    menu: normalizeMenu(raw.menu),
    types: siteTypes(raw),
    forms: cleanFormsAddress(raw.forms),
    ...siteLanguages(raw),
    ...(Array.isArray(raw.layouts) ? { layouts: normalizeLayouts(raw.layouts) } : {}),
    ...(cleanImage(raw.shareImage) ? { shareImage: cleanImage(raw.shareImage) as ImageValue } : {}),
    ...(raw.breadcrumbs === false ? { breadcrumbs: false as const } : {}),
    ...cleanVerify(raw.verify),
    ...(cleanRobots(raw.robots) ? { robots: cleanRobots(raw.robots) } : {}),
    keepMessages: Number.isInteger(raw.keepMessages) && (raw.keepMessages as number) >= 1 && (raw.keepMessages as number) <= 3650 ? (raw.keepMessages as number) : KEEP_MESSAGES_DAYS,
  };
}

/**
 * A verification code as Google or Bing gives it: the code, or the whole
 * `<meta … content="…">` tag it comes in, from which the code is taken.
 */
export function verificationCode(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  const code = /content\s*=\s*["']([^"']*)["']/i.exec(text)?.[1] ?? text;
  return /^[A-Za-z0-9_-]{1,100}$/.test(code) ? code : '';
}

function cleanVerify(raw: unknown): { verify?: { google?: string; bing?: string } } {
  const given = isObject(raw) ? raw : {};
  const google = verificationCode(given.google);
  const bing = verificationCode(given.bing);
  return google || bing ? { verify: { ...(google ? { google } : {}), ...(bing ? { bing } : {}) } } : {};
}

/** What `robots.txt` may say: only its own kinds of line, each of them short; anything else is dropped. */
export const ROBOTS_LINE = /^(user-agent|allow|disallow|crawl-delay|sitemap)\s*:\s*[^\s<>"]{0,500}$/i;

export function cleanRobots(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .slice(0, 5000)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => ROBOTS_LINE.test(line))
    .slice(0, 100)
    .join('\n');
}

const cleanFooterLinks = (value: unknown): LinkValue[] =>
  (Array.isArray(value) ? value : [])
    .slice(0, MAX_FOOTER_LINKS)
    .map(cleanLink)
    .filter((link): link is LinkValue => link !== null);

/** The other languages, each once and never the main one, and the words of each. */
function siteLanguages(raw: Record<string, unknown>): Pick<Site, 'languages' | 'translations'> {
  const main = typeof raw.language === 'string' && LANGUAGE.test(raw.language) ? raw.language : 'en';
  const languages = [
    ...new Set((Array.isArray(raw.languages) ? raw.languages : []).filter((l): l is string => typeof l === 'string' && LANGUAGE.test(l) && prefixOf(l) !== prefixOf(main))),
  ].filter((l, i, all) => all.findIndex((o) => prefixOf(o) === prefixOf(l)) === i).slice(0, MAX_LANGUAGES);
  const given = isObject(raw.translations) ? raw.translations : {};
  const translations: Record<string, SiteText> = {};
  for (const language of languages) {
    const own = isObject(given[language]) ? (given[language] as Record<string, unknown>) : {};
    translations[language] = { footer: str(own.footer, 300).trim(), action: cleanLink(own.action), footerLinks: cleanFooterLinks(own.footerLinks) };
  }
  return { languages, translations };
}

/**
 * The site's types. Before ADR 0025 the blog was built in, named by
 * `blogTitle` and not listed: such a site gets it listed, as a type of its
 * own, and nothing about its addresses changes. A site saved since lists
 * every type it has, so a blog the owner removed stays removed.
 */
function siteTypes(raw: Record<string, unknown>): ContentType[] {
  const types = normalizeTypes(raw.types);
  const before = !Array.isArray(raw.types) || 'blogTitle' in raw;
  if (!before || types.some((t) => t.id === POSTS_TYPE || t.path === BLOG_SLUG)) return types;
  return normalizeTypes([postsType(str(raw.blogTitle, 60).trim() || 'Blog'), ...types]);
}

/** Every content type the site has, in the owner's order. */
export const contentTypes = (site: Site): ContentType[] => site.types;

export const typeById = (site: Site, id: string): ContentType | undefined => contentTypes(site).find((t) => t.id === id);

/** Addresses a page may not take: the site's own, and each type's. */
export const reservedSlugs = (site: Site): string[] => [
  ...RESERVED_SLUGS,
  ...site.types.map((t) => t.path),
  // A type's address in another language is taken there too (ADR 0054 d3).
  ...site.types.flatMap((t) => Object.values(t.translations ?? {}).flatMap((own) => (own.path ? [own.path] : []))),
  ...site.languages.map(prefixOf),
];

export const pagePath = (slug: string): string => (slug ? `/${slug}/` : '/');

/** What a search engine shows under the title. */
/** What search engines are told: the description, or else the one the site writes from the page (ADR 0057 d1). */
export const pageDescription = (page: Page): string => page.description || describeBlocks(page.blocks);
