<script lang="ts">
/**
 * The ready-made styles (ADR 0082 d1, d4). Each is the same theme document
 * with other values, shown by what it looks like: its colours and its
 * typefaces. Choosing one over a style changed by hand asks first, and offers
 * to keep the changed one as a file.
 */
import { onMount } from 'svelte';
import { FONT_STACKS, fontFacesCss, type Theme } from '../core/index.ts';
import { say, t } from './messages.ts';
import { readyMade } from './themeEdit.ts';

let {
  theme,
  ready,
  onchoose,
  ondownload,
}: {
  theme: Theme;
  /** The styles that ship (`themes/`). */
  ready: Theme[];
  onchoose: (theme: Theme) => void;
  /** Keeps the style as it is now, as a file. */
  ondownload: () => void;
} = $props();

const untouched = $derived(readyMade(theme, ready));
/** The style asked for while the site's own has changes: it waits for a yes. */
let asking = $state<Theme | null>(null);

const stack = (style: Theme, role: 'heading' | 'body'): string => FONT_STACKS[(style.tokens.font[role] ?? style.tokens.font.body ?? 'system') as keyof typeof FONT_STACKS] ?? FONT_STACKS.system;
const color = (style: Theme, name: string, fallback: string): string => style.tokens.color[name] ?? fallback;
/** A few colours that say the style: the page, the text, the main colour and what else it names. */
const dots = (style: Theme): string[] => {
  const c = style.tokens.color;
  return [...new Set([c.background, c.text, c.primary, c.surface, ...Object.values(c)].filter((v): v is string => !!v))].slice(0, 5);
};

/** The typefaces that ship, so each card shows its own (the site serves them, ADR 0068). */
onMount(() => {
  if (document.getElementById('uhlaka-faces')) return;
  const sheet = document.createElement('style');
  sheet.id = 'uhlaka-faces';
  sheet.textContent = fontFacesCss();
  document.head.append(sheet);
});

function choose(style: Theme): void {
  if (style.name === theme.name && untouched) return;
  if (untouched) onchoose(style);
  else asking = style;
}
</script>

<div class="gallery" data-styles>
  {#each ready as style (style.name)}
    {@const current = style.name === theme.name}
    <button
      type="button"
      class="card"
      class:current
      aria-pressed={current}
      onclick={() => choose(style)}
      style:--bg={color(style, 'background', '#fff')}
      style:--fg={color(style, 'text', '#111')}
      style:--accent={color(style, 'primary', '#333')}
      data-style={style.name}
    >
      <span class="sample">
        <span class="aa" style:font-family={stack(style, 'heading')}>Aa</span>
        <span class="line" style:font-family={stack(style, 'body')}>{t.look.sample}</span>
        <span class="dots" aria-hidden="true">{#each dots(style) as dot}<i style:background={dot}></i>{/each}</span>
      </span>
      <span class="name">
        {style.name}
        {#if current}<small>{untouched ? t.look.inUse : t.look.inUseChanged}</small>{/if}
      </span>
    </button>
  {/each}
  {#if !ready.some((r) => r.name === theme.name)}
    <div class="card own current" data-style-own>
      <span class="sample"><span class="aa" style:font-family={stack(theme, 'heading')}>Aa</span><span class="dots" aria-hidden="true">{#each dots(theme) as dot}<i style:background={dot}></i>{/each}</span></span>
      <span class="name">{theme.name}<small>{t.look.inUseOwn}</small></span>
    </div>
  {/if}
</div>

{#if asking}
  {@const next = asking}
  <div class="ask" role="alertdialog" aria-labelledby="style-ask" data-style-ask {@attach (node) => node.scrollIntoView({ block: 'nearest' })}>
    <p id="style-ask"><strong>{say(t.look.askTitle, { name: next.name })}</strong></p>
    <p>{say(t.look.askBody, { name: next.name })}</p>
    <div class="row">
      <button type="button" onclick={ondownload} data-style-keep>{t.look.askKeep}</button>
      <button type="button" class="danger" onclick={() => { asking = null; onchoose(next); }} data-style-replace>{say(t.look.askReplace, { name: next.name })}</button>
      <button type="button" class="quiet" onclick={() => (asking = null)} data-style-cancel>{t.app.cancel}</button>
    </div>
  </div>
{/if}

<style>
  .gallery { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.5rem; margin-bottom: 0.6rem; }
  .card { display: grid; gap: 0.35rem; padding: 0.35rem; margin: 0; text-align: start; background: #fff; border: 1px solid #dddbe6; border-radius: 10px; cursor: pointer; font: inherit; color: #1e1e27; }
  .card:hover { border-color: #a9a3e8; }
  .card:focus-visible { outline: 2px solid #5b4cdb; outline-offset: 2px; }
  .card.current { border: 2px solid #5b4cdb; padding: calc(0.35rem - 1px); }
  .card.own { cursor: default; }
  .sample { display: grid; gap: 0.15rem; padding: 0.55rem 0.6rem; border-radius: 7px; background: var(--bg, #f2f1f7); color: var(--fg, #1e1e27); border: 1px solid rgb(0 0 0 / 0.06); }
  .aa { font-size: 1.6rem; line-height: 1; font-weight: 700; }
  .line { font-size: 0.72rem; opacity: 0.85; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .dots { display: flex; gap: 3px; margin-top: 0.2rem; }
  .dots i { width: 12px; height: 12px; border-radius: 50%; border: 1px solid rgb(0 0 0 / 0.15); }
  .name { display: flex; flex-direction: column; padding: 0 0.2rem 0.1rem; font-weight: 600; font-size: 13px; }
  .name small { font-weight: 400; color: #5d5d72; }
  .ask { display: grid; gap: 0.3rem; padding: 0.7rem; margin-bottom: 0.8rem; border-radius: 8px; background: #fff6d6; border: 1px solid #f0d78c; }
  .ask p { margin: 0; }
  .row { display: grid; gap: 0.4rem; margin-top: 0.3rem; }
  .row button { margin: 0; }
  .danger { background: #b42318; border-color: #b42318; color: #fff; }
</style>
