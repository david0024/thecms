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
import { type Issue, isId, isObject, newId, safeHref, safeSrc, str } from './util.ts';

export type Field =
  | { kind: 'text'; max?: number; multiline?: boolean }
  | { kind: 'richtext' }
  | { kind: 'image' }
  | { kind: 'link' }
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
  group: {
    container: true,
    fields: {},
    create: () => ({}),
  },
} as const satisfies Record<string, BlockDef>;

export type BlockType = keyof typeof BLOCKS;
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

function cleanField(field: Field, raw: unknown): unknown {
  switch (field.kind) {
    case 'text': {
      const value = str(raw, field.max ?? 300);
      return field.multiline ? value : value.replace(/\s*\n\s*/g, ' ');
    }
    case 'richtext':
      return normalizeRichText(raw);
    case 'image': {
      const src = isObject(raw) ? safeSrc(raw.src) : '';
      return src ? ({ src, alt: str((raw as Record<string, unknown>).alt, 300) } satisfies ImageValue) : null;
    }
    case 'link': {
      // Kept while half filled in (a label with no address yet), so an author
      // does not lose what they typed; `isLink` says when it can be followed.
      const label = isObject(raw) ? str(raw.label, 80).trim() : '';
      const href = isObject(raw) ? safeHref(raw.href) : '';
      return label || href ? ({ label, href } satisfies LinkValue) : null;
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
