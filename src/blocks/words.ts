/**
 * The few words the site itself says to a visitor, as data (ADR 0001 d3):
 * labels the author did not write. A language is another entry of this shape;
 * a site in a language not listed here is given the English ones.
 */
const en = {
  mainMenu: 'Main',
  footerMenu: 'Footer',
  notFound: 'Page not found',
  newer: 'Newer posts',
  older: 'Older posts',
  pages: 'Pages',
  noPosts: 'Nothing has been posted yet.',
  feed: 'Feed',
};

export type Words = typeof en;

const WORDS: Record<string, Words> = {
  en,
  ro: {
    mainMenu: 'Principal',
    footerMenu: 'Subsol',
    notFound: 'Pagina nu a fost găsită',
    newer: 'Articole mai noi',
    older: 'Articole mai vechi',
    pages: 'Pagini',
    noPosts: 'Încă nu a fost publicat nimic.',
    feed: 'Flux',
  },
};

export const wordsFor = (language: string): Words => WORDS[language] ?? WORDS[language.split('-')[0] ?? ''] ?? en;

/** A post's day, written the way the site's language writes dates. */
export function dateText(date: string, language: string): string {
  try {
    return new Intl.DateTimeFormat(language, { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
  } catch {
    return date;
  }
}
