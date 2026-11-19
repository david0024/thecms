/**
 * Content types (ADR 0010): the kinds of entry a site keeps besides pages.
 *
 * A type is a name, an address and a few choices: whether its entries are
 * dated, grouped by category, offered as a feed, and which extra fields each
 * one carries. None is built in (ADR 0025): a blog, products, articles or a
 * vlog are all types the owner names, shapes and may remove. A new site starts
 * with a blog as an example.
 *
 * An entry of any type is the same document: a title, blocks, and the fields
 * its type asks for. So the editor, the store and the export treat every type
 * alike, and a type is data, not code.
 */
import { cleanImage, cleanLink } from './blocks.ts';
import { isObject, slugify, str } from './util.ts';

export const TYPE_FIELD_KINDS = ['text', 'longtext', 'date', 'image', 'link'] as const;
export type TypeFieldKind = (typeof TYPE_FIELD_KINDS)[number];

export interface TypeField {
  /** How the value is stored in an entry. Made from the label once, then kept, so renaming a field loses nothing. */
  key: string;
  label: string;
  kind: TypeFieldKind;
}

export interface ContentType {
  /** Stable name entries are stored under. */
  id: string;
  /** "Projects": the heading of the list, the section in the admin, the label in the menu. */
  name: string;
  /** "Project". */
  singular: string;
  /** Where it lives: `/projects/`, and each entry at `/projects/<slug>/`. */
  path: string;
  /** Entries carry a date and are listed newest first. Otherwise they are listed by title. */
  dated: boolean;
  categories: boolean;
  feed: boolean;
  fields: TypeField[];
}

/** The blog a new site starts with, and the type a site made before ADR 0025 kept its posts in. */
export const POSTS_TYPE = 'posts';
/** Where that blog lives. */
export const BLOG_SLUG = 'blog';
/** Addresses the site itself uses, whatever types it has. */
export const RESERVED_SLUGS: readonly string[] = ['media', 'assets'];

export const MAX_TYPES = 12;
export const MAX_TYPE_FIELDS = 12;

/** The blog: dated, with categories and a feed. A type like any other, which the owner may rename or remove. */
export const postsType = (name = 'Blog'): ContentType => ({
  id: POSTS_TYPE,
  name,
  singular: 'Post',
  path: BLOG_SLUG,
  dated: true,
  categories: true,
  feed: true,
  fields: [],
});

const isKind = (v: unknown): v is TypeFieldKind => TYPE_FIELD_KINDS.includes(v as TypeFieldKind);
/** `Client name` → `client_name`. */
const keyOf = (value: unknown): string => slugify(value).replace(/-/g, '_').slice(0, 40);

function cleanFields(input: unknown): TypeField[] {
  const out: TypeField[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(input) ? input : []) {
    if (!isObject(raw) || out.length >= MAX_TYPE_FIELDS) continue;
    const label = str(raw.label, 60).replace(/\s+/g, ' ').trim();
    const key = keyOf(raw.key) || keyOf(label);
    if (!label || !key || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, label, kind: isKind(raw.kind) ? raw.kind : 'text' });
  }
  return out;
}

/**
 * Untrusted input as the types an owner added. One whose name or address is
 * taken (by the site, by posts, by an earlier type) is left out: two types
 * can never answer at one address.
 */
export function normalizeTypes(input: unknown): ContentType[] {
  const out: ContentType[] = [];
  const ids = new Set<string>(['page', 'post']);
  const paths = new Set<string>(RESERVED_SLUGS);
  for (const raw of Array.isArray(input) ? input : []) {
    if (!isObject(raw) || out.length >= MAX_TYPES) continue;
    const name = str(raw.name, 60).replace(/\s+/g, ' ').trim();
    const id = slugify(raw.id) || slugify(name);
    const path = slugify(raw.path) || slugify(name);
    if (!name || !id || !path || ids.has(id) || paths.has(path)) continue;
    ids.add(id);
    paths.add(path);
    out.push({
      id,
      name,
      singular: str(raw.singular, 60).replace(/\s+/g, ' ').trim() || name,
      path,
      dated: raw.dated === true,
      categories: raw.categories === true,
      feed: raw.feed === true && raw.dated === true,
      fields: cleanFields(raw.fields),
    });
  }
  return out;
}

/** What an entry holds for its type's extra fields: each value checked as its kind, nothing the type does not ask for. */
export function cleanTypeFields(type: ContentType, input: unknown, isDate: (v: unknown) => boolean): Record<string, unknown> {
  const raw = isObject(input) ? input : {};
  const out: Record<string, unknown> = {};
  for (const field of type.fields) {
    const value = raw[field.key];
    if (field.kind === 'text') out[field.key] = str(value, 300).replace(/\s*\n\s*/g, ' ').trim();
    else if (field.kind === 'longtext') out[field.key] = str(value, 2000).trim();
    else if (field.kind === 'date') out[field.key] = isDate(value) ? value : '';
    else if (field.kind === 'image') out[field.key] = cleanImage(value);
    else out[field.key] = cleanLink(value);
  }
  return out;
}
