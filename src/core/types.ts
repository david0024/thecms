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
import { cleanFile, cleanImage, cleanLink } from './blocks.ts';
import { isObject, slugify, str } from './util.ts';

/** What a type's field may hold (ADR 0010 d4, ADR 0052 d1 and d5). */
export const TYPE_FIELD_KINDS = ['text', 'longtext', 'number', 'date', 'yesno', 'choice', 'image', 'file', 'link', 'entries'] as const;
export type TypeFieldKind = (typeof TYPE_FIELD_KINDS)[number];

/** The most entries one link field holds (ADR 0052 d1). */
export const MAX_LINKED = 20;
/** The most choices a choice field offers (ADR 0052 d5). */
export const MAX_CHOICES = 30;

export interface TypeField {
  /** How the value is stored in an entry. Made from the label once, then kept, so renaming a field loses nothing. */
  key: string;
  label: string;
  kind: TypeFieldKind;
  /** A choice field's choices, in the order offered. */
  options?: string[];
  /** A link field's type: the entries it links to (ADR 0052 d1). */
  to?: string;
  /** A link field holds several entries, up to {@link MAX_LINKED}; otherwise one. */
  many?: true;
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
  /** The layout its entries and lists are drawn in (ADR 0035); absent: the standard one. */
  layout?: string;
  /** Visitors may comment on its entries, and what the owner approves is shown under each (ADR 0040). */
  comments?: true;
  /** Its name, address and words in the site's other languages (ADR 0054 d3). */
  translations?: Record<string, TypeTranslation>;
}

const TYPE_LANGUAGE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

/** A type's name, address and words in each language, cleaned (ADR 0054 d3). */
export function normalizeTypeTranslations(input: unknown): Record<string, TypeTranslation> {
  const out: Record<string, TypeTranslation> = {};
  for (const [language, raw] of Object.entries(isObject(input) ? input : {}).slice(0, 60)) {
    if (!TYPE_LANGUAGE.test(language) || !isObject(raw)) continue;
    const words: Record<string, string> = {};
    for (const [from, to] of Object.entries(isObject(raw.words) ? raw.words : {}).slice(0, 500)) {
      const key = str(from, 60).replace(/\s+/g, ' ').trim();
      const value = str(to, 60).replace(/\s+/g, ' ').trim();
      if (key && value && value !== key) words[key] = value;
    }
    out[language] = {
      name: str(raw.name, 60).replace(/\s+/g, ' ').trim(),
      singular: str(raw.singular, 60).replace(/\s+/g, ' ').trim(),
      path: slugify(raw.path),
      words,
    };
  }
  return out;
}

/** A content type in one other language (ADR 0054 d3). Empty: the main language's. */
export interface TypeTranslation {
  name: string;
  singular: string;
  /** Its address after the language's prefix: `jurnal`, at `/ro/jurnal/`. */
  path: string;
  /** Its categories, tags and choices in that language, by how the main language writes them: `Restoration` → `Restaurare`. */
  words: Record<string, string>;
}

/** The blog a new site starts with, and the type a site made before ADR 0025 kept its posts in. */
export const POSTS_TYPE = 'posts';
/** Where that blog lives. */
export const BLOG_SLUG = 'blog';
/** Addresses the site itself uses, whatever types it has. */
export const RESERVED_SLUGS: readonly string[] = ['media', 'assets', 'admin', 'author'];

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
    const kind = isKind(raw.kind) ? raw.kind : 'text';
    const field: TypeField = { key, label, kind };
    if (kind === 'choice') field.options = choicesOf(raw.options);
    if (kind === 'entries') {
      field.to = slugify(raw.to);
      if (raw.many === true) field.many = true;
    }
    out.push(field);
  }
  return out;
}

/** A choice field's choices: one per line or one per item, each once, none empty. */
function choicesOf(input: unknown): string[] {
  const given = Array.isArray(input) ? input : typeof input === 'string' ? input.split('\n') : [];
  const out: string[] = [];
  for (const raw of given) {
    const choice = str(raw, 60).replace(/\s+/g, ' ').trim();
    if (choice && !out.includes(choice) && out.length < MAX_CHOICES) out.push(choice);
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
      ...(slugify(raw.layout) ? { layout: slugify(raw.layout) } : {}),
      ...(raw.comments === true ? { comments: true as const } : {}),
      ...(isObject(raw.translations) && Object.keys(raw.translations).length ? { translations: normalizeTypeTranslations(raw.translations) } : {}),
    });
  }
  // A link field leads to a type the site has; one whose type is gone goes with it (ADR 0052 d1).
  for (const type of out) type.fields = type.fields.filter((field) => field.kind !== 'entries' || ids.has(field.to ?? ''));
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
    else if (field.kind === 'number') out[field.key] = numberOf(value);
    else if (field.kind === 'yesno') out[field.key] = typeof value === 'boolean' ? value : null;
    else if (field.kind === 'choice') out[field.key] = typeof value === 'string' && field.options?.includes(value) ? value : '';
    else if (field.kind === 'image') out[field.key] = cleanImage(value);
    else if (field.kind === 'file') out[field.key] = cleanFile('document', value);
    else if (field.kind === 'entries') out[field.key] = linkedOf(value, field.many ? MAX_LINKED : 1);
    else out[field.key] = cleanLink(value);
  }
  return out;
}

/** A number as typed or stored, or null: `12,5` is read as `12.5`, as many languages write it. */
function numberOf(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value.trim().replace(',', '.')) : Number.NaN;
  return Number.isFinite(n) ? n : null;
}

/** The addresses of linked entries: each once, in the order given, at most `max`. */
function linkedOf(value: unknown, max: number): string[] {
  const out: string[] = [];
  for (const raw of Array.isArray(value) ? value : []) {
    const slug = slugify(raw);
    if (slug && !out.includes(slug) && out.length < max) out.push(slug);
  }
  return out;
}
