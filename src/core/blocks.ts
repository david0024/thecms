/**
 * The block vocabulary: one list (ADR 0001 d7).
 *
 * The editor offers exactly these types and the renderer draws exactly these;
 * `test/contract.test.ts` fails when the two disagree. Adding a type means
 * adding it here first.
 *
 * Each type declares its content as typed fields. Cleaning untrusted input and,
 * later, the editor's forms both come from that one declaration, so they cannot
 * drift apart.
 */
import { normalizeRichText, paragraphs, type RichText, richTextPlain } from './richtext.ts';
import { type BlockStyle, isTokenName, normalizeStyle } from './style.ts';
import { POSTS_TYPE } from './types.ts';
import { type Issue, isId, isObject, newId, safeHref, safeSrc, slugify, str } from './util.ts';

export type Field =
  | { kind: 'text'; max?: number; multiline?: boolean }
  | { kind: 'richtext' }
  | { kind: 'image' }
  | { kind: 'link' }
  /** The name of a content type: where a block that lists entries takes them from. */
  | { kind: 'source' }
  | { kind: 'number'; min: number; max: number }
  /** Which part of an entry a block of an entry's page shows (ADR 0015): its title, its date, one of its fields. */
  | { kind: 'part' }
  | { kind: 'list'; max: number; item: Record<string, Field> };

export interface ImageValue {
  src: string;
  alt: string;
}
export interface LinkValue {
  label: string;
  href: string;
}

/** A link a visitor can follow: it has words and an address. */
export const isLink = (v: LinkValue | null | undefined): v is LinkValue => !!v && !!v.label && !!v.href;

export interface BlockDef {
  /** Holds other blocks in `children`. */
  container?: true;
  fields: Record<string, Field>;
  /** What a block of this type holds when the author adds it. */
  create: () => Record<string, unknown>;
}

const text = (max = 300): Field => ({ kind: 'text', max });
const multiline = (max = 2000): Field => ({ kind: 'text', max, multiline: true });

export const BLOCKS = {
  hero: {
    fields: {
      eyebrow: text(120),
      title: text(200),
      subtitle: multiline(600),
      image: { kind: 'image' },
      action: { kind: 'link' },
      secondaryAction: { kind: 'link' },
    },
    create: () => ({ title: 'A headline that says what you do', subtitle: 'One or two sentences that say for whom.' }),
  },
  text: {
    fields: { body: { kind: 'richtext' } },
    create: () => ({ body: paragraphs('Write here.') }),
  },
  image: {
    fields: { image: { kind: 'image' }, caption: text(300) },
    create: () => ({}),
  },
  services: {
    fields: {
      title: text(200),
      intro: multiline(600),
      items: { kind: 'list', max: 24, item: { title: text(120), text: multiline(600) } },
    },
    create: () => ({
      title: 'What we do',
      items: [
        { title: 'First service', text: 'What it is, in a sentence.' },
        { title: 'Second service', text: 'What it is, in a sentence.' },
        { title: 'Third service', text: 'What it is, in a sentence.' },
      ],
    }),
  },
  contact: {
    fields: { title: text(200), text: multiline(600), email: text(254), phone: text(40), address: multiline(300) },
    create: () => ({ title: 'Get in touch' }),
  },
  /** A form a visitor writes to the owner with (ADR 0019): a name, an address to answer, the message, and consent to keep it. */
  form: {
    fields: { title: text(200), intro: multiline(600), consent: multiline(600), button: text(60), sent: text(300), failed: text(300) },
    create: () => ({
      title: 'Write to us',
      consent: 'I agree that what I write here is kept to answer me, and deleted after that.',
      button: 'Send',
      sent: 'Thank you. Your message was sent; we will answer soon.',
      failed: 'The message could not be sent. Please try again, or write to us by email.',
    }),
  },
  gallery: {
    fields: {
      title: text(200),
      intro: multiline(600),
      images: { kind: 'list', max: 48, item: { image: { kind: 'image' }, caption: text(300) } },
    },
    create: () => ({ title: 'Our work', images: [] }),
  },
  faq: {
    fields: {
      title: text(200),
      intro: multiline(600),
      items: { kind: 'list', max: 40, item: { question: text(300), answer: multiline(3000) } },
    },
    create: () => ({
      title: 'Questions people ask',
      items: [
        { question: 'A question people ask often?', answer: 'The answer, in a few sentences.' },
        { question: 'Another question?', answer: 'Its answer.' },
      ],
    }),
  },
  testimonials: {
    fields: {
      title: text(200),
      items: { kind: 'list', max: 24, item: { quote: multiline(1000), name: text(120), role: text(120), photo: { kind: 'image' } } },
    },
    create: () => ({
      title: 'What clients say',
      items: [
        { quote: 'What a client said about working with you, in their words.', name: 'A client', role: 'Their company' },
        { quote: 'Another client, another sentence.', name: 'Another client', role: '' },
      ],
    }),
  },
  pricing: {
    fields: {
      title: text(200),
      intro: multiline(600),
      plans: {
        kind: 'list',
        max: 6,
        item: { name: text(120), price: text(40), period: text(40), text: multiline(600), features: multiline(2000), action: { kind: 'link' } },
      },
    },
    create: () => ({
      title: 'Prices',
      plans: [
        { name: 'Basic', price: '€100', period: 'per month', features: 'What is included\nAnother thing' },
        { name: 'Full', price: '€200', period: 'per month', features: 'Everything in Basic\nOne more thing' },
      ],
    }),
  },
  entries: {
    fields: { title: text(200), source: { kind: 'source' }, count: { kind: 'number', min: 1, max: 24 }, more: text(80) },
    create: () => ({ title: 'Latest posts', source: POSTS_TYPE, count: 3, more: 'See all' }),
  },
  /** A part of the entry being shown, on the page a content type designs for its entries (ADR 0015). Draws nothing anywhere else. */
  entry: {
    fields: { part: { kind: 'part' } },
    create: () => ({ part: 'header' }),
  },
  group: {
    container: true,
    fields: {},
    create: () => ({}),
  },
} as const satisfies Record<string, BlockDef>;

