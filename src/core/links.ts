/**
 * Links a page could have to the site's other pages (ADR 0077 d1): another
 * page or entry whose title the page's words already say, and that it does
 * not link to yet. Search engines and readers find their way by such links.
 */
import { type Block, blocksText } from './blocks.ts';

export interface LinkTarget {
  title: string;
  /** Where it is on the site, as the site writes it: `/about/`. */
  path: string;
}

/** Letters as they are compared: without their accents, in small letters. */
const fold = (text: string): string => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A link as a path on this site, without what follows it; a link elsewhere as written. */
const pathOf = (href: string): string => href.replace(/^https?:\/\/[^/]+/i, '').replace(/[?#].*$/, '') || '/';

/** Every address a page links to, wherever in its blocks a link is. */
export function linksIn(blocks: Block[]): Set<string> {
  const out = new Set<string>();
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) for (const item of value) walk(item);
    else if (value && typeof value === 'object') {
      for (const [key, inner] of Object.entries(value)) {
        if (key === 'href' && typeof inner === 'string' && inner) out.add(pathOf(inner));
        else walk(inner);
      }
    }
  };
  walk(blocks);
  return out;
}

/**
 * The pages and entries a page could link to: those whose title its words say
 * as whole words, that it does not link to yet, other than itself and the home
 * page; the longest titles first, as they say the most. A title of fewer than
 * four letters says too little to be found.
 */
export function linkSuggestions(blocks: Block[], targets: readonly LinkTarget[], self: string, max = 8): LinkTarget[] {
  const text = fold(blocksText(blocks, Number.POSITIVE_INFINITY));
  if (!text) return [];
  const linked = linksIn(blocks);
  const seen = new Set<string>();
  const found: (LinkTarget & { at: number; length: number })[] = [];
  for (const target of targets) {
    const title = fold(target.title);
    if (title.replace(/[^\p{L}\p{N}]/gu, '').length < 4 || target.path === '/' || target.path === self || linked.has(target.path) || seen.has(target.path)) continue;
    const at = text.search(new RegExp(`(?<![\\p{L}\\p{N}])${escape(title)}(?![\\p{L}\\p{N}])`, 'u'));
    if (at < 0) continue;
    seen.add(target.path);
    found.push({ ...target, at, length: title.length });
  }
  return found
    .sort((a, b) => b.length - a.length || a.at - b.at)
    .slice(0, max)
    .map(({ title, path }) => ({ title, path }));
}
