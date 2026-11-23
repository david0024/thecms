/**
 * Who sees a page, an entry or a whole content type (ADR 0064 d3, d4):
 * everyone, visitors signed in, or members of chosen levels. A level is named
 * by the owner ("Member", "Premium") and known by its id.
 */
import { isObject, slugify, str } from './util.ts';

export interface Level {
  id: string;
  name: string;
}

/** Only for those signed in, or for members of one of the levels. Everyone sees what has none. */
export type Audience = { who: 'signed' } | { who: 'members'; levels: string[] };

/** What has an audience: pages by the address of their main language, entries by `type/entry`, types by their id. */
export interface Audiences {
  pages: Record<string, Audience>;
  entries: Record<string, Audience>;
  types: Record<string, Audience>;
}

export const NO_AUDIENCES: Audiences = { pages: {}, entries: {}, types: {} };

/** As many levels as a site needs, and a name a person reads. */
export const LEVELS_MAX = 20;

export function normalizeLevels(input: unknown): Level[] {
  const seen = new Set<string>();
  const out: Level[] = [];
  for (const raw of Array.isArray(input) ? input : []) {
    if (!isObject(raw)) continue;
    const name = str(raw.name, 60).replace(/\s+/g, ' ').trim();
    const id = slugify(typeof raw.id === 'string' && raw.id ? raw.id : name).slice(0, 40);
    if (!name || !id || seen.has(id) || out.length >= LEVELS_MAX) continue;
    seen.add(id);
    out.push({ id, name });
  }
  return out;
}

/** An audience from untrusted input; null is everyone. Members of no level are nobody, so that is not one. */
export function normalizeAudience(input: unknown): Audience | null {
  if (!isObject(input)) return null;
  if (input.who === 'signed') return { who: 'signed' };
  if (input.who !== 'members') return null;
  const levels = [...new Set((Array.isArray(input.levels) ? input.levels : []).map((l) => slugify(l).slice(0, 40)).filter(Boolean))].slice(0, LEVELS_MAX);
  return levels.length ? { who: 'members', levels } : null;
}

export function normalizeAudiences(input: unknown): Audiences {
  const raw = isObject(input) ? input : {};
  const part = (value: unknown): Record<string, Audience> => {
    const out: Record<string, Audience> = {};
    if (!isObject(value)) return out;
    for (const [key, one] of Object.entries(value)) {
      const audience = normalizeAudience(one);
      if (audience && key.length <= 300) out[key] = audience;
    }
    return out;
  };
  return { pages: part(raw.pages), entries: part(raw.entries), types: part(raw.types) };
}

/** Whether a visitor holding these levels (null: not signed in) may see what has this audience. */
export const mayView = (audience: Audience | null, levels: string[] | null): boolean =>
  audience === null || (levels !== null && (audience.who === 'signed' || audience.levels.some((l) => levels.includes(l))));

/** How a built page carries its audience for the runtime: `signed`, or `members:` and the levels. */
export const audienceWord = (audience: Audience): string => (audience.who === 'signed' ? 'signed' : `members:${audience.levels.join(' ')}`);

export function audienceFromWord(word: string): Audience | null {
  if (word === 'signed') return { who: 'signed' };
  return word.startsWith('members:') ? normalizeAudience({ who: 'members', levels: word.slice(8).split(' ') }) : null;
}
