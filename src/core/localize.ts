/**
 * A page in another language, field by field (ADR 0032).
 *
 * A page's layout, pictures and prices exist once. Each text it holds (a
 * block's title, an item of a list, a picture's description, a link's words)
 * may have a value in each of the site's other languages, kept on the page by
 * where it is: the block's id and the field's path (`b_1a2b.items.2.text`).
 * The page is drawn in a language by putting those values over it; a field
 * with none shows the main language's words.
 *
 * A page split for a language (ADR 0032 d4) is the exception: it keeps its
 * own blocks there, as a copy that no longer follows the main page.
 */
import { BLOCKS, type Block, type BlockDef, type Field, normalizeBlocks } from './blocks.ts';
import type { Page, Site } from './page.ts';
import { normalizeRichText, type RichText, richTextPlain } from './richtext.ts';
import { baseSlug, languageOf, slugIn } from './translation.ts';
import { isObject, slugify, str } from './util.ts';

/** What a translated field holds: words, or rich text. */
export type Words = string | RichText;

/** A page in one other language. */
export interface PageTranslation {
  /** Its address after the language's prefix: `despre` for `about`. Empty: the main page's. */
  slug: string;
  /** Empty: the main page's. */
  title: string;
  description: string;
  /** Each translated field's value, by where it is. */
  fields: Record<string, Words>;
  /** Split for this language: its own blocks, which no longer follow the main page's. */
  blocks: Block[] | null;
}

/** A page as visitors find it: in one language, and of one page of the main language. */
export interface PlacedPage extends Page {
  /** The main page's address: what the menu and the language switcher go by. */
  of: string;
  language: string;
  /** A translation of `of` (not the main page itself, nor a page only in this language). */
  translated: boolean;
  /** Split for this language (ADR 0032 d4). */
  split: boolean;
}

const MAX_FIELDS = 3000;
const KEY = /^[A-Za-z0-9_-]{1,40}(\.[A-Za-z0-9_]{1,40}){1,6}$/;
const LANGUAGE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

const isEmpty = (value: unknown): boolean => (Array.isArray(value) ? richTextPlain(value as RichText).trim() === '' : typeof value !== 'string' || value.trim() === '');

/** One translated field: where it is, its value, and how to put another value there. */
interface Spot {
  key: string;
  value: Words;
  set: (value: Words) => void;
}

/** Every translated field of these blocks, in order (ADR 0032 d1). */
function spots(blocks: Block[]): Spot[] {
  const out: Spot[] = [];
  const fields = (defs: Record<string, Field>, content: Record<string, unknown>, at: string): void => {
    for (const [name, field] of Object.entries(defs)) {
      const key = `${at}.${name}`;
      const value = content[name];
      if (field.kind === 'text' && !field.common) out.push({ key, value: typeof value === 'string' ? value : '', set: (v) => (content[name] = v) });
      else if (field.kind === 'richtext') out.push({ key, value: Array.isArray(value) ? (value as RichText) : [], set: (v) => (content[name] = v) });
      else if ((field.kind === 'image' && isObject(value)) || (field.kind === 'link' && isObject(value))) {
        const part = field.kind === 'image' ? 'alt' : 'label';
        out.push({ key: `${key}.${part}`, value: typeof value[part] === 'string' ? value[part] : '', set: (v) => (value[part] = v) });
      } else if (field.kind === 'list' && Array.isArray(value)) value.forEach((item, i) => isObject(item) && fields(field.item, item, `${key}.${i}`));
    }
  };
  const walk = (list: Block[]): void => {
    for (const block of list) {
      fields((BLOCKS[block.type] as BlockDef).fields, block.content, block.id);
      if (block.children) walk(block.children);
    }
  };
  walk(blocks);
  return out;
}

/** The blocks with these values over their own; a field with none keeps its words. */
export function localizeBlocks(blocks: Block[], words: Record<string, Words>): Block[] {
  const copy = structuredClone(blocks);
  for (const spot of spots(copy)) {
    const value = words[spot.key];
    if (value !== undefined && !isEmpty(value)) spot.set(value);
  }
  return normalizeBlocks(copy).blocks;
}

/** The blocks with every translated field emptied: what every language shares. */
const layout = (blocks: Block[]): string => {
  const copy = structuredClone(blocks);
  for (const spot of spots(copy)) spot.set(Array.isArray(spot.value) ? [] : '');
  return JSON.stringify(copy);
};

/**
 * The words of a translation, read from the page as it was written in that
 * language, or why they cannot be: its blocks are not the main page's
 * (ADR 0032 d3). A value the same as the main language's is not kept.
 */
export function wordsFrom(main: Block[], written: Block[]): { fields: Record<string, Words>; problem: string } {
  if (layout(main) !== layout(written)) return { fields: {}, problem: 'a translation has the blocks of the main page: add, move or remove blocks, or change a picture, there; or split the page for this language' };
  const own = new Map(spots(main).map((s) => [s.key, JSON.stringify(s.value)]));
  const fields: Record<string, Words> = {};
  for (const spot of spots(written)) if (!isEmpty(spot.value) && own.get(spot.key) !== JSON.stringify(spot.value)) fields[spot.key] = spot.value;
  return { fields, problem: '' };
}

