import { describe, expect, test } from 'bun:test';
import {
  type Block,
  BLOCK_TYPES,
  blocksCss,
  blocksText,
  countFreeValues,
  createBlock,
  declarations,
  duplicate,
  findById,
  flatten,
  insertAt,
  isFreeValue,
  isLink,
  type LinkValue,
  moveTo,
  normalizeBlocks,
  normalizeRichText,
  normalizeStyle,
  nudge,
  parentIdOf,
  parseTheme,
  removeById,
  resetToTheme,
  safeHref,
  slugify,
  type Theme,
  themeCss,
} from '../src/core/index.ts';
import plain from '../themes/plain.json';
import studio from '../themes/studio.json';

const theme = (input: unknown): Theme => {
  const { theme, issues } = parseTheme(input);
  if (!theme) throw new Error(JSON.stringify(issues));
  return theme;
};

describe('free style values', () => {
  test('accepts plain colours, lengths and known names', async () => {
    expect(isFreeValue('color', '#0a7')).toBe(true);
    expect(isFreeValue('color', '#11223344')).toBe(true);
    expect(isFreeValue('color', 'oklch(62% 0.19 255)')).toBe(true);
    expect(isFreeValue('space', '6rem')).toBe(true);
    expect(isFreeValue('space', '0')).toBe(true);
    expect(isFreeValue('font', 'serif')).toBe(true);
    expect(isFreeValue('align', 'center')).toBe(true);
  });

  // Each of these would be CSS injection or a request to a third party if it reached a stylesheet.
  test.each([
    ['color', 'red;}body{display:none'],
    ['color', 'url(https://evil.example/x)'],
    ['color', 'var(--x)'],
    ['color', '#12345'],
    ['space', '1rem;background:url(x)'],
    ['space', 'calc(1px + 1px)'],
    ['space', '-1rem'],
    ['space', '1e9px'],
    ['width', '10'],
    ['font', 'Comic Sans MS'],
    ['font', 'x, url(y)'],
    ['font', 'constructor'],
    ['align', 'justify'],
    ['size', ' 1rem'],
  ] as const)('refuses %s "%s"', (kind, value) => {
    expect(isFreeValue(kind, value)).toBe(false);
  });

  test('a style keeps what is valid and reports the rest', async () => {
    const { style, issues } = normalizeStyle({
      background: { token: 'primary' },
      paddingBlock: { value: '6rem' },
      color: { value: 'red;}' },
      textAlign: { token: 'center' },
      position: { value: 'fixed' },
      radius: { token: 'x y' },
      gap: '1rem',
    });
    expect(style).toEqual({ background: { token: 'primary' }, paddingBlock: { value: '6rem' } });
    expect(issues.map((i) => i.path).sort()).toEqual(['style.color', 'style.gap', 'style.position', 'style.radius', 'style.textAlign']);
  });
});

