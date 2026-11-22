/**
 * Archives (ADR 0056): the entries of a dated type by who wrote them and by
 * the day they are dated, and each person's page across every dated type. Every
 * address is made from the type's own, so a type called "news" has
 * `/news/2026/11/` and `/news/author/ana-pop/`, in each of its languages.
 */
import type { ImageValue } from './blocks.ts';
import type { Post } from './post.ts';
import type { ContentType } from './types.ts';
import { slugify } from './util.ts';

/** Who wrote an entry, as the site shows them (ADR 0055 d3, ADR 0056 d1). */
export interface Byline {
  name: string;
  bio: string;
  /** Their page's address part: `ana-pop`. Made from the name; empty for someone without one. */
  slug?: string;
  /** Their picture, from the media library (ADR 0056 d2). */
  picture?: ImageValue | null;
}

/** The word in an author's address, in every language, like `category` and `tag`. */
export const AUTHOR_SLUG = 'author';

const paged = (base: string, page: number): string => (page <= 1 ? base : `${base}page/${page}/`);

/** A dated type's list of one person's entries: `/news/author/ana-pop/`. */
export const typeAuthorPath = (type: ContentType, slug: string, page = 1): string => paged(`/${type.path}/${AUTHOR_SLUG}/${slug}/`, page);

/** A person's page across every dated type: `/author/ana-pop/`, `/ro/author/ana-pop/` (d3). */
export const authorPath = (prefix: string, slug: string, page = 1): string => paged(`${prefix}/${AUTHOR_SLUG}/${slug}/`, page);

/** A year, a month or a day of a dated type: `/news/2026/`, `/news/2026/11/`, `/news/2026/11/21/`. */
export const datePath = (type: ContentType, period: string, page = 1): string => paged(`/${type.path}/${period.split('-').join('/')}/`, page);

/**
 * Each person's address part, by their id: from their name, in the order they
 * joined, so the first Ana Pop is `ana-pop` and the second `ana-pop-2`.
 * Someone without a name has none.
 */
export function authorSlugs(people: { id: string; name: string }[]): Map<string, string> {
  const taken = new Set<string>();
  const out = new Map<string, string>();
  for (const person of people) {
    const base = slugify(person.name);
    if (!base) continue;
    let slug = base;
    for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
    taken.add(slug);
    out.set(person.id, slug);
  }
  return out;
}

/** The periods of these entries, each with its entries: years (`2026`), months (`2026-11`) or days (`2026-11-21`), newest first. */
export function periodsOf<P extends { date: string } = Post>(posts: P[], length: 4 | 7 | 10): { period: string; posts: P[] }[] {
  const found = new Map<string, P[]>();
  for (const post of posts) {
    const period = post.date.slice(0, length);
    found.set(period, [...(found.get(period) ?? []), post]);
  }
  return [...found.entries()].sort(([a], [b]) => (a < b ? 1 : -1)).map(([period, own]) => ({ period, posts: own }));
}

/** What a period's list is headed, in the site's language: "2026", "noiembrie 2026", "21 noiembrie 2026". */
export function periodName(period: string, language: string): string {
  const [year, month, day] = period.split('-');
  if (!month) return year as string;
  const date = new Date(`${year}-${month}-${day ?? '01'}T00:00:00Z`);
  const options: Intl.DateTimeFormatOptions = day ? { dateStyle: 'long', timeZone: 'UTC' } : { month: 'long', year: 'numeric', timeZone: 'UTC' };
  try {
    return new Intl.DateTimeFormat(language, options).format(date);
  } catch {
    return period;
  }
}

/** Why an entry may not have this address, or '' (d5): one of digits alone is a year's, and `author` the people's. */
export function entrySlugProblem(type: ContentType, slug: string): string {
  if (type.dated && /^\d+$/.test(slug)) return `the address "${slug}" is only digits, which this type's archives use; choose another`;
  if (type.dated && slug === AUTHOR_SLUG) return `the address "${slug}" leads to this type's authors; choose another`;
  return '';
}
