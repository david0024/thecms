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
  languages: 'Languages',
  comments: 'Comments',
  commentWrite: 'Leave a comment',
  comment: 'Comment',
  commentSend: 'Send the comment',
  commentSent: 'Thank you. Your comment is shown here once it is approved.',
  commentFailed: 'The comment was not sent. Check each field and try again.',
  locked: 'This page is protected',
  lockedHint: 'Give its password to see it.',
  lockedPassword: 'Password',
  lockedOpen: 'Open the page',
  lockedWrong: 'That is not its password.',
  lockedStatic: 'This page is protected by a password and cannot be opened here.',
  search: 'Search',
  searchNone: 'Nothing on this site matches “{query}”.',
  searchFound: 'Pages that match “{query}”',
  commentConsent: 'Show my name and comment on this page once approved. My email is kept only to reach me about it and is never shown.',
};

/** Where a page's other languages reach the header (ADR 0024): set by whatever draws the page. */
export const ALTERNATES = 'thecms-alternates';

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