describe('themes', () => {
  test('the shipped themes are valid', async () => {
    expect(parseTheme(plain).issues).toEqual([]);
    expect(parseTheme(studio).issues).toEqual([]);
  });

  test('a theme with any issue is refused whole', async () => {
    const broken = structuredClone(plain) as Record<string, any>;
    broken.tokens.color.primary = 'url(javascript:alert(1))';
    const { theme: none, issues } = parseTheme(broken);
    expect(none).toBeNull();
    expect(issues.map((i) => i.path)).toContain('tokens.color.primary');
  });

  test('a missing required token, an unknown block type and an unknown token are each named', async () => {
    const broken = structuredClone(plain) as Record<string, any>;
    delete broken.tokens.space.xl;
    broken.blocks.carousel = { style: {} };
    broken.blocks.hero.style.background = { token: 'nope' };
    const paths = parseTheme(broken).issues.map((i) => i.path);
    expect(paths).toContain('tokens.space.xl');
    expect(paths).toContain('blocks.carousel');
    expect(paths).toContain('blocks.hero.style.background');
  });

  test('theme CSS carries tokens, block defaults and variants, and no value that was not checked', async () => {
    const css = themeCss(theme(plain));
    expect(css).toContain('--t-color-primary:#2563eb');
    expect(css).toContain('--t-font-body:system-ui');
    expect(css).toContain('.b-hero{background-color:var(--t-color-surface)}');
    expect(css).toContain('.b-hero.v-bold{background-color:var(--t-color-primary);color:var(--t-color-on-primary)}');
    expect(css).not.toMatch(/url\(|@import|expression|<\//i);
  });
});

describe('blocks', () => {
  test('unknown types are dropped and reported; undeclared content is dropped', async () => {
    const { blocks, issues } = normalizeBlocks([
      { type: 'hero', content: { title: 'Hi', bg_color: '#fff', html: '<script>' } },
      { type: 'carousel', content: {} },
      'nonsense',
    ]);
    expect(blocks).toHaveLength(1);
    expect(Object.keys(blocks[0]!.content).sort()).toEqual(['action', 'eyebrow', 'image', 'secondaryAction', 'subtitle', 'title']);
    expect(issues).toHaveLength(2);
  });

  test('links and images keep only safe addresses', async () => {
    const { blocks } = normalizeBlocks([
      {
        type: 'hero',
        content: {
          title: 'x',
          action: { label: 'Go', href: 'javascript:alert(1)' },
          secondaryAction: { label: 'Go', href: '/contact/' },
          image: { src: 'data:image/svg+xml,<svg onload=alert(1)>', alt: '' },
        },
      },
    ]);
    expect(blocks[0]!.content.action).toEqual({ label: 'Go', href: '' });
    expect(isLink(blocks[0]!.content.action as LinkValue)).toBe(false);
    expect(blocks[0]!.content.secondaryAction).toEqual({ label: 'Go', href: '/contact/' });
    expect(blocks[0]!.content.image).toBeNull();
    expect(safeHref('//evil.example')).toBe('');
    expect(safeHref(' JAVASCRIPT:alert(1)')).toBe('');
    expect(safeHref('mailto:a@b.c')).toBe('mailto:a@b.c');
  });

  test('ids are unique: a repeated or malformed id is replaced', async () => {
    const { blocks } = normalizeBlocks([
      { id: 'same', type: 'text', content: {} },
      { id: 'same', type: 'text', content: {} },
      { id: '"><script>', type: 'text', content: {} },
    ]);
    const ids = blocks.map((b) => b.id);
    expect(new Set(ids).size).toBe(3);
    expect(ids[0]).toBe('same');
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  test('only a container keeps children, and nesting is bounded', async () => {
    const deep = (n: number): unknown => ({ type: 'group', children: n > 0 ? [deep(n - 1)] : [] });
    const { blocks, issues } = normalizeBlocks([{ type: 'text', content: {}, children: [{ type: 'text' }] }, deep(8)]);
    expect(blocks[0]!.children).toBeUndefined();
    expect(flatten(blocks).length).toBeLessThanOrEqual(6);
    expect(issues.some((i) => i.message.includes('nest'))).toBe(true);
  });

  test('every type can be created and comes back unchanged from cleaning', async () => {
    for (const type of BLOCK_TYPES) {
      const block = createBlock(type);
      expect(normalizeBlocks([block]).blocks[0]).toEqual(block);
    }
  });

  test('rich text drops unknown nodes and unsafe links', async () => {
    const doc = normalizeRichText([
      { type: 'paragraph', children: [{ text: 'a', marks: ['bold', 'blink'], href: 'javascript:x' }, { text: '' }] },
      { type: 'script', children: [{ text: 'alert(1)' }] },
      { type: 'heading', level: 1, children: [{ text: 'h' }] },
    ]);
    expect(doc).toEqual([
      { type: 'paragraph', children: [{ text: 'a', marks: ['bold'] }] },
      { type: 'heading', level: 2, children: [{ text: 'h' }] },
    ]);
  });

  test('page words and slugs', async () => {
    const { blocks } = normalizeBlocks([{ type: 'services', content: { title: 'T', items: [{ title: 'A', text: 'B' }] } }]);
    expect(blocksText(blocks)).toBe('T A B');
    expect(slugify('Despre noi & Ștefan!')).toBe('despre-noi-stefan');
  });
});

describe('the tree', () => {
  const make = (): Block[] =>
    normalizeBlocks([
      { id: 'a', type: 'text' },
      { id: 'g', type: 'group', children: [{ id: 'b', type: 'text' }, { id: 'h', type: 'group', children: [{ id: 'c', type: 'text' }] }] },
      { id: 'd', type: 'text' },
    ]).blocks;
  const order = (blocks: Block[]): string => flatten(blocks).map((b) => b.id).join('');

  test('find, parent, remove, insert', async () => {
    const t = make();
    expect(order(t)).toBe('agbhcd');
    expect(findById(t, 'c')?.id).toBe('c');
    expect(parentIdOf(t, 'c')).toBe('h');
    expect(parentIdOf(t, 'a')).toBeNull();
    expect(parentIdOf(t, 'zz')).toBeUndefined();
    expect(order(removeById(t, 'h'))).toBe('agbd');
    expect(order(insertAt(t, 'h', 0, createBlock('text')))).toHaveLength(order(t).length + createBlock('text').id.length);
  });

  test('a move reads its index after the block has left', async () => {
    expect(order(moveTo(make(), 'a', null, 2))).toBe('gbhcda');
    expect(order(moveTo(make(), 'd', 'g', 0))).toBe('agdbhc');
  });

  test('a move that would lose the branch changes nothing', async () => {
    const t = make();
    expect(moveTo(t, 'g', 'h', 0)).toBe(t); // into its own descendant
    expect(moveTo(t, 'g', 'g', 0)).toBe(t); // into itself
    expect(moveTo(t, 'a', 'd', 0)).toBe(t); // into a block that holds nothing
    expect(moveTo(t, 'a', 'missing', 0)).toBe(t);
  });

  test('nothing is mutated, and a duplicate has new ids all the way down', async () => {
    const t = make();
    const before = JSON.stringify(t);
    const copy = duplicate(t, 'g');
    expect(JSON.stringify(t)).toBe(before);
    const ids = flatten(copy).map((b) => b.id);
    expect(ids).toHaveLength(10);
    expect(new Set(ids).size).toBe(10);
  });
});

describe('a block style under a theme (ADR 0001 d7)', () => {
  const blocks = normalizeBlocks([
    {
      id: 'k',
      type: 'contact',
      content: { title: 'Hello' },
      style: { background: { token: 'surface' }, paddingBlock: { value: '6rem' }, color: { token: 'brand-2' } },
    },
  ]).blocks;

  test('a token follows the theme, a free value stays, an unknown token writes nothing', async () => {
    for (const t of [theme(plain), theme(studio)]) {
      expect(blocksCss(blocks, t)).toBe('[data-b="k"][data-b][data-b]{background-color:var(--t-color-surface);padding-block:6rem}\n');
    }
    expect(themeCss(theme(plain))).toContain('--t-color-surface:#f6f7f9');
    expect(themeCss(theme(studio))).toContain('--t-color-surface:#1d1b18');
  });

  test('a token a theme adds is used once that theme is on', async () => {
    const extended = structuredClone(plain) as Record<string, any>;
    extended.tokens.color['brand-2'] = '#ff0066';
    expect(blocksCss(blocks, theme(extended))).toContain('color:var(--t-color-brand-2)');
  });

  test('a free value that slipped past cleaning is still not written', async () => {
    const forged = { paddingBlock: { value: '1px;}*{display:none' } } as any;
    expect(declarations(forged, theme(plain))).toBe('');
  });

  test('reset to theme removes free values and nothing else', async () => {
    expect(countFreeValues(blocks)).toBe(1);
    const reset = resetToTheme(blocks);
    expect(countFreeValues(reset)).toBe(0);
    expect(reset[0]!.style).toEqual({ background: { token: 'surface' }, color: { token: 'brand-2' } });
    expect(reset[0]!.content).toEqual(blocks[0]!.content);
    expect(blocks[0]!.style!.paddingBlock).toEqual({ value: '6rem' });
  });
});

test('nudge moves a block among its siblings and stops at the ends', async () => {
  const { blocks } = normalizeBlocks([{ id: 'a', type: 'text' }, { id: 'b', type: 'text' }, { id: 'c', type: 'text' }]);
  const ids = (list: Block[]): string => list.map((b) => b.id).join('');
  expect(ids(nudge(blocks, 'a', 1))).toBe('bac');
  expect(ids(nudge(blocks, 'c', -1))).toBe('acb');
  expect(nudge(blocks, 'a', -1)).toBe(blocks);
  expect(nudge(blocks, 'c', 1)).toBe(blocks);
});
