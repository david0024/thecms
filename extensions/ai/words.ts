/**
 * The words of a block or a page, as places: what a person reads, in order,
 * with where each one is. An address, an image's file, a block's kind and the
 * marks on a word are not words, and are never sent to a model.
 */

export interface Place {
  /** Where the text is, as a reader of the block would name it: `items.2.title`. */
  place: string;
  text: string;
}

export interface Block {
  id: string;
  type: string;
  content: Record<string, unknown>;
  [key: string]: unknown;
}

export interface Page {
  slug: string;
  title: string;
  description: string;
  blocks: Block[];
  [key: string]: unknown;
}

/** Keys whose value is never words: ids, kinds, addresses, files, where entries come from. */
const NOT_WORDS = new Set(['id', 'type', 'href', 'src', 'source', 'part', 'marks', 'level', 'ordered']);
const ADDRESS = /^(https?:|mailto:|tel:|\/|#)/i;

const isWords = (key: string, value: string, empty: boolean): boolean => !NOT_WORDS.has(key) && !ADDRESS.test(value.trim()) && (empty || value.trim() !== '');

/** A span of rich text is named by the paragraph it is in, not by its own keys. */
function inside(path: string, key: string, value: unknown): string {
  const span = key === 'children' || key === 'text' || (key === 'items' && Array.isArray(value) && Array.isArray(value[0]));
  return span ? path : path ? `${path}.${key}` : key;
}

/** Goes through a value, giving each text its place and putting back what `change` makes of it. */
function walk(value: unknown, path: string, key: string, empty: boolean, change: (place: string, text: string) => string): unknown {
  if (typeof value === 'string') return isWords(key, value, empty) ? change(path, value) : value;
  if (Array.isArray(value)) return value.map((v, i) => walk(v, path ? `${path}.${i}` : String(i), key, empty, change));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v, inside(path, k, v), k, empty, change)]));
  }
  return value;
}

/** The texts of a block's content. With `empty`, the places with nothing in them yet too, to be written. */
export function blockWords(block: Block, empty = false): Place[] {
  const out: Place[] = [];
  walk(block.content, '', '', empty, (place, text) => (out.push({ place, text }), text));
  return out;
}

/** The block with its texts replaced, in the order `blockWords` gave them. */
export function withBlockWords(block: Block, texts: string[], empty = false): Block {
  let i = 0;
  const content = walk(block.content, '', '', empty, (_place, text) => texts[i++] ?? text) as Record<string, unknown>;
  return { ...block, content };
}

/** A page's title, its description when it has one, and the words of each block. */
export function pageWords(page: Page): Place[] {
  const out: Place[] = [{ place: 'title', text: page.title }];
  if (page.description.trim()) out.push({ place: 'description', text: page.description });
  page.blocks.forEach((block, n) => {
    for (const { place, text } of blockWords(block)) out.push({ place: `block ${n + 1} (${block.type}) ${place}`, text });
  });
  return out;
}

/** The page with its texts replaced, in the order `pageWords` gave them. */
export function withPageWords(page: Page, texts: string[]): Page {
  let i = 0;
  const title = texts[i++] ?? page.title;
  const description = page.description.trim() ? (texts[i++] ?? page.description) : page.description;
  const blocks = page.blocks.map((block) => {
    const count = blockWords(block).length;
    const next = withBlockWords(block, texts.slice(i, i + count));
    i += count;
    return next;
  });
  return { ...page, title, description, blocks };
}

/** A picture of a block: where its words are, its address, and the words it has. */
export interface Picture {
  /** The path to the picture's object in the block's content: `image`, `items.2.image`. */
  at: string;
  src: string;
  alt: string;
}

/** The pictures of a block's content: every object with an address of the site's library and words of its own (`alt`). */
export function blockPictures(block: Block): Picture[] {
  const out: Picture[] = [];
  const visit = (value: unknown, path: string): void => {
    if (Array.isArray(value)) value.forEach((v, i) => visit(v, path ? `${path}.${i}` : String(i)));
    else if (value && typeof value === 'object') {
      const v = value as Record<string, unknown>;
      if (typeof v.src === 'string' && v.src.startsWith('/media/') && 'alt' in v) out.push({ at: path, src: v.src, alt: String(v.alt ?? '') });
      else for (const [k, inner] of Object.entries(v)) visit(inner, path ? `${path}.${k}` : k);
    }
  };
  visit(block.content, '');
  return out;
}

/** The block with these pictures' words set, by where each is. */
export function withPictureWords(block: Block, words: { at: string; alt: string }[]): Block {
  const content = structuredClone(block.content) as Record<string, unknown>;
  for (const { at, alt } of words) {
    let target: unknown = content;
    for (const key of at.split('.')) target = (target as Record<string, unknown>)?.[key];
    if (target && typeof target === 'object') (target as Record<string, unknown>).alt = alt;
  }
  return { ...block, content };
}

/** A language's name in English, for a model: `ro` is "Romanian". */
export function languageName(tag: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(tag) ?? tag;
  } catch {
    return tag;
  }
}
