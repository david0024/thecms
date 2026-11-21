/**
 * Entries in more than one language (ADR 0054), as pages are (ADR 0032):
 * field by field. An entry's date, pictures, numbers, choices and links to
 * other entries exist once; its title, summary, words and each text field have
 * a value in each language it is translated into. Its type says once, for each
 * language, its name, its address, and how its categories, tags and choices
 * are written there.
 *
 * In another language an entry exists once it is translated: a list shows only
 * the entries started in its language (owner, 2026-11-21).
 */
import { localizeBlocks, missingWords, takeWords, type Words, wordsFrom } from './localize.ts';
import type { Page, Site } from './page.ts';
import { type EntryTranslation, entryPath, listPath, type Post } from './post.ts';
import { type Alternate, prefixOf } from './translation.ts';
import type { ContentType, TypeTranslation } from './types.ts';
import { isObject } from './util.ts';

/** Where the cover's description is kept among a translation's values. */
export const COVER_ALT = '@cover.alt';

/** An empty translation: the entry in that language, in the main language's words until it is written. */
export const newEntryTranslation = (): EntryTranslation => ({ slug: '', title: '', description: '', excerpt: '', fields: {}, values: {}, blocks: null });

/** A word of a type (a category, a tag, a choice) in a language: as the type says, or as it is. */
export const wordIn = (type: ContentType, language: string, word: string): string => type.translations?.[language]?.words[word] || word;

/**
 * A type as it is in a language: its name and address there (`/ro/jurnal/`),
 * its choices in that language's words. Its id stays, so what names the type
 * (a list block, a comment, a link field) still finds it.
 */
export function typeIn(site: Site, type: ContentType, language: string): ContentType {
  if (language === site.language) return type;
  const own = type.translations?.[language];
  return {
    ...type,
    name: own?.name || type.name,
    singular: own?.singular || type.singular,
    path: `${prefixOf(language)}/${own?.path || type.path}`,
    fields: type.fields.map((field) => (field.options ? { ...field, options: field.options.map((o) => wordIn(type, language, o)) } : field)),
  };
}

/** The address an entry has in a language, after its type's: its own, or the main entry's. */
export const entrySlugIn = (post: Post, language: string): string => post.translations?.[language]?.slug || post.slug;

/** A type field's words in an entry: where each is, and what it says in the main language. */
function valueSpots(type: ContentType, post: Post): { key: string; value: string }[] {
  const out: { key: string; value: string }[] = [];
  if (post.cover?.alt) out.push({ key: COVER_ALT, value: post.cover.alt });
  for (const field of type.fields) {
    const value = post.fields[field.key];
    if ((field.kind === 'text' || field.kind === 'longtext') && typeof value === 'string' && value) out.push({ key: field.key, value });
    else if (field.kind === 'image' && isObject(value) && typeof value.alt === 'string' && value.alt) out.push({ key: `${field.key}.alt`, value: value.alt });
    else if ((field.kind === 'link' || field.kind === 'file') && isObject(value) && typeof value.label === 'string' && value.label) out.push({ key: `${field.key}.label`, value: value.label });
  }
  return out;
}

/** Puts a value at a value's key in an entry's fields (or its cover). */
function setValue(post: Post, key: string, value: string): void {
  if (key === COVER_ALT) {
    if (post.cover) post.cover = { ...post.cover, alt: value };
    return;
  }
  const [name, part] = key.split('.') as [string, string | undefined];
  if (!part) post.fields[name] = value;
  else if (isObject(post.fields[name])) post.fields[name] = { ...post.fields[name], [part]: value };
}

/** Reads a value at a value's key from an entry. */
function getValue(post: Post, key: string): string {
  if (key === COVER_ALT) return post.cover?.alt ?? '';
  const [name, part] = key.split('.') as [string, string | undefined];
  const value = post.fields[name];
  if (!part) return typeof value === 'string' ? value : '';
  return isObject(value) && typeof value[part] === 'string' ? (value[part] as string) : '';
}

/** Entries of each type in a language, by type and main address: their address there. Only the entries translated. */
export type SlugsIn = Record<string, Map<string, string>>;

/** Where each of these entries is in a language: what a link field in that language leads to. */
export function slugsIn(language: string, entries: Record<string, Post[]>): SlugsIn {
  return Object.fromEntries(Object.entries(entries).map(([id, list]) => [id, new Map(list.filter((p) => p.translations?.[language]).map((p) => [p.slug, entrySlugIn(p, language)]))]));
}

/**
 * An entry as it is in another language: its words over the main entry, its
 * own blocks when it is split; its categories, tags and choices in the type's
 * words; its links to the entries translated there. Null when it is not in
 * that language. `of` says which main entry it is.
 */
