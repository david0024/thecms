/** A page and the site it belongs to, as documents. */
import { type Block, blocksText, cleanImage, cleanLink, type ImageValue, type LinkValue, normalizeBlocks } from './blocks.ts';
import { type MenuNode, normalizeMenu } from './menu.ts';
import { pageSlug, prefixOf } from './translation.ts';
import { type ContentType, normalizeTypes, postsType, RESERVED_SLUGS } from './types.ts';
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
  /** What the blog is called in the menu and at the top of its list. */
  blogTitle: string;
  /** The content types the owner added. Posts are always there and are not listed here (ADR 0010). */
  types: ContentType[];
  /** Where the site's forms send what visitors write (ADR 0019): the address of this site's form service. Empty: no form is drawn. */
  forms: string;
  /** How many days a message a visitor sent is kept before it is deleted (ADR 0019). */
  keepMessages: number;
  /** The site's other languages, after `language` (ADR 0024). Empty: the site has one. */
  languages: string[];
  /** What the header and footer say in each other language, by language. */
  translations: Record<string, SiteText>;
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
  try {
    const url = new URL(v);
    const local = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !local) || url.username || url.password || url.search || url.hash) return '';
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return '';
  }
}

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
    blogTitle: str(raw.blogTitle, 60).trim() || 'Blog',
    types: normalizeTypes(raw.types),
    forms: cleanFormsAddress(raw.forms),
    ...siteLanguages(raw),
    keepMessages: Number.isInteger(raw.keepMessages) && (raw.keepMessages as number) >= 1 && (raw.keepMessages as number) <= 3650 ? (raw.keepMessages as number) : KEEP_MESSAGES_DAYS,
  };
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

/** Every content type the site has: posts first, then the owner's. */
export const contentTypes = (site: Site): ContentType[] => [postsType(site.blogTitle), ...site.types];

export const typeById = (site: Site, id: string): ContentType | undefined => contentTypes(site).find((t) => t.id === id);

/** Addresses a page may not take: the site's own, and each type's. */
export const reservedSlugs = (site: Site): string[] => [...RESERVED_SLUGS, ...site.types.map((t) => t.path), ...site.languages.map(prefixOf)];

export const pagePath = (slug: string): string => (slug ? `/${slug}/` : '/');

/** What a search engine shows under the title. */
export const pageDescription = (page: Page): string => page.description || blocksText(page.blocks);
