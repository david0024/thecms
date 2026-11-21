/**
 * Links between entries (ADR 0052): a type's field of the kind `entries`
 * holds the addresses of entries of another type, or of its own. These say
 * which entries one links to, which link to it, and what is left when one is
 * deleted. Every one works on lists already read, so the site, the editor and
 * the store draw from the same answer.
 */
import type { Block, FileValue, ImageValue, LinkValue } from './blocks.ts';
import { isLink } from './blocks.ts';
import type { Post } from './post.ts';
import type { ContentType, TypeField } from './types.ts';

/** Entries of a type, as drawn: published ones for a visitor, drafts in the editor. */
export interface ListedEntries {
  type: ContentType;
  entries: Post[];
}

/** A type's fields that link to entries, of any type or of `to` alone. */
export const linkFields = (type: ContentType, to?: string): TypeField[] =>
  type.fields.filter((field) => field.kind === 'entries' && (to === undefined || field.to === to));

/** The addresses an entry's link field holds. */
export const linkedSlugs = (post: Post, field: TypeField): string[] => {
  const value = post.fields[field.key];
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
};

/** The entries a link field leads to that are there to be drawn, in the order the author put them. */
export function linkedEntries(post: Post, field: TypeField, lists: Record<string, ListedEntries>): Post[] {
  const list = lists[field.to ?? ''];
  if (!list) return [];
  const bySlug = new Map(list.entries.map((entry) => [entry.slug, entry]));
  return linkedSlugs(post, field).flatMap((slug) => bySlug.get(slug) ?? []);
}

/** One group of entries that link to an entry: a type, the field they link through, and those entries. */
export interface Backlinks {
  type: ContentType;
  field: TypeField;
  entries: Post[];
  /** The type has more than one field linking here, so the field's name is said too. */
  named: boolean;
}

/** The entries that link to this one (ADR 0052 d3), by type and field, in the order each type lists them. */
export function backlinks(type: ContentType, post: Post, lists: Record<string, ListedEntries>): Backlinks[] {
  const out: Backlinks[] = [];
  for (const list of Object.values(lists)) {
    const fields = linkFields(list.type, type.id);
    for (const field of fields) {
      const entries = list.entries.filter((entry) => !(list.type.id === type.id && entry.slug === post.slug) && linkedSlugs(entry, field).includes(post.slug));
      if (entries.length) out.push({ type: list.type, field, entries, named: fields.length > 1 });
    }
  }
  return out;
}

/**
 * The entries of a list linked to this one, either way: those it links to and
 * those that link to it, in the list's own order, never itself. What the block
 * that lists entries shows with "only those linked to the entry shown".
 */
export function relatedIn(list: ListedEntries, type: ContentType, post: Post): Post[] {
  const outward = new Set(linkFields(type, list.type.id).flatMap((field) => linkedSlugs(post, field)));
  const inward = linkFields(list.type, type.id);
  return list.entries.filter(
    (entry) => !(list.type.id === type.id && entry.slug === post.slug) && (outward.has(entry.slug) || inward.some((field) => linkedSlugs(entry, field).includes(post.slug))),
  );
}

/** The fields of an entry with the address `slug` of type `to` taken out of each link (ADR 0052 d4); null when it held none. */
export function unlinked(type: ContentType, fields: Record<string, unknown>, to: string, slug: string): Record<string, unknown> | null {
  let changed = false;
  const out = { ...fields };
  for (const field of linkFields(type, to)) {
    const value = out[field.key];
    if (Array.isArray(value) && value.includes(slug)) {
      out[field.key] = value.filter((v) => v !== slug);
      changed = true;
    }
  }
  return changed ? out : null;
}

/** Whether an entry's field has something to draw: an empty one is left out, and so is a link to entries none of which is there. */
export function fieldShown(field: TypeField, post: Post, lists: Record<string, ListedEntries>): boolean {
  const value = post.fields[field.key];
  switch (field.kind) {
    case 'link':
      return isLink(value as LinkValue | null);
    case 'image':
    case 'file':
      return !!(value as ImageValue | FileValue | null)?.src;
    case 'number':
      return typeof value === 'number';
    case 'yesno':
      return typeof value === 'boolean';
    case 'entries':
      return linkedEntries(post, field, lists).length > 0;
    default:
      return !!value;
  }
}

/** Whether a type's page puts the entries linked to its entry somewhere; if not, they are drawn after it (ADR 0052 d3). */
export const placesRelated = (blocks: Block[]): boolean =>
  blocks.some((block) => (block.type === 'entry' && block.content.part === 'related') || placesRelated(block.children ?? []));
