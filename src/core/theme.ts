/**
 * A theme is a data document (ADR 0001 d8): tokens, the default style of each
 * block type with its named variants, and how the header and footer are laid
 * out (ADR 0006). It holds no code and no CSS text.
 * The theme builder edits this document; `themeCss` in `css.ts` turns it into
 * a stylesheet.
 */
import { BLOCK_TYPES, type BlockType, isBlockType } from './blocks.ts';
import {
  type BlockStyle,
  isFreeValue,
  isTokenName,
  normalizeStyle,
  STYLE_PROPS,
  type StyleProp,
  TOKEN_GROUPS,
  type TokenGroup,
} from './style.ts';
import { fromOldName } from './name.ts';
import { type Issue, isObject, str } from './util.ts';

export const THEME_SPEC = 'uhlaka.theme/1';

export type Tokens = Record<TokenGroup, Record<string, string>>;

export interface BlockTheme {
  style?: BlockStyle;
  variants?: Record<string, BlockStyle>;
}

/**
 * How the parts of the header, and of the footer, sit beside each other. A
 * closed list: a theme picks one by name, and `css.ts` knows what each means.
 */
export const HEADER_ARRANGEMENTS = ['inline', 'centered', 'stacked'] as const;
export const FOOTER_ARRANGEMENTS = ['inline', 'centered'] as const;
export type HeaderArrangement = (typeof HEADER_ARRANGEMENTS)[number];
export type FooterArrangement = (typeof FOOTER_ARRANGEMENTS)[number];

export interface ThemeLayout {
  header: { arrangement: HeaderArrangement; /** Stays at the top of the screen while the page scrolls. */ sticky: boolean; style?: BlockStyle };
  footer: { arrangement: FooterArrangement; style?: BlockStyle };
  /** The panel a menu item opens (ADR 0008). */
  menu: { style?: BlockStyle };
}

export const DEFAULT_LAYOUT: ThemeLayout = { header: { arrangement: 'inline', sticky: false }, footer: { arrangement: 'inline' }, menu: {} };

export interface Theme {
  spec: typeof THEME_SPEC;
  name: string;
  tokens: Tokens;
  blocks: Partial<Record<BlockType, BlockTheme>>;
  /** Always present once parsed; a theme file written before ADR 0006 gets the default. */
  layout: ThemeLayout;
}

/**
 * Tokens every theme defines. A block bound to one of these looks right under
 * any theme; a theme may add its own, and a reference to a token the current
 * theme lacks falls back to the theme's default for that block.
 */
export const REQUIRED_TOKENS: Record<TokenGroup, readonly string[]> = {
  color: ['background', 'surface', 'text', 'muted', 'border', 'primary', 'on-primary'],
  space: ['xs', 'sm', 'md', 'lg', 'xl'],
  radius: ['none', 'sm', 'md', 'lg'],
  font: ['body', 'heading'],
  size: ['sm', 'base', 'lg', 'xl', '2xl', '3xl'],
  width: ['narrow', 'content', 'wide'],
};

const MAX_TOKENS = 64;
const MAX_VARIANTS = 12;

/** Is the token this style value names one the theme has? */
export function hasToken(theme: Theme, group: TokenGroup, name: string): boolean {
  return Object.hasOwn(theme.tokens[group], name);
}

function checkStyleTokens(theme: Theme, style: BlockStyle, path: string, issues: Issue[]): void {
  for (const [prop, value] of Object.entries(style) as [StyleProp, BlockStyle[StyleProp]][]) {
    if (!value || !('token' in value)) continue;
    const group = STYLE_PROPS[prop].kind as TokenGroup;
    if (!hasToken(theme, group, value.token)) {
      issues.push({ path: `${path}.${prop}`, message: `no ${group} token "${value.token}" in this theme` });
    }
  }
}

/**
 * Untrusted input as a theme. Unlike a block's style, a theme is all or
 * nothing: any issue means the document is refused (`theme` is null), because
 * a half-applied theme is a site that looks broken with no visible reason.
 */
