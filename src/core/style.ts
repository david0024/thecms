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
  /** The colours of the buttons inside the block (ADR 0068 d2). */
  buttonBackground: { kind: 'color', css: '--b-button-bg' },
  buttonColor: { kind: 'color', css: '--b-button-fg' },
} as const satisfies Record<string, { kind: StyleKind; css: string }>;

export type StyleProp = keyof typeof STYLE_PROPS;
export type BlockStyle = Partial<Record<StyleProp, StyleValue>>;

export const isStyleProp = (v: string): v is StyleProp => Object.hasOwn(STYLE_PROPS, v);

/**
 * Typefaces a site may use. Most are stacks the browser already has; the
 * others are faces Uhlaka carries and the site serves itself (ADR 0068 d1,
 * `SHIPPED_FACES`), so no request leaves the site for a font (ADR 0001 d3).
 */
export const FONT_STACKS = {
  system: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  humanist: 'Seravek, "Gill Sans Nova", Ubuntu, Calibri, "DejaVu Sans", sans-serif',
  geometric: 'Avenir, Montserrat, Corbel, "URW Gothic", sans-serif',
  serif: 'Charter, "Bitstream Charter", "Sitka Text", Cambria, serif',
  oldstyle: '"Iowan Old Style", "Palatino Linotype", "URW Palladio L", P052, serif',
  mono: 'ui-monospace, "Cascadia Code", Menlo, Consolas, monospace',
  bricolage: '"Bricolage Grotesque", Avenir, Montserrat, Corbel, sans-serif',
  figtree: 'Figtree, Seravek, "Gill Sans Nova", Ubuntu, Calibri, sans-serif',
} as const;

/** Where the site serves the faces it carries. */
export const FONTS_PATH = '/assets/fonts/';

const LATIN = 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD';
const LATIN_EXT = 'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF';

/**
 * The faces Uhlaka carries, in `fonts/` (SIL Open Font License). Each family
 * is split into Latin and the rest of the Latin letters (ș, ț, ő...), so a
 * page only loads the files its words need. A site carries, and declares,
 * only the faces its theme or its pages name.
 */
export const SHIPPED_FACES: readonly { family: string; file: string; weight: string; style: 'normal' | 'italic'; range: string }[] = [
  { family: 'Bricolage Grotesque', file: 'bricolage-grotesque-latin.woff2', weight: '200 800', style: 'normal', range: LATIN },
  { family: 'Bricolage Grotesque', file: 'bricolage-grotesque-latin-ext.woff2', weight: '200 800', style: 'normal', range: LATIN_EXT },
  { family: 'Figtree', file: 'figtree-latin.woff2', weight: '300 900', style: 'normal', range: LATIN },
  { family: 'Figtree', file: 'figtree-latin-ext.woff2', weight: '300 900', style: 'normal', range: LATIN_EXT },
  { family: 'Figtree', file: 'figtree-italic-latin.woff2', weight: '300 900', style: 'italic', range: LATIN },
  { family: 'Figtree', file: 'figtree-italic-latin-ext.woff2', weight: '300 900', style: 'italic', range: LATIN_EXT },
];

/** The families of the faces Uhlaka carries that this CSS or HTML names, through their stack. */
export function facesUsed(texts: Iterable<string>): Set<string> {
  const used = new Set<string>();
  const families = [...new Set(SHIPPED_FACES.map((f) => f.family))];
  for (const text of texts) for (const family of families) if (!used.has(family) && text.includes(`${family.includes(' ') ? `"${family}"` : family},`)) used.add(family);
  return used;
}

/** The faces of these families (all, when none is named) as `@font-face` rules. */
export const fontFacesCss = (families?: Set<string>): string =>
  SHIPPED_FACES.filter((f) => !families || families.has(f.family))
    .map((f) => `@font-face{font-family:"${f.family}";font-style:${f.style};font-weight:${f.weight};font-display:swap;src:url(${FONTS_PATH}${f.file}) format("woff2");unicode-range:${f.range}}\n`)
    .join('');

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
