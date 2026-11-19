/**
 * The few words the site itself says to a visitor, in English, as data
 * (ADR 0001 d3, ADR 0021): labels the author did not write. Another language
 * is a language pack (`languages/<code>.json`) whose keys are these under
 * `site.`. A site in a language no pack is given for says them in English.
 */
import { applyPack, type Catalog, type LanguagePack } from '../core/language.ts';

export const en = {
  mainMenu: 'Main',
  menu: 'Menu',
  footerMenu: 'Footer',
  notFound: 'Page not found',
  newer: 'Newer posts',
  older: 'Older posts',
  pages: 'Pages',
  noPosts: 'Nothing has been posted yet.',
  feed: 'Feed',
  formName: 'Name',
  formEmail: 'Email',
  formMessage: 'Message',
};

export type Words = typeof en;

/** The site's words of every language a pack was given for, by language code. */
const WORDS = new Map<string, Words>();

/** Takes the site words of these packs; a later pack of the same language replaces the earlier one. */
export function useSitePacks(packs: LanguagePack[]): void {
  for (const pack of packs) WORDS.set(pack.language, (applyPack({ site: en } as unknown as Catalog, pack) as unknown as { site: Words }).site);
}

export const wordsFor = (language: string): Words => WORDS.get(language) ?? WORDS.get(language.split('-')[0] ?? '') ?? en;

/** A post's day, written the way the site's language writes dates. */
export function dateText(date: string, language: string): string {
  try {
    return new Intl.DateTimeFormat(language, { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
  } catch {
    return date;
  }
}