export function entryIn(site: Site, type: ContentType, post: Post, language: string, slugs: SlugsIn = {}): Post | null {
  if (language === site.language) return post;
  const own = post.translations?.[language];
  if (!own || !site.languages.includes(language)) return null;
  const word = (w: string): string => wordIn(type, language, w);
  const out: Post = {
    ...structuredClone(post),
    slug: entrySlugIn(post, language),
    title: own.title || post.title,
    description: own.description || (own.blocks ? '' : post.description),
    excerpt: own.excerpt || (own.blocks ? '' : post.excerpt),
    categories: post.categories.map(word),
    tags: post.tags.map(word),
    blocks: own.blocks ?? localizeBlocks(post.blocks, own.fields),
    translations: {},
    of: post.slug,
    language,
  };
  // Its own title for search engines; the main entry's only while it shows the main title (ADR 0050 d1).
  if (own.seoTitle) out.seoTitle = own.seoTitle;
  else if (own.title) delete out.seoTitle;
  for (const { key } of valueSpots(type, post)) if (own.values[key]) setValue(out, key, own.values[key] as string);
  for (const field of type.fields) {
    const value = out.fields[field.key];
    if (field.kind === 'choice' && typeof value === 'string' && value) out.fields[field.key] = word(value);
    if (field.kind === 'entries' && Array.isArray(value)) {
      const there = slugs[field.to ?? ''];
      out.fields[field.key] = there ? (value as string[]).flatMap((slug) => (there.has(slug) ? [there.get(slug) as string] : [])) : [];
    }
  }
  return out;
}

/** Every entry of a type in a language, in its type's words: the main entries as they are, or only those translated. */
export function entriesIn(site: Site, type: ContentType, posts: Post[], language: string, slugs: SlugsIn = {}): Post[] {
  return posts.flatMap((post) => entryIn(site, type, post, language, slugs) ?? []);
}

/**
 * A translation as it was written in the editor: the entry in that language,
 * as the editor shows it. What is the same as the main entry is not kept; a
 * translation that is not split keeps the main blocks (ADR 0032 d3).
 */
export function entryTranslationFrom(type: ContentType, main: Post, had: EntryTranslation, written: Post): { translation: EntryTranslation; problem: string } {
  const next: EntryTranslation = {
    slug: written.slug === main.slug ? '' : written.slug,
    title: written.title === main.title ? '' : written.title,
    description: written.description === main.description ? '' : written.description,
    excerpt: written.excerpt === main.excerpt ? '' : written.excerpt,
    ...(written.seoTitle && written.seoTitle !== main.seoTitle ? { seoTitle: written.seoTitle } : {}),
    fields: {},
    values: {},
    blocks: had.blocks ? written.blocks : null,
  };
  for (const { key, value } of valueSpots(type, main)) {
    const there = getValue(written, key).trim();
    if (there && there !== value) next.values[key] = there;
  }
  if (!had.blocks) {
    const { fields, problem } = wordsFrom(main.blocks, written.blocks);
    if (problem) return { translation: had, problem };
    next.fields = fields;
  }
  return { translation: next, problem: '' };
}

/** What an entry's translation does not say yet, so that the main language's words show (ADR 0032 d6). */
export function missingEntryWords(type: ContentType, post: Post, translation: EntryTranslation): string[] {
  const out: string[] = [];
  if (post.title && !translation.title) out.push('title');
  if (post.excerpt && !translation.excerpt && !translation.blocks) out.push('excerpt');
  for (const { key } of valueSpots(type, post)) if (!translation.values[key]) out.push(key);
  if (!translation.blocks) out.push(...missingWords({ slug: post.slug, title: '', description: '', inMenu: false, blocks: post.blocks } as Page, { slug: '', title: 'x', description: 'x', fields: translation.fields, blocks: null }));
  return out;
}

/**
 * A translation with what it does not say yet taken from `written` (ADR 0034
 * d2): the words a person already wrote stay as they are.
 */
export function fillEntryTranslation(type: ContentType, main: Post, had: EntryTranslation, written: Post): EntryTranslation {
  // The answer keeps the main entry's layout, pictures and prices: only its words are read (ADR 0034 d1).
  const shaped: Post = { ...written, slug: main.slug, blocks: takeWords(main.blocks, written.blocks) };
  const { translation: from } = entryTranslationFrom(type, main, newEntryTranslation(), shaped);
  const kept = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => (typeof v === 'string' ? v.trim() !== '' : Array.isArray(v) && v.length > 0)));
  return {
    ...had,
    title: had.title || from.title,
    description: had.description || from.description,
    excerpt: had.excerpt || from.excerpt,
    fields: { ...from.fields, ...(kept(had.fields) as Record<string, Words>) },
    values: { ...from.values, ...had.values },
  };
}

/**
 * Where an entry is in each language, for the switcher and `hreflang`
 * (ADR 0054 d5): its translation, or that language's home page where it has
 * none. `homes` are the site's languages with their home pages.
 */
export function entryAlternates(site: Site, type: ContentType, main: Post, homes: Alternate[], current: string): Alternate[] {
  return homes.map((home) => {
    const here = home.language === site.language || !!main.translations?.[home.language];
    const href = here ? entryPath(typeIn(site, type, home.language), entrySlugIn(main, home.language)) : home.home;
    return { ...home, href: home.language === site.language ? entryPath(type, main.slug) : href, translated: here, current: home.language === current };
  });
}

/** Where a type's list is in each language: there when it has entries in it, that language's home page otherwise. */
export function listAlternates(site: Site, type: ContentType, has: (language: string) => boolean, homes: Alternate[], current: string): Alternate[] {
  return homes.map((home) => {
    const here = has(home.language);
    return { ...home, href: here ? listPath(typeIn(site, type, home.language)) : home.home, translated: here, current: home.language === current };
  });
}