export function parseTheme(input: unknown): { theme: Theme | null; issues: Issue[] } {
  const issues: Issue[] = [];
  if (!isObject(input)) return { theme: null, issues: [{ path: '', message: 'a theme is an object' }] };
  if (fromOldName(input.spec) !== THEME_SPEC) issues.push({ path: 'spec', message: `expected "${THEME_SPEC}"` });

  const name = str(input.name, 80).trim();
  if (!name) issues.push({ path: 'name', message: 'a theme has a name' });

  const tokens = Object.fromEntries(TOKEN_GROUPS.map((g) => [g, {}])) as Tokens;
  const rawTokens = isObject(input.tokens) ? input.tokens : {};
  for (const key of Object.keys(rawTokens)) {
    if (!(TOKEN_GROUPS as readonly string[]).includes(key)) {
      issues.push({ path: `tokens.${key}`, message: 'not a token group' });
    }
  }
  for (const group of TOKEN_GROUPS) {
    const raw = isObject(rawTokens[group]) ? (rawTokens[group] as Record<string, unknown>) : {};
    const entries = Object.entries(raw);
    if (entries.length > MAX_TOKENS) issues.push({ path: `tokens.${group}`, message: `at most ${MAX_TOKENS} tokens` });
    for (const [token, value] of entries.slice(0, MAX_TOKENS)) {
      const at = `tokens.${group}.${token}`;
      if (!isTokenName(token)) issues.push({ path: at, message: 'not a token name' });
      else if (!isFreeValue(group, value)) issues.push({ path: at, message: `not a ${group} value` });
      else tokens[group][token] = value;
    }
    for (const required of REQUIRED_TOKENS[group]) {
      if (!Object.hasOwn(tokens[group], required)) {
        issues.push({ path: `tokens.${group}.${required}`, message: 'every theme defines this token' });
      }
    }
  }

  const theme: Theme = { spec: THEME_SPEC, name, tokens, blocks: {}, layout: structuredClone(DEFAULT_LAYOUT) };
  const rawBlocks = isObject(input.blocks) ? input.blocks : {};
  for (const [type, raw] of Object.entries(rawBlocks)) {
    const at = `blocks.${type}`;
    if (!isBlockType(type)) {
      issues.push({ path: at, message: `not a block type (${BLOCK_TYPES.join(', ')})` });
      continue;
    }
    if (!isObject(raw)) {
      issues.push({ path: at, message: 'a block theme is an object' });
      continue;
    }
    const entry: BlockTheme = {};
    if (raw.style !== undefined) {
      const { style, issues: found } = normalizeStyle(raw.style, `${at}.style`);
      issues.push(...found);
      checkStyleTokens(theme, style, `${at}.style`, issues);
      entry.style = style;
    }
    if (raw.variants !== undefined) {
      const variants = isObject(raw.variants) ? Object.entries(raw.variants) : [];
      if (variants.length > MAX_VARIANTS) issues.push({ path: `${at}.variants`, message: `at most ${MAX_VARIANTS} variants` });
      entry.variants = {};
      for (const [variant, rawStyle] of variants.slice(0, MAX_VARIANTS)) {
        const vAt = `${at}.variants.${variant}`;
        if (!isTokenName(variant)) {
          issues.push({ path: vAt, message: 'not a variant name' });
          continue;
        }
        const { style, issues: found } = normalizeStyle(rawStyle, vAt);
        issues.push(...found);
        checkStyleTokens(theme, style, vAt, issues);
        entry.variants[variant] = style;
      }
    }
    theme.blocks[type] = entry;
  }

  if (input.layout !== undefined && !isObject(input.layout)) issues.push({ path: 'layout', message: 'a layout is an object' });
  const rawLayout = isObject(input.layout) ? input.layout : {};
  for (const key of Object.keys(rawLayout)) {
    if (key !== 'header' && key !== 'footer' && key !== 'menu') issues.push({ path: `layout.${key}`, message: 'not a part of the layout (header, footer, menu)' });
  }
  for (const part of ['header', 'footer', 'menu'] as const) {
    const raw = rawLayout[part];
    if (raw === undefined) continue;
    const at = `layout.${part}`;
    if (!isObject(raw)) {
      issues.push({ path: at, message: 'an object' });
      continue;
    }
    const allowed: readonly string[] = part === 'header' ? HEADER_ARRANGEMENTS : part === 'footer' ? FOOTER_ARRANGEMENTS : [];
    if (raw.arrangement !== undefined) {
      if (part !== 'menu' && typeof raw.arrangement === 'string' && allowed.includes(raw.arrangement)) theme.layout[part].arrangement = raw.arrangement as never;
      else issues.push({ path: `${at}.arrangement`, message: allowed.length ? `one of: ${allowed.join(', ')}` : 'the menu has no arrangement' });
    }
    if (part === 'header' && raw.sticky !== undefined) {
      if (typeof raw.sticky === 'boolean') theme.layout.header.sticky = raw.sticky;
      else issues.push({ path: `${at}.sticky`, message: 'true or false' });
    }
    if (raw.style !== undefined) {
      const { style, issues: found } = normalizeStyle(raw.style, `${at}.style`);
      issues.push(...found);
      checkStyleTokens(theme, style, `${at}.style`, issues);
      if (Object.keys(style).length) theme.layout[part].style = style;
    }
  }

  return issues.length ? { theme: null, issues } : { theme, issues };
}

/** The variants a block of this type may wear under this theme. */
export function variantsOf(theme: Theme, type: BlockType): string[] {
  return Object.keys(theme.blocks[type]?.variants ?? {});
}
