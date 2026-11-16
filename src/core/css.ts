/**
 * From data to a stylesheet. The only place the core writes CSS, and every
 * value written here has passed `isFreeValue` or names a token.
 */
import type { Block } from './blocks.ts';
import { type BlockStyle, freeValueCss, isFree, isFreeValue, STYLE_PROPS, type StyleProp, TOKEN_GROUPS, type TokenGroup, tokenVar } from './style.ts';
import { type FooterArrangement, hasToken, type HeaderArrangement, type Theme } from './theme.ts';
import { isId } from './util.ts';

/**
 * A style as CSS declarations under this theme. A reference to a token the
 * theme does not have writes nothing, so the theme's own default shows; a free
 * value is checked again here, because this is the last step before a browser.
 */
export function declarations(style: BlockStyle | undefined, theme: Theme): string {
  if (!style) return '';
  const out: string[] = [];
  for (const prop of Object.keys(STYLE_PROPS) as StyleProp[]) {
    const value = style[prop];
    if (!value) continue;
    const { kind, css } = STYLE_PROPS[prop];
    if (isFree(value)) {
      if (isFreeValue(kind, value.value)) out.push(`${css}:${freeValueCss(kind, value.value)}`);
    } else if (kind !== 'align' && hasToken(theme, kind as TokenGroup, value.token)) {
      out.push(`${css}:var(${tokenVar(kind as TokenGroup, value.token)})`);
    }
  }
  return out.join(';');
}

const rule = (selector: string, body: string): string => (body ? `${selector}{${body}}\n` : '');

/**
 * What each arrangement means. The header and footer are the same HTML under
 * every theme; an arrangement only sets the properties their one flex row
 * reads (`base.css`). So a theme still changes a site's look without changing
 * a byte of its pages.
 */
const HEADER_LAYOUT: Record<HeaderArrangement, string> = {
  inline: '',
  centered: '--l-direction:column;--l-align:center;--l-justify:center;text-align:center',
  stacked: '--l-direction:column;--l-align:flex-start;--l-justify:flex-start',
};
const FOOTER_LAYOUT: Record<FooterArrangement, string> = {
  inline: '',
  centered: '--l-direction:column;--l-align:center;--l-justify:center;text-align:center',
};
const STICKY = 'position:sticky;top:0;z-index:5';

const join = (...parts: string[]): string => parts.filter(Boolean).join(';');

/** The theme as a stylesheet: its tokens, each block type's default and variants, then the header and footer. */
export function themeCss(theme: Theme): string {
  const vars: string[] = [];
  for (const group of TOKEN_GROUPS) {
    for (const [name, value] of Object.entries(theme.tokens[group])) {
      if (isFreeValue(group, value)) vars.push(`${tokenVar(group, name)}:${freeValueCss(group, value)}`);
    }
  }
  let css = rule(':root', vars.join(';'));
  for (const [type, entry] of Object.entries(theme.blocks)) {
    css += rule(`.b-${type}`, declarations(entry?.style, theme));
    for (const [variant, style] of Object.entries(entry?.variants ?? {})) {
      css += rule(`.b-${type}.v-${variant}`, declarations(style, theme));
    }
  }
  const { header, footer } = theme.layout;
  css += rule('.site-header', join(HEADER_LAYOUT[header.arrangement], header.sticky ? STICKY : '', declarations(header.style, theme)));
  css += rule('.site-footer', join(FOOTER_LAYOUT[footer.arrangement], declarations(footer.style, theme)));
  return css;
}

/**
 * The styles the blocks of one page set for themselves. Selected by id and
 * repeated (`[data-b][data-b]`) so a block's own choice always wins over the
 * theme's default and variant for its type.
 */
export function blocksCss(blocks: Block[], theme: Theme): string {
  let css = '';
  const walk = (list: Block[]): void => {
    for (const b of list) {
      if (isId(b.id)) css += rule(`[data-b="${b.id}"][data-b][data-b]`, declarations(b.style, theme));
      if (b.children) walk(b.children);
    }
  };
  walk(blocks);
  return css;
}

/** How many style values on a page are free, i.e. will not follow a theme change. */
export function countFreeValues(blocks: Block[]): number {
  let n = 0;
  for (const b of blocks) {
    n += Object.values(b.style ?? {}).filter((v) => v && isFree(v)).length;
    if (b.children) n += countFreeValues(b.children);
  }
  return n;
}

/** "Reset to theme": the same blocks with every free value removed. Content is untouched. */
export function resetToTheme(blocks: Block[]): Block[] {
  return blocks.map((b) => {
    const kept = Object.fromEntries(Object.entries(b.style ?? {}).filter(([, v]) => v && !isFree(v))) as BlockStyle;
    const { style: _style, ...rest } = b;
    return {
      ...rest,
      ...(Object.keys(kept).length ? { style: kept } : {}),
      ...(b.children ? { children: resetToTheme(b.children) } : {}),
    };
  });
}
