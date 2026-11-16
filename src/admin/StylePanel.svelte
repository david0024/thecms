<script lang="ts">
/**
 * A block's style (ADR 0001 d7). For each property the theme's tokens come
 * first; "my own value" is one step further and is marked, because it will not
 * follow the theme when the theme changes.
 */
import {
  ALIGNMENTS,
  type Block,
  type BlockStyle,
  FONT_STACKS,
  isFree,
  isFreeValue,
  STYLE_PROPS,
  type StyleProp,
  type Theme,
  type TokenGroup,
  variantsOf,
} from '../core/index.ts';
import { t } from './messages.ts';

let {
  block,
  theme,
  onstyle,
  onvariant,
}: { block: Block; theme: Theme; onstyle: (style: BlockStyle) => void; onvariant: (variant: string) => void } = $props();

const styleProps = Object.keys(STYLE_PROPS) as StyleProp[];
const variants = $derived(variantsOf(theme, block.type));
const free = $derived(Object.values(block.style ?? {}).filter((v) => v && isFree(v)).length);
/** Properties whose custom input is open but does not hold a valid value yet. */
let drafts = $state<Partial<Record<StyleProp, string>>>({});

const kindOf = (prop: StyleProp) => STYLE_PROPS[prop].kind;
const tokens = (prop: StyleProp): string[] => (kindOf(prop) === 'align' ? [] : Object.keys(theme.tokens[kindOf(prop) as TokenGroup]));
const choices = (prop: StyleProp): readonly string[] | null =>
  kindOf(prop) === 'align' ? ALIGNMENTS : kindOf(prop) === 'font' ? Object.keys(FONT_STACKS) : null;

function mode(prop: StyleProp): string {
  if (prop in drafts) return '$custom';
  const value = block.style?.[prop];
  if (!value) return '';
  if (!isFree(value)) return `token:${value.token}`;
  return choices(prop) ? `value:${value.value}` : '$custom';
}

function set(prop: StyleProp, value: BlockStyle[StyleProp] | undefined): void {
  const next: BlockStyle = { ...(block.style ?? {}) };
  if (value) next[prop] = value;
  else delete next[prop];
  onstyle(next);
}

function choose(prop: StyleProp, choice: string): void {
  delete drafts[prop];
  if (choice === '') set(prop, undefined);
  else if (choice.startsWith('token:')) set(prop, { token: choice.slice(6) });
  else if (choice.startsWith('value:')) set(prop, { value: choice.slice(6) });
  else {
    const current = block.style?.[prop];
    drafts[prop] = current && isFree(current) ? current.value : '';
  }
}

function type(prop: StyleProp, value: string): void {
  drafts[prop] = value;
  // Only a value that would survive saving is applied; until then the block keeps what it had.
  if (isFreeValue(kindOf(prop), value)) set(prop, { value });
}

const customValue = (prop: StyleProp): string => {
  const value = block.style?.[prop];
  return drafts[prop] ?? (value && isFree(value) ? value.value : '');
};
</script>

{#if variants.length}
  <label class="field">
    <span>{t.inspector.variant}</span>
    <select value={block.variant ?? ''} onchange={(e) => onvariant(e.currentTarget.value)}>
      <option value="">{t.inspector.noVariant}</option>
      {#each variants as variant}<option value={variant}>{variant}</option>{/each}
    </select>
  </label>
{/if}

{#each styleProps as prop (prop)}
  <label class="field">
    <span>{t.style.props[prop]}{#if block.style?.[prop] && isFree(block.style[prop])}<em class="own" title={t.style.custom}>●</em>{/if}</span>
    <select value={mode(prop)} onchange={(e) => choose(prop, e.currentTarget.value)} data-style={prop}>
      <option value="">{t.style.theme}</option>
      {#each tokens(prop) as token}<option value={`token:${token}`}>{token}</option>{/each}
      {#if choices(prop)}
        {#each choices(prop) ?? [] as choice}
          <option value={`value:${choice}`}>{kindOf(prop) === 'align' ? t.style.align[choice] : choice} {kindOf(prop) === 'font' ? `(${t.style.custom})` : ''}</option>
        {/each}
      {:else}
        <option value="$custom">{t.style.custom}…</option>
      {/if}
    </select>
    {#if mode(prop) === '$custom'}
      <span class="custom">
        {#if kindOf(prop) === 'color'}
          <input type="color" value={/^#[0-9a-f]{6}$/i.test(customValue(prop)) ? customValue(prop) : '#000000'} oninput={(e) => type(prop, e.currentTarget.value)} />
        {/if}
        <input
          type="text"
          placeholder={kindOf(prop) === 'color' ? '#1a73e8' : '2rem'}
          value={customValue(prop)}
          oninput={(e) => type(prop, e.currentTarget.value.trim())}
          aria-invalid={customValue(prop) !== '' && !isFreeValue(kindOf(prop), customValue(prop))}
          data-custom={prop}
        />
      </span>
      {#if customValue(prop) !== '' && !isFreeValue(kindOf(prop), customValue(prop))}<small class="bad">{t.style.invalid}</small>{/if}
    {/if}
  </label>
{/each}

{#if free > 0}
  <p class="hint">{t.style.free(free)}</p>
  <button
    type="button"
    onclick={() => {
      drafts = {};
      onstyle(Object.fromEntries(Object.entries(block.style ?? {}).filter(([, v]) => v && !isFree(v))) as BlockStyle);
    }}>{t.style.reset}</button>
{/if}