export type BlockType = keyof typeof BLOCKS;

/**
 * The parts of an entry a page can show: everything above its own blocks as
 * the default page draws it (`header`), each piece of that alone, the
 * entry's own blocks (`body`), or one field of its type (`field:client`).
 */
export const ENTRY_PARTS = ['header', 'title', 'meta', 'cover', 'fields', 'body'] as const;
export const ENTRY_PART = /^(header|title|meta|cover|fields|body|field:[a-z0-9_]{1,40})$/;

/** What a type's page starts as when the owner first opens it: the default page, as blocks to change. */
export const defaultTemplate = (): Block[] => [
  { id: newId(), type: 'entry', content: { part: 'header' } },
  { id: newId(), type: 'entry', content: { part: 'body' } },
];
export const BLOCK_TYPES = Object.keys(BLOCKS) as BlockType[];

export const isBlockType = (v: unknown): v is BlockType => typeof v === 'string' && Object.hasOwn(BLOCKS, v);

export const isContainerType = (type: BlockType): boolean => (BLOCKS[type] as BlockDef).container === true;

export interface Block {
  id: string;
  type: BlockType;
  /** What the block says. Never a colour, a size or markup. */
  content: Record<string, unknown>;
  /** How this block departs from the theme. Left out when empty. */
  style?: BlockStyle;
  /** One of the theme's named variants for this type. */
  variant?: string;
  /** Only on a container. */
  children?: Block[];
}

const MAX_BLOCKS = 500;
/** How deep blocks nest: a block at the top is at depth 1. */
export const MAX_DEPTH = 4;

/** An image a page may show, or null: its address is checked, its description cut to length. */
export function cleanImage(raw: unknown): ImageValue | null {
  const src = isObject(raw) ? safeSrc(raw.src) : '';
  return src ? { src, alt: str((raw as Record<string, unknown>).alt, 300) } : null;
}

/**
 * A link, or null. Kept while half filled in (a label with no address yet), so
 * an author does not lose what they typed; `isLink` says when it can be followed.
 */
export function cleanLink(raw: unknown): LinkValue | null {
  const label = isObject(raw) ? str(raw.label, 80).trim() : '';
  const href = isObject(raw) ? safeHref(raw.href) : '';
  return label || href ? { label, href } : null;
}

function cleanField(field: Field, raw: unknown): unknown {
  switch (field.kind) {
    case 'text': {
      const value = str(raw, field.max ?? 300);
      return field.multiline ? value : value.replace(/\s*\n\s*/g, ' ');
    }
    case 'richtext':
      return normalizeRichText(raw);
    case 'image':
      return cleanImage(raw);
    case 'link':
      return cleanLink(raw);
    case 'source':
      return slugify(raw) || POSTS_TYPE;
    case 'part': {
      const value = str(raw, 60);
      return ENTRY_PART.test(value) ? value : 'header';
    }
    case 'number': {
      const n = Math.round(Number(raw));
      return Number.isFinite(n) ? Math.min(field.max, Math.max(field.min, n)) : field.min;
    }
    case 'list':
      return Array.isArray(raw)
        ? raw.slice(0, field.max).map((item) => cleanFields(field.item, isObject(item) ? item : {}))
        : [];
  }
}

