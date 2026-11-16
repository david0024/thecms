/**
 * A block's style: how this one block departs from the theme (ADR 0001 d7).
 *
 * Every value is either a reference to a theme token, which follows the theme
 * when it changes, or a free value, which stays as the author set it. Both end
 * up inside a stylesheet, so a free value is accepted only when it is plainly a
 * colour, a length or a known name. Nothing is escaped: what does not match is
 * dropped.
 */
import { type Issue, isObject } from './util.ts';

export type StyleValue = { token: string } | { value: string };

/** What a property holds; also the theme's token groups (all but `align`). */
export type StyleKind = 'color' | 'space' | 'radius' | 'font' | 'size' | 'width' | 'align';

export const TOKEN_GROUPS = ['color', 'space', 'radius', 'font', 'size', 'width'] as const;
export type TokenGroup = (typeof TOKEN_GROUPS)[number];

/** The properties a block may set. A closed list that grows on purpose. */
export const STYLE_PROPS = {
  background: { kind: 'color', css: 'background-color' },
  color: { kind: 'color', css: 'color' },
  paddingBlock: { kind: 'space', css: 'padding-block' },
  paddingInline: { kind: 'space', css: 'padding-inline' },
  marginBlock: { kind: 'space', css: 'margin-block' },
  gap: { kind: 'space', css: '--b-gap' },
  radius: { kind: 'radius', css: 'border-radius' },
  fontFamily: { kind: 'font', css: 'font-family' },
  fontSize: { kind: 'size', css: 'font-size' },
  maxWidth: { kind: 'width', css: '--b-width' },
  textAlign: { kind: 'align', css: 'text-align' },
} as const satisfies Record<string, { kind: StyleKind; css: string }>;

export type StyleProp = keyof typeof STYLE_PROPS;
export type BlockStyle = Partial<Record<StyleProp, StyleValue>>;

export const isStyleProp = (v: string): v is StyleProp => Object.hasOwn(STYLE_PROPS, v);

/**
 * Typefaces a site may use. Each is a stack the browser already has, so no
 * request leaves the site for a font (ADR 0001 d3). Self-hosted faces join
 * this list when the media library can serve them.
 */
export const FONT_STACKS = {
  system: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  humanist: 'Seravek, "Gill Sans Nova", Ubuntu, Calibri, "DejaVu Sans", sans-serif',
  geometric: 'Avenir, Montserrat, Corbel, "URW Gothic", sans-serif',
  serif: 'Charter, "Bitstream Charter", "Sitka Text", Cambria, serif',
  oldstyle: '"Iowan Old Style", "Palatino Linotype", "URW Palladio L", P052, serif',
  mono: 'ui-monospace, "Cascadia Code", Menlo, Consolas, monospace',
} as const;

export const ALIGNMENTS = ['start', 'center', 'end'] as const;

const TOKEN_NAME = /^[a-z0-9][a-z0-9-]{0,30}$/;
const COLOR =
  /^(#[0-9a-f]{3,4}|#[0-9a-f]{6}|#[0-9a-f]{8}|oklch\(\d{1,3}(\.\d{1,4})?%? \d(\.\d{1,4})? \d{1,3}(\.\d{1,4})?( ?\/ ?(0|1|0?\.\d{1,3}))?\))$/i;
const LENGTH = /^(0|\d{1,4}(\.\d{1,4})?(rem|em|px|%|vw|vh|ch))$/;

export const isTokenName = (v: unknown): v is string => typeof v === 'string' && TOKEN_NAME.test(v);

/** Whether `value` is a literal this kind accepts. The one gate to a stylesheet. */
export function isFreeValue(kind: StyleKind, value: unknown): value is string {
  if (typeof value !== 'string') return false;
  switch (kind) {
    case 'color':
      return COLOR.test(value);
    case 'space':
    case 'radius':
    case 'size':
    case 'width':
      return LENGTH.test(value);
    case 'font':
      return Object.hasOwn(FONT_STACKS, value);
    case 'align':
      return (ALIGNMENTS as readonly string[]).includes(value);
  }
}

/** The CSS text of a checked free value. */
export function freeValueCss(kind: StyleKind, value: string): string {
  return kind === 'font' ? FONT_STACKS[value as keyof typeof FONT_STACKS] : value;
}

export const tokenVar = (group: TokenGroup, name: string): string => `--t-${group}-${name}`;

/**
 * Untrusted input as a clean style. A property that is unknown, or a value
 * that is neither a well-formed token reference nor a valid literal, is left
 * out and reported. Whether a referenced token exists is the theme's question,
 * answered when the page is drawn.
 */
export function normalizeStyle(input: unknown, path = 'style'): { style: BlockStyle; issues: Issue[] } {
  const style: BlockStyle = {};
  const issues: Issue[] = [];
  if (input === undefined || input === null) return { style, issues };
  if (!isObject(input)) return { style, issues: [{ path, message: 'a style is an object' }] };

  for (const [prop, raw] of Object.entries(input)) {
    const at = `${path}.${prop}`;
    if (!isStyleProp(prop)) {
      issues.push({ path: at, message: 'not a style property' });
      continue;
    }
    const kind: StyleKind = STYLE_PROPS[prop].kind;
    if (!isObject(raw)) {
      issues.push({ path: at, message: 'a style value is { token } or { value }' });
    } else if ('token' in raw) {
      if (kind === 'align') issues.push({ path: at, message: 'alignment has no tokens' });
      else if (isTokenName(raw.token)) style[prop] = { token: raw.token };
      else issues.push({ path: at, message: 'not a token name' });
    } else if (isFreeValue(kind, raw.value)) {
      style[prop] = { value: raw.value };
    } else {
      issues.push({ path: at, message: `not a ${kind} value` });
    }
  }
  return { style, issues };
}

export const isFree = (v: StyleValue): v is { value: string } => 'value' in v;