/** What a translation does not say yet, so that the main language's words show (ADR 0032 d6). */
export function missingWords(page: Page, translation: PageTranslation): string[] {
  if (translation.blocks) return [];
  const out: string[] = [];
  if (page.title && !translation.title) out.push('title');
  if (page.description && !translation.description) out.push('description');
  for (const spot of spots(page.blocks)) if (!isEmpty(spot.value) && isEmpty(translation.fields[spot.key])) out.push(spot.key);
  return out;
}

/** An empty translation: the page in that language, all in the main language's words until it is written. */
export const newTranslation = (): PageTranslation => ({ slug: '', title: '', description: '', fields: {}, blocks: null });

function normalizeTranslation(raw: Record<string, unknown>): PageTranslation {
  const fields: Record<string, Words> = {};
  for (const [key, value] of Object.entries(isObject(raw.fields) ? raw.fields : {}).slice(0, MAX_FIELDS)) {
    if (!KEY.test(key)) continue;
    if (typeof value === 'string') fields[key] = str(value, 3000);
    else if (Array.isArray(value)) fields[key] = normalizeRichText(value);
  }
  return {
    slug: slugify(raw.slug),
    title: str(raw.title, 200).trim(),
    description: str(raw.description, 300).trim(),
    fields,
    blocks: Array.isArray(raw.blocks) ? normalizeBlocks(raw.blocks).blocks : null,
  };
}

/** A page's translations, by language, cleaned. Which languages the site has is the site's to say, when the page is placed. */
export function normalizeTranslations(input: unknown): Record<string, PageTranslation> {
  const out: Record<string, PageTranslation> = {};
  for (const [language, raw] of Object.entries(isObject(input) ? input : {}).slice(0, 60)) {
    if (LANGUAGE.test(language) && isObject(raw)) out[language] = normalizeTranslation(raw);
  }
  return out;
}

/** Where a page is in a language: `ro/despre`, or `ro` for the home page. */
export const translatedSlug = (site: Site, page: Page, language: string): string => slugIn(site, language, page.slug === '' ? '' : page.translations?.[language]?.slug || page.slug);

/** A page in one of the site's other languages: its words over the main page, or its own blocks when it is split. */
export function translatedPage(site: Site, page: Page, language: string): PlacedPage | null {
  const translation = page.translations?.[language];
  if (!translation || !site.languages.includes(language)) return null;
  return {
    slug: translatedSlug(site, page, language),
    title: translation.title || page.title,
    description: translation.description || (translation.blocks ? '' : page.description),
    inMenu: page.inMenu,
    ...(page.layout ? { layout: page.layout } : {}),
    blocks: translation.blocks ?? localizeBlocks(page.blocks, translation.fields),
    translations: {},
    of: page.slug,
    language,
    translated: true,
    split: translation.blocks !== null,
  };
}

/**
 * Every page as visitors find it, in order: each main page, then its
 * translations; a page that exists only in another language as it is. An
 * address taken twice goes to the first: a page kept at it, then the
 * translation that came first.
 */
export function placePages(site: Site, pages: Page[]): PlacedPage[] {
  const kept = new Set(pages.map((p) => p.slug));
  const out: PlacedPage[] = [];
  for (const page of pages) {
    const language = languageOf(site, page.slug);
    out.push({ ...page, translations: {}, of: baseSlug(site, page.slug), language, translated: false, split: false });
    if (language !== site.language) continue;
    for (const other of site.languages) {
      const translated = translatedPage(site, page, other);
      if (!translated || kept.has(translated.slug)) continue;
      kept.add(translated.slug);
      out.push(translated);
    }
  }
  return out;
}

/** The words that still have a place in these blocks: those of a block removed since are dropped. */
export function keepWords(blocks: Block[], words: Record<string, Words>): Record<string, Words> {
  const keys = new Set(spots(blocks).map((s) => s.key));
  return Object.fromEntries(Object.entries(words).filter(([key]) => keys.has(key)));
}

/**
 * These blocks with only their translated places taken from `from` (ADR 0034):
 * what an action gives back for a translation changes its words, never the
 * layout, the pictures, the prices or the addresses every language shares.
 */
export function takeWords(blocks: Block[], from: Block[]): Block[] {
  return localizeBlocks(blocks, Object.fromEntries(spots(from).map((s) => [s.key, s.value])));
}

/**
 * A translation with what it does not say yet taken from `written` (ADR 0034):
 * the words a person already wrote stay as they are.
 */
export function fillTranslation(page: Page, translation: PageTranslation, written: Page): PageTranslation {
  const { fields } = wordsFrom(page.blocks, takeWords(page.blocks, written.blocks));
  const title = written.title && written.title !== page.title ? written.title : '';
  const description = written.description && written.description !== page.description ? written.description : '';
  return {
    ...translation,
    title: translation.title || title,
    description: translation.description || (page.description ? description : ''),
    fields: { ...fields, ...Object.fromEntries(Object.entries(translation.fields).filter(([, value]) => !isEmpty(value))) },
  };
}
