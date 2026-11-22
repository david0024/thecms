/**
 * How the statistics keep their totals (ADR 0062 d8), shared by the extension
 * and by the program, which moves the totals it kept before into the same rows.
 *
 * Each total is one row of a day, in `days`, and of its month, in `months`,
 * named by `<day or month>:<kind>:<a short hash of the name>`: the same total
 * counted by two of the site's processes is added to the same row.
 */

/** What a total counts: visitors, pages seen, or times a page, a source, a device or a search came up. */
export const KINDS = ['visitors', 'views', 'page', 'source', 'device', 'search'] as const;
export type Kind = (typeof KINDS)[number];
/** The longest address, source or search kept. */
export const NAME_MAX = 200;
/** How many days `days` keeps; the months are kept. */
export const DAYS_KEPT = 31;

/** Two 32-bit FNV-1a hashes of a name, as 16 hex digits: short enough for a row's id, plenty for one day's names. */
export function hashOf(name: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < name.length; i++) {
    const c = name.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
    b ^= b >>> 15;
  }
  return a.toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}

/** One total to add, to the row of its collection. */
export interface Added {
  collection: 'days' | 'months';
  id: string;
  row: { day: string; kind: Kind; name: string } | { month: string; kind: Kind; name: string };
  hits: number;
}

/** A day's total as the rows it is added to: the day's, and its month's. */
export function rowsOf(day: string, kind: Kind, name: string, hits: number): Added[] {
  const kept = name.slice(0, NAME_MAX);
  const month = day.slice(0, 7);
  return [
    { collection: 'days', id: `${day}:${kind}:${hashOf(kept)}`, row: { day, kind, name: kept }, hits },
    { collection: 'months', id: `${month}:${kind}:${hashOf(kept)}`, row: { month, kind, name: kept }, hits },
  ];
}

/** Many totals, summed by the row they are added to. */
export function summed(totals: Iterable<{ day: string; kind: Kind; name: string; hits: number }>): Added[] {
  const by = new Map<string, Added>();
  for (const total of totals) {
    for (const one of rowsOf(total.day, total.kind, total.name, total.hits)) {
      const key = `${one.collection}\0${one.id}`;
      const before = by.get(key);
      if (before) before.hits += one.hits;
      else by.set(key, one);
    }
  }
  return [...by.values()];
}
