<script lang="ts">
/**
 * The editor. It holds one page as a document, changes it only through the
 * core's tree operations, and asks the server to draw it. The canvas in the
 * middle is the real page; `frame.ts` runs inside it.
 */
import { onMount } from 'svelte';
import {
  type Block,
  BLOCK_TYPES,
  type BlockDef,
  BLOCKS,
  type BlockStyle,
  type BlockType,
  countFreeValues,
  createBlock,
  duplicate,
  findById,
  insertAt,
  isContainerType,
  nudge,
  type Page,
  parentIdOf,
  patchById,
  removeById,
  resetToTheme,
  slugify,
} from '../core/index.ts';
import { api, type State } from './api.ts';
import Fields from './Fields.svelte';
import { t } from './messages.ts';
import { setPath } from './paths.ts';
import StylePanel from './StylePanel.svelte';

let site = $state.raw<State | null>(null);
let page = $state.raw<Page | null>(null);
let selected = $state<string | null>(null);
let tab = $state<'content' | 'style'>('content');
let saving = $state<'saved' | 'saving' | 'unsaved' | 'error'>('saved');
let failure = $state('');
let newTitle = $state<string | null>(null);
let past = $state.raw<Block[][]>([]);
let future = $state.raw<Block[][]>([]);

let frame: HTMLIFrameElement | undefined = $state();
let frameReady = false;
let themeVersion = 0;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let renderTimer: ReturnType<typeof setTimeout> | undefined;
/** The last text typed on the canvas, so one stretch of typing is one undo step. */
let typing = { key: '', at: 0 };

const block = $derived(page && selected ? findById(page.blocks, selected) : null);
const def = $derived(block ? (BLOCKS[block.type] as BlockDef) : null);
const info = $derived(site?.pages.find((p) => p.slug === page?.slug));
const freeOnPage = $derived(page ? countFreeValues(page.blocks) : 0);

const fail = (error: unknown): void => {
  failure = error instanceof Error ? error.message : String(error);
};

async function draw(): Promise<void> {
  if (!page || !frameReady || !frame?.contentWindow) return;
  try {
    const { body, css } = await api.render(page);
    frame.contentWindow.postMessage(
      { type: 'render', body, css, selected, themeVersion, labels: { types: t.types, fields: t.fields, empty: t.empty, actions: t.actions } },
      location.origin,
    );
  } catch (error) {
    fail(error);
  }
}

function scheduleSave(): void {
  saving = 'unsaved';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 700);
}

async function save(): Promise<void> {
  clearTimeout(saveTimer);
  if (!page || !site) return;
  const sent = page;
  saving = 'saving';
  try {
    const { pages } = await api.save(sent);
    site = { ...site, pages };
    // Something may have changed while the request was out; then it is not saved yet.
    saving = page === sent ? 'saved' : 'unsaved';
    failure = '';
  } catch (error) {
    saving = 'error';
    fail(error);
  }
}

/** Every change to the page goes through here. */
function change(next: Page, options: { redraw?: boolean; step?: boolean } = {}): void {
  if (!page) return;
  if (options.step !== false) {
    past = [...past.slice(-99), page.blocks];
    future = [];
  }
  page = next;
  scheduleSave();
  if (options.redraw !== false) {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(draw, 120);
  }
}

const setBlocks = (blocks: Block[], options?: { redraw?: boolean; step?: boolean }): void => {
  if (page && blocks !== page.blocks) change({ ...page, blocks }, options);
};

function undo(): void {
  const previous = past[past.length - 1];
  if (!page || !previous) return;
  past = past.slice(0, -1);
  future = [...future, page.blocks];
  change({ ...page, blocks: previous }, { step: false });
}

function redo(): void {
  const next = future[future.length - 1];
  if (!page || !next) return;
  future = future.slice(0, -1);
  past = [...past, page.blocks];
  change({ ...page, blocks: next }, { step: false });
}

/** A new block goes into the selected group, else right after the selected block, else at the end. */
function add(type: BlockType): void {
  if (!page) return;
  const fresh = createBlock(type);
  const current = selected ? findById(page.blocks, selected) : null;
  if (current && isContainerType(current.type)) {
    setBlocks(insertAt(page.blocks, current.id, current.children?.length ?? 0, fresh));
  } else if (current) {
    const parent = parentIdOf(page.blocks, current.id) ?? null;
    const siblings = parent ? (findById(page.blocks, parent)?.children ?? []) : page.blocks;
    setBlocks(insertAt(page.blocks, parent, siblings.findIndex((b) => b.id === current.id) + 1, fresh));
  } else {
    setBlocks(insertAt(page.blocks, null, page.blocks.length, fresh));
  }
  selected = fresh.id;
  tab = 'content';
}

