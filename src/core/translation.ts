/**
 * The same site in more than one language (ADR 0024).
 *
 * The site has one main language, whose pages live where they always did, and
 * may have others. A page's translation lives under the language's prefix:
 * the Romanian `about` is `ro/about`, served at `/ro/about/`, and the Romanian
 * home page is `ro`, at `/ro/`. The address says which page a translation is
 * of, so nothing else has to keep the two together.
 *
 * In another language the header, the footer and the menu are that
 * language's: its words from the language packs, the footer the owner wrote
 * for it, and the main menu with each page swapped for its translation.
 */
import type { MenuNode } from './menu.ts';
import type { Site } from './page.ts';
import { slugify } from './util.ts';

/** How a language shows in an address: `pt-BR` is `/pt-br/`. */
export const prefixOf = (language: string): string => language.toLowerCase();

const PREFIX = /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/;

/**
 * A page's address as it is kept: `about`, or a translation's `ro/about`, or
 * a language's home page `ro`. What the prefix is a language of is the site's
 * to say (`slugProblem`).
 */
export function pageSlug(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  const at = text.indexOf('/');
  if (at <= 0) return slugify(text);
  const prefix = text.slice(0, at).toLowerCase();
  if (!PREFIX.test(prefix)) return slugify(text);
  const rest = slugify(text.slice(at + 1));
  return rest ? `${prefix}/${rest}` : prefix;
}

/** The language a page's address is in. */
export function languageOf(site: Site, slug: string): string {
  const first = slug.split('/')[0];
  return site.languages.find((language) => prefixOf(language) === first) ?? site.language;
}

/** The address of the page a translation is of: `ro/about` is of `about`, `ro` of the home page. */
export function baseSlug(site: Site, slug: string): string {
  const language = languageOf(site, slug);
  if (language === site.language) return slug;
  return slug.slice(prefixOf(language).length + 1);
}

/** The address of a page in a language: `about` in Romanian is `ro/about`. */
export function slugIn(site: Site, language: string, base: string): string {
  if (language === site.language) return base;
  return base ? `${prefixOf(language)}/${base}` : prefixOf(language);
}

/** Why a page may not have this address, or ''. */
export function slugProblem(site: Site, slug: string, reserved: readonly string[]): string {
  const language = languageOf(site, slug);
  const base = baseSlug(site, slug);
  if (language === site.language && slug.includes('/')) return `"${slug.split('/')[0]}" is not one of the site's languages`;
  if (reserved.includes(base)) return `the address "/${base}/" is used by the site itself; choose another`;
  return '';
}

/** The pages of one language. */
export const pagesIn = <P extends { slug: string }>(site: Site, language: string, pages: P[]): P[] => pages.filter((p) => languageOf(site, p.slug) === language);

/** A language's own name, in that language: "română", "Deutsch". */
export function languageName(language: string): string {
  try {
    const name = new Intl.DisplayNames([language], { type: 'language' }).of(language) ?? language;
    return name.charAt(0).toLocaleUpperCase(language) + name.slice(1);
  } catch {
    return language;
  }
}

/** One way to the same page in another language, for the switcher in the header. */
export interface Alternate {
  language: string;
  name: string;
  href: string;
  /** That language's home page. */
  home: string;
  /** `href` is this page in that language, not just the language's home page. */
  translated: boolean;
  current: boolean;
}

/**
 * The site's languages, each with where this page is in it: its translation,
 * or, where it has none, that language's home page. Nothing when the site has
 * one language. `slug` is null where there is no page (a post, a list).
 */
export function alternates(site: Site, slug: string | null, pages: { slug: string }[], current: string = slug === null ? site.language : languageOf(site, slug)): Alternate[] {
  if (site.languages.length === 0) return [];
  const have = new Set(pages.map((p) => p.slug));
  const base = slug === null ? null : baseSlug(site, slug);
  return [site.language, ...site.languages].flatMap((language) => {
    const home = slugIn(site, language, '');
    if (language !== site.language && !have.has(home)) return [];
    const path = (s: string): string => (s ? `/${s}/` : '/');
    const own = base === null ? null : slugIn(site, language, base);
    const translated = own !== null && have.has(own);
    return [{ language, name: languageName(language), href: path(translated ? own : home), home: path(home), translated, current: language === current }];
  });
}

/** The main menu in another language: each page swapped for its translation, what has none left out. */
function menuIn(site: Site, language: string, nodes: MenuNode[]): MenuNode[] {
  return nodes.flatMap((node): MenuNode[] => {
    const children = menuIn(site, language, node.children);
    if (node.target.kind === 'page') return [{ ...node, label: '', target: { kind: 'page', slug: slugIn(site, language, node.target.slug) }, children }];
    if (node.target.kind === 'url') return [{ ...node, children }];
    // A list of entries is in the main language; what it held stays in the menu.
    if (node.target.kind === 'none') return [{ ...node, children }];
    return children;
  });
}

/**
 * The site as a page in this language is drawn with: the language, the
 * footer and button written for it, and its menu. In the main language, the
 * site as it is.
 */
export function siteIn(site: Site, language: string): Site {
  if (language === site.language || !site.languages.includes(language)) return site;
  const own = site.translations[language];
  return {
    ...site,
    language,
    footer: own?.footer ?? '',
    action: own?.action ?? null,
    // Links (a privacy page, a profile) are often the same in every language; the main ones stand in until the owner gives others.
    footerLinks: own?.footerLinks.length ? own.footerLinks : site.footerLinks,
    menu: site.menu ? menuIn(site, language, site.menu) : null,
    // Posts and entries are in the main language for now (ADR 0024).
    types: [],
  };
}