function cleanFields(fields: Record<string, Field>, raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(fields)) out[name] = cleanField(field, raw[name]);
  return out;
}

/**
 * Untrusted input as clean blocks. A block of an unknown type is dropped and
 * reported, a content key the type does not declare is dropped silently, and
 * every block leaves with an id that is unique in the tree.
 */
export function normalizeBlocks(input: unknown): { blocks: Block[]; issues: Issue[] } {
  const issues: Issue[] = [];
  const seen = new Set<string>();
  let count = 0;

  const walk = (list: unknown, path: string, depth: number): Block[] => {
    if (!Array.isArray(list)) return [];
    const out: Block[] = [];
    list.forEach((raw, i) => {
      const at = `${path}[${i}]`;
      if (!isObject(raw) || !isBlockType(raw.type)) {
        issues.push({ path: at, message: 'not a known block type' });
        return;
      }
      if (++count > MAX_BLOCKS) {
        if (count === MAX_BLOCKS + 1) issues.push({ path: at, message: `a page holds at most ${MAX_BLOCKS} blocks` });
        return;
      }
      const def: BlockDef = BLOCKS[raw.type];
      const id = isId(raw.id) && !seen.has(raw.id) ? raw.id : newId();
      seen.add(id);
      const block: Block = {
        id,
        type: raw.type,
        content: cleanFields(def.fields, isObject(raw.content) ? raw.content : {}),
      };
      const { style, issues: found } = normalizeStyle(raw.style, `${at}.style`);
      issues.push(...found);
      if (Object.keys(style).length) block.style = style;
      if (isTokenName(raw.variant)) block.variant = raw.variant;
      if (def.container) {
        if (depth >= MAX_DEPTH) issues.push({ path: at, message: `blocks nest at most ${MAX_DEPTH} deep` });
        block.children = depth >= MAX_DEPTH ? [] : walk(raw.children, `${at}.children`, depth + 1);
      }
      out.push(block);
    });
    return out;
  };

  return { blocks: walk(input, 'blocks', 1), issues };
}

/** A new block of this type, as the editor adds it. */
export function createBlock(type: BlockType): Block {
  const def: BlockDef = BLOCKS[type];
  const { blocks } = normalizeBlocks([{ type, content: def.create(), children: [] }]);
  return blocks[0] as Block;
}

function fieldText(field: Field, value: unknown): string {
  switch (field.kind) {
    case 'text':
      return typeof value === 'string' ? value : '';
    case 'richtext':
      return richTextPlain((value as RichText) ?? []);
    case 'list':
      return Array.isArray(value)
        ? value.map((item) => Object.entries(field.item).map(([k, f]) => fieldText(f, (item as Record<string, unknown>)[k])).join(' ')).join(' ')
        : '';
    default:
      return '';
  }
}

/** The words of a page, for a meta description or a search index. */
export function blocksText(blocks: Block[], max = 160): string {
  const parts: string[] = [];
  const walk = (list: Block[]): void => {
    for (const b of list) {
      const def: BlockDef = BLOCKS[b.type];
      for (const [name, field] of Object.entries(def.fields)) parts.push(fieldText(field, b.content[name]));
      if (b.children) walk(b.children);
    }
  };
  walk(blocks);
  const all = parts.join(' ').replace(/\s+/g, ' ').trim();
  return all.length > max ? `${all.slice(0, max).replace(/\s+\S*$/, '')}…` : all;
}

/** The address of every image on a page, as written: for knowing which stored images a page uses. */
export function imageSources(blocks: Block[]): string[] {
  const out: string[] = [];
  const collect = (fields: Record<string, Field>, content: Record<string, unknown>): void => {
    for (const [name, field] of Object.entries(fields)) {
      const value = content[name];
      if (field.kind === 'image' && isObject(value) && typeof value.src === 'string') out.push(value.src);
      else if (field.kind === 'list' && Array.isArray(value)) for (const item of value) if (isObject(item)) collect(field.item, item);
    }
  };
  const walk = (list: Block[]): void => {
    for (const b of list) {
      collect((BLOCKS[b.type] as BlockDef).fields, b.content);
      if (b.children) walk(b.children);
    }
  };
  walk(blocks);
  return out;
}