function act(id: string, action: 'up' | 'down' | 'duplicate' | 'delete'): void {
  if (!page) return;
  if (action === 'up') setBlocks(nudge(page.blocks, id, -1));
  else if (action === 'down') setBlocks(nudge(page.blocks, id, 1));
  else if (action === 'duplicate') setBlocks(duplicate(page.blocks, id));
  else {
    if (selected === id) selected = null;
    setBlocks(removeById(page.blocks, id));
  }
}

const patch = (id: string, fn: (b: Block) => Block, options?: { redraw?: boolean; step?: boolean }): void => {
  if (page) setBlocks(patchById(page.blocks, id, fn), options);
};

function onFrameMessage(event: MessageEvent): void {
  if (event.origin !== location.origin || event.source !== frame?.contentWindow || event.data?.thecms !== true) return;
  const message = event.data as { type: string; id: string | null; path: string; value: unknown; action: 'up' };
  if (message.type === 'ready') {
    frameReady = true;
    draw();
  } else if (message.type === 'select') {
    selected = message.id;
  } else if (message.type === 'edit' && message.id) {
    // Typed on the page: the page already shows it, so nothing is redrawn.
    const key = `${message.id}:${message.path}`;
    const step = key !== typing.key || Date.now() - typing.at > 1500;
    typing = { key, at: Date.now() };
    patch(message.id, (b) => ({ ...b, content: setPath(b.content, message.path, message.value) }), { redraw: false, step });
  } else if (message.type === 'action' && message.id) {
    act(message.id, message.action);
  }
}

async function open(slug: string): Promise<void> {
  try {
    if (saving !== 'saved') await save();
    page = (await api.page(slug)).page;
    selected = null;
    past = [];
    future = [];
    saving = 'saved';
    await draw();
  } catch (error) {
    fail(error);
  }
}

async function createPage(): Promise<void> {
  const title = (newTitle ?? '').trim();
  const slug = slugify(title);
  if (!site || !title || !slug) return;
  try {
    const { pages } = await api.save({ slug, title, description: '', inMenu: true, blocks: [] }, true);
    site = { ...site, pages };
    newTitle = null;
    await open(slug);
  } catch (error) {
    fail(error);
  }
}

async function removePage(): Promise<void> {
  if (!site || !page || page.slug === '') return;
  try {
    clearTimeout(saveTimer);
    saving = 'saved';
    const { pages } = await api.remove(page.slug);
    site = { ...site, pages };
    await open('');
  } catch (error) {
    fail(error);
  }
}

async function publish(): Promise<void> {
  if (!site || !page) return;
  try {
    await save();
    if (saving !== 'saved') return;
    const { pages } = await api.publish(page.slug);
    site = { ...site, pages };
  } catch (error) {
    fail(error);
  }
}

async function chooseTheme(name: string): Promise<void> {
  const theme = site?.themes.find((th) => th.name === name);
  if (!site || !theme) return;
  try {
    site = await api.setTheme(theme);
    themeVersion += 1;
    await draw();
  } catch (error) {
    fail(error);
  }
}

function onKey(event: KeyboardEvent): void {
  if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z') return;
  const target = event.target as HTMLElement;
  if (target.matches('input, textarea, select')) return;
  event.preventDefault();
  if (event.shiftKey) redo();
  else undo();
}

onMount(() => {
  window.addEventListener('message', onFrameMessage);
  (async () => {
    try {
      site = await api.state();
      await open('');
    } catch (error) {
      fail(error);
    }
  })();
  return () => window.removeEventListener('message', onFrameMessage);
});
</script>

<svelte:window onkeydown={onKey} />

