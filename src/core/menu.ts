/**
 * The site's menu as a document (ADR 0008): a short tree of items the owner
 * arranges. What it holds is content, like the logo: it stays when the theme
 * changes. How it is drawn is the theme's.
 *
 * An item points at a page or the blog by name, not by address. So its label
 * can follow the page's title, and an item whose page is gone is left out of
 * the menu instead of leading nowhere (`navigation.ts`).
 */
import { isId, isObject, newId, safeHref, slugify, str } from './util.ts';

export type MenuTarget =
  | { kind: 'page'; slug: string }
  | { kind: 'blog' }
  | { kind: 'url'; href: string }
  /** A heading that only opens what is under it. */
  | { kind: 'none' };

export interface MenuNode {
  id: string;
  /** What the item says. Empty means "the title of what it points at". */
  label: string;
  target: MenuTarget;
  children: MenuNode[];
}

/** Top items, the items under one, and the links under those: three levels. */
export const MENU_DEPTH = 3;
export const MENU_MAX_ITEMS = 12;

function cleanTarget(raw: unknown): MenuTarget {
  if (!isObject(raw)) return { kind: 'none' };
  if (raw.kind === 'page') return { kind: 'page', slug: slugify(raw.slug) };
  if (raw.kind === 'blog') return { kind: 'blog' };
  // Kept while the address is still being typed; an item with no address is not drawn.
  if (raw.kind === 'url') return { kind: 'url', href: safeHref(raw.href) };
  return { kind: 'none' };
}

/**
 * Untrusted input as a clean menu. `null` (or anything that is not a list)
 * means the owner has not arranged a menu, and the site makes one from its
 * pages.
 */
export function normalizeMenu(input: unknown): MenuNode[] | null {
  if (!Array.isArray(input)) return null;
  const seen = new Set<string>();
  const walk = (list: unknown, depth: number): MenuNode[] =>
    (Array.isArray(list) ? list : [])
      .filter(isObject)
      .slice(0, MENU_MAX_ITEMS)
      .map((raw) => {
        const id = isId(raw.id) && !seen.has(raw.id) ? raw.id : newId();
        seen.add(id);
        return {
          id,
          label: str(raw.label, 60).replace(/\s+/g, ' ').trim(),
          target: cleanTarget(raw.target),
          children: depth < MENU_DEPTH ? walk(raw.children, depth + 1) : [],
        };
      });
  return walk(input, 1);
}