{#if !api.hasToken}
  <p class="notice">Open the address that <code>thecms edit</code> printed; it carries the key to this editor.</p>
{:else if !site || !page}
  <p class="notice">{failure || '…'}</p>
{:else}
  <div class="editor">
    <header class="bar">
      <strong>{site.site.name}</strong>
      <button type="button" onclick={undo} disabled={past.length === 0} title={t.bar.undo} aria-label={t.bar.undo}>↶</button>
      <button type="button" onclick={redo} disabled={future.length === 0} title={t.bar.redo} aria-label={t.bar.redo}>↷</button>
      <span class="status" data-state={saving} role="status">{failure && saving === 'error' ? `${t.bar.error}: ${failure}` : t.bar[saving]}</span>
      <span class="grow"></span>
      <label class="inline">
        <span>{t.bar.theme}</span>
        <select value={site.theme.name} onchange={(e) => chooseTheme(e.currentTarget.value)} data-theme>
          {#if !site.themes.some((th) => th.name === site?.theme.name)}<option value={site.theme.name}>{site.theme.name}</option>{/if}
          {#each site.themes as theme}<option value={theme.name}>{theme.name}</option>{/each}
        </select>
      </label>
      <span class="state">{!info?.published ? t.bar.draft : info.changed || saving !== 'saved' ? t.bar.changed : t.bar.published}</span>
      <button type="button" class="primary" onclick={publish} disabled={info?.published && !info.changed && saving === 'saved'}>{t.bar.publish}</button>
    </header>

    <aside class="left">
      <h2>{t.app.pages}</h2>
      <ul class="pages">
        {#each site.pages as p (p.slug)}
          <li>
            <button type="button" class:current={p.slug === page.slug} onclick={() => open(p.slug)}>
              {p.title}{#if !p.published || p.changed}<em title={p.published ? t.bar.changed : t.bar.draft}> •</em>{/if}
            </button>
          </li>
        {/each}
      </ul>
      {#if newTitle === null}
        <button type="button" onclick={() => (newTitle = '')}>+ {t.app.newPage}</button>
      {:else}
        <form
          onsubmit={(e) => {
            e.preventDefault();
            createPage();
          }}
        >
          <!-- svelte-ignore a11y_autofocus -->
          <input type="text" placeholder={t.app.pageTitle} bind:value={newTitle} maxlength="200" autofocus />
          <button type="submit" class="primary" disabled={!slugify(newTitle)}>{t.app.create}</button>
          <button type="button" class="quiet" onclick={() => (newTitle = null)}>{t.app.cancel}</button>
        </form>
      {/if}

      <h2>{t.app.blocks}</h2>
      <ul class="library">
        {#each BLOCK_TYPES as type (type)}
          <li><button type="button" onclick={() => add(type)} data-add={type}>{t.types[type] ?? type}</button></li>
        {/each}
      </ul>
    </aside>

    <main class="canvas">
      <iframe bind:this={frame} src="/preview" title={page.title}></iframe>
    </main>

    <aside class="right">
      {#if block && def}
        <h2>{t.types[block.type] ?? block.type}</h2>
        <div class="tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'content'} onclick={() => (tab = 'content')}>{t.inspector.content}</button>
          <button type="button" role="tab" aria-selected={tab === 'style'} onclick={() => (tab = 'style')}>{t.inspector.style}</button>
        </div>
        {#if tab === 'content'}
          {#key block.id}
            <Fields
              fields={def.fields}
              content={block.content}
              onchange={(path, value) => patch(block.id, (b) => ({ ...b, content: setPath(b.content, path, value) }))}
            />
          {/key}
        {:else}
          {#key block.id}
            <StylePanel
              {block}
              theme={site.theme}
              onstyle={(style: BlockStyle) =>
                patch(block.id, (b) => {
                  const { style: _old, ...rest } = b;
                  return Object.keys(style).length ? { ...rest, style } : rest;
                })}
              onvariant={(variant) =>
                patch(block.id, (b) => {
                  const { variant: _old, ...rest } = b;
                  return variant ? { ...rest, variant } : rest;
                })}
            />
          {/key}
        {/if}
      {:else}
        <h2>{t.inspector.page}</h2>
        <label class="field">
          <span>{t.inspector.title}</span>
          <input type="text" maxlength="200" value={page.title} oninput={(e) => page && e.currentTarget.value.trim() && change({ ...page, title: e.currentTarget.value }, { step: false })} />
        </label>
        <label class="field">
          <span>{t.inspector.description}</span>
          <textarea rows="3" maxlength="300" value={page.description} oninput={(e) => page && change({ ...page, description: e.currentTarget.value }, { step: false, redraw: false })}></textarea>
          <small>{t.inspector.descriptionHint}</small>
        </label>
        <label class="check">
          <input type="checkbox" checked={page.inMenu} onchange={(e) => page && change({ ...page, inMenu: e.currentTarget.checked }, { step: false })} />
          <span>{t.inspector.inMenu}</span>
        </label>
        {#if freeOnPage > 0}
          <p class="hint">{t.style.free(freeOnPage)}</p>
          <button type="button" onclick={() => page && setBlocks(resetToTheme(page.blocks))}>{t.style.resetPage}</button>
        {/if}
        <p class="hint">{t.inspector.nothing}</p>
        {#if page.slug !== ''}
          <button type="button" class="danger" onclick={removePage}>{t.inspector.deletePage}</button>
        {/if}
      {/if}
      {#if failure && saving !== 'error'}<p class="bad" role="alert">{failure}</p>{/if}
    </aside>
  </div>
{/if}

<style>
  :global(html, body) { height: 100%; margin: 0; }
  :global(body) { font: 14px/1.45 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; color: #1c1b22; background: #f3f2f7; }
  :global(*) { box-sizing: border-box; }
  .notice { margin: 4rem auto; max-width: 30rem; text-align: center; }
  .editor { display: grid; height: 100vh; grid-template: 'bar bar bar' auto 'left canvas right' 1fr / 14rem 1fr 19rem; }
  .bar { grid-area: bar; display: flex; align-items: center; gap: 0.6rem; padding: 0.5rem 0.9rem; background: #fff; border-bottom: 1px solid #dddbe6; }
  .grow { flex: 1; }
  .status, .state { color: #6a6880; font-size: 13px; }
  .status[data-state='error'] { color: #b3261e; }
  .left, .right { overflow-y: auto; padding: 0.9rem; background: #fff; }
  .left { grid-area: left; border-right: 1px solid #dddbe6; }
  .right { grid-area: right; border-left: 1px solid #dddbe6; }
  .canvas { grid-area: canvas; padding: 0.9rem; min-width: 0; }
  iframe { width: 100%; height: 100%; border: 1px solid #dddbe6; border-radius: 8px; background: #fff; }
  h2 { margin: 1.1rem 0 0.5rem; font-size: 12px; letter-spacing: 0.06em; text-transform: uppercase; color: #6a6880; }
  h2:first-child { margin-top: 0; }
  ul { list-style: none; margin: 0 0 0.6rem; padding: 0; display: grid; gap: 0.25rem; }
  .library { grid-template-columns: 1fr 1fr; }
  :global(.editor button) { padding: 0.4rem 0.7rem; border: 1px solid #cfccdc; border-radius: 6px; background: #fff; color: inherit; font: inherit; cursor: pointer; }
  :global(.editor button:hover:not(:disabled)) { border-color: #6d5dfc; }
  :global(.editor button:disabled) { opacity: 0.45; cursor: default; }
  :global(.editor button.primary) { background: #6d5dfc; border-color: #6d5dfc; color: #fff; font-weight: 600; }
  :global(.editor button.quiet) { border-color: transparent; color: #6a6880; }
  :global(.editor button.danger) { color: #b3261e; margin-top: 1rem; }
  .pages button, .library button { width: 100%; text-align: start; }
  .pages button.current { border-color: #6d5dfc; background: #f1efff; font-weight: 600; }
  .pages em { color: #c77700; font-style: normal; }
  .tabs { display: flex; gap: 0.25rem; margin-bottom: 0.8rem; }
  .tabs button { flex: 1; }
  .tabs button[aria-selected='true'] { background: #f1efff; border-color: #6d5dfc; font-weight: 600; }
  form { display: grid; gap: 0.35rem; margin-bottom: 0.6rem; }
  :global(.editor .field) { display: block; margin-bottom: 0.7rem; }
  :global(.editor label > span, .editor legend) { display: block; margin-bottom: 0.2rem; font-size: 12.5px; color: #4b4960; }
  :global(.editor input[type='text'], .editor input[type='url'], .editor textarea, .editor select) { width: 100%; padding: 0.4rem 0.5rem; border: 1px solid #cfccdc; border-radius: 6px; background: #fff; color: inherit; font: inherit; }
  :global(.editor input[aria-invalid='true']) { border-color: #b3261e; }
  :global(.editor textarea) { resize: vertical; }
  :global(.editor fieldset) { margin: 0; padding: 0.6rem; border: 1px solid #e4e2ee; border-radius: 6px; }
  :global(.editor fieldset label) { display: block; margin-bottom: 0.5rem; }
  :global(.editor .item) { padding-bottom: 0.5rem; margin-bottom: 0.6rem; border-bottom: 1px dashed #dddbe6; }
  :global(.editor .hint, .editor small) { display: block; color: #6a6880; font-size: 12.5px; }
  :global(.editor .bad) { color: #b3261e; font-size: 12.5px; }
  :global(.editor .own) { color: #c77700; font-style: normal; margin-inline-start: 0.3rem; }
  :global(.editor .custom) { display: flex; gap: 0.3rem; margin-top: 0.3rem; }
  :global(.editor .custom input[type='color']) { width: 2.4rem; padding: 0; border: 1px solid #cfccdc; border-radius: 6px; background: none; }
  .inline { display: flex; align-items: center; gap: 0.4rem; }
  .inline span { margin: 0; }
  .inline select { width: auto; }
  .check { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.8rem; }
  .check span { margin: 0; }
</style>
