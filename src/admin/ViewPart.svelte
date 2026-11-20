<script lang="ts">
/**
 * One `thecms.view/1` view of an extension's screen (ADR 0031), drawn by this
 * admin: a list of a collection's rows, a form (the collection's one row, or
 * an action's questions), or tabs of other views. No code of the extension
 * runs here: rows come from the program, and a button runs a declared action
 * through it. What is drawn and how is this admin's; what is shown and done is
 * the view's.
 */
import { onMount } from 'svelte';
import type { ExtensionCollection, ExtensionField } from '../core/index.ts';
import { type ActionButton, type Button, buttonsFor, listRows, readActionResult, resolveInput, shownFields, type View } from '../view/index.ts';
import { api, type ExtensionInfo } from './api.ts';
import { adminLanguage, t } from './messages.ts';
import Self from './ViewPart.svelte';

let { extension, view, onnavigate }: { extension: ExtensionInfo; view: View; onnavigate: (id: string) => void } = $props();

const word = (text: string): string => extension.messages[adminLanguage()]?.[text] || extension.messages[adminLanguage().split('-')[0] ?? '']?.[text] || text;
const collection = $derived<ExtensionCollection | null>('collection' in view ? (extension.collections?.find((c) => c.name === view.collection) ?? null) : null);
const formAction = $derived(view.type === 'form' && 'action' in view ? (extension.actions.find((a) => a.name === view.action) ?? null) : null);

let rows = $state.raw<Record<string, unknown>[]>([]);
let problem = $state('');
let notice = $state('');
let revealed = $state('');
/** The row being written: a new one (id null), or one being changed. */
let draft = $state<{ id: string | null; row: Record<string, unknown> } | null>(null);
/** A button waiting for its answers or its confirmation, on the row it is on. */
let pending = $state<{ key: string; button: ActionButton; row: Record<string, unknown> | null; answers: Record<string, string>; asked: boolean } | null>(null);
let working = $state(false);
let tab = $state(0);

async function attempt(work: () => Promise<void>): Promise<boolean> {
  problem = '';
  notice = '';
  try {
    await work();
    return true;
  } catch (error) {
    problem = error instanceof Error ? error.message : String(error);
    return false;
  }
}
const load = (): Promise<boolean> => (collection ? attempt(async () => void (rows = (await api.extensionRows(extension.name, (collection as ExtensionCollection).name)).rows)) : Promise.resolve(true));

const labelOf = (key: string, label?: string): string => word(label ?? collection?.fields.find((f) => f.key === key)?.label ?? formAction?.ask.find((a) => a.key === key)?.label ?? key);
const blank = (fields: ExtensionField[]): Record<string, unknown> => Object.fromEntries(fields.map((f) => [f.key, f.kind === 'secret' ? '' : (f.initial ?? (f.kind === 'boolean' ? false : ''))]));
const editable = (row: Record<string, unknown>, fields: ExtensionField[]): Record<string, unknown> => Object.fromEntries(fields.map((f) => [f.key, f.kind === 'secret' ? '' : (row[f.key] ?? '')]));
const shown = (value: unknown): string => (value === true ? '✓' : value === false ? '–' : value === null || value === undefined ? '' : String(value));

/** The singleton form starts from the collection's one row, when it has one. */
async function startSingle(): Promise<void> {
  if (!collection) return;
  if (await load()) draft = rows[0] ? { id: String(rows[0].id), row: editable(rows[0], collection.fields) } : { id: null, row: blank(collection.fields) };
}

async function save(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  if (!draft || !collection) return;
  const { id, row } = draft;
  const of = collection.name;
  const ok = await attempt(async () => void (rows = (await api.saveExtensionRow(extension.name, of, row, id)).rows));
  if (!ok) return;
  if (view.type === 'list') draft = null;
  else {
    notice = t.ext.done;
    await startSingle();
  }
}

const keyOf = (button: Button, row: Record<string, unknown> | null): string => `${'action' in button ? button.action : button.navigate}/${row ? String(row.id) : ''}`;

/** A button: opens a view, or runs its action once what it asks is answered and it is confirmed. */
function press(button: Button, row: Record<string, unknown> | null): void {
  if ('navigate' in button) return onnavigate(button.navigate);
  const ask = (button.prompt ?? []).length > 0;
  if (!ask && !button.confirm) return void run(button, row, {});
  pending = { key: keyOf(button, row), button, row, answers: Object.fromEntries((button.prompt ?? []).map((k) => [k, ''])), asked: !ask };
}

async function run(button: Pick<ActionButton, 'action' | 'input'>, row: Record<string, unknown> | null, answers: Record<string, string>): Promise<void> {
  working = true;
  revealed = '';
  const input = { ...resolveInput(button.input, row), ...answers };
  try {
    await attempt(async () => {
      const result = readActionResult((await api.runExtensionAction(extension.name, button.action, input)).answer);
      pending = null;
      if (result.kind === 'navigate') return onnavigate(result.view);
      if (result.kind === 'reveal') revealed = result.text;
      await load();
      notice = result.kind === 'values' ? t.ext.done : '';
    });
  } finally {
    working = false;
  }
}

/** A form over an action: its questions, and its button. */
let answers = $state<Record<string, string>>({});
async function submitAction(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  if (formAction) await run({ action: formAction.name }, null, answers);
}

onMount(() => {
  if (view.type === 'list') void load();
  if (view.type === 'form' && 'singleton' in view) void startSingle();
  if (formAction) answers = Object.fromEntries(formAction.ask.map((a) => [a.key, '']));
});
</script>

{#snippet buttons(list: Button[], row: Record<string, unknown> | null)}
  {#each buttonsFor(list, row) as button (keyOf(button, row))}
    {@const key = keyOf(button, row)}
    {#if pending?.key === key && 'action' in button}
      {@const waiting = pending}
      <form class="ask" onsubmit={(e) => (e.preventDefault(), run(waiting.button, waiting.row, waiting.answers))} data-view-ask={key}>
        {#each waiting.button.prompt ?? [] as question (question)}
          <label class="field"><span>{labelOf(question)}</span><input type="text" bind:value={waiting.answers[question]} data-ask={question} /></label>
        {/each}
        {#if button.confirm}<p>{word(button.confirm)}</p>{/if}
        <span class="row">
          <button type="submit" class="primary" data-tone={button.tone} disabled={working} data-view-sure>{working ? t.ext.working : button.confirm ? t.ext.sure : t.ext.run}</button>
          <button type="button" class="quiet" onclick={() => (pending = null)}>{t.ext.cancel}</button>
        </span>
      </form>
    {:else}
      <button type="button" class="quiet" data-tone={button.tone} disabled={working} onclick={() => press(button, row)} data-view-button={key}>{word(button.label)}</button>
    {/if}
  {/each}
{/snippet}

{#snippet fieldInputs(fields: ExtensionField[], editing: { id: string | null; row: Record<string, unknown> })}
  {#each fields as field (field.key)}
    {#if field.kind === 'boolean'}
      <label class="check">
        <input type="checkbox" checked={editing.row[field.key] === true} onchange={(e) => (editing.row[field.key] = e.currentTarget.checked)} data-field={field.key} />
        <span>{word(field.label)}</span>
      </label>
    {:else}
      <label class="field">
        <span>{word(field.label)}{field.required ? ' *' : ''}</span>
        {#if field.kind === 'longtext'}
          <textarea rows="5" value={String(editing.row[field.key] ?? '')} oninput={(e) => (editing.row[field.key] = e.currentTarget.value)} data-field={field.key}></textarea>
        {:else if field.kind === 'choice'}
          <select value={String(editing.row[field.key] ?? '')} onchange={(e) => (editing.row[field.key] = e.currentTarget.value)} data-field={field.key}>
            <option value=""></option>
            {#each field.options as option}<option value={option}>{word(option)}</option>{/each}
          </select>
        {:else}
          <input
            type={field.kind === 'secret' ? 'password' : field.kind === 'number' ? 'number' : field.kind === 'url' ? 'url' : 'text'}
            value={String(editing.row[field.key] ?? '')}
            autocomplete="off"
            oninput={(e) => (editing.row[field.key] = field.kind === 'number' && e.currentTarget.value !== '' ? Number(e.currentTarget.value) : e.currentTarget.value)}
            data-field={field.key}
          />
        {/if}
        {#if field.kind === 'secret' && editing.id}<small>{t.ext.secretSet}</small>{/if}
      </label>
    {/if}
  {/each}
{/snippet}

<div class="view" data-view={view.type} data-view-id={view.id}>
  {#if view.title && view.type !== 'tabs'}<h2>{word(view.title)}</h2>{/if}
  {#if problem}<p class="bad" role="alert">{problem}</p>{/if}
  {#if notice}<p class="good" role="status">{notice}</p>{/if}
  {#if revealed}<div class="reveal" data-reveal><p>{t.ext.reveal}</p><code>{revealed}</code></div>{/if}
  {#if view.actions?.length}<div class="row toolbar">{@render buttons(view.actions, null)}</div>{/if}

  {#if view.type === 'tabs'}
    <div class="tabs" role="tablist">
      {#each view.views as inner, i (i)}
        <button type="button" role="tab" aria-selected={tab === i} class:on={tab === i} onclick={() => (tab = i)} data-view-tab={i}>{word(inner.title ?? '')}</button>
      {/each}
    </div>
    {#key tab}
      {@const inner = view.views[tab]}
      {#if inner}<Self {extension} view={inner} {onnavigate} />{/if}
    {/key}
  {:else if view.type === 'form' && formAction}
    <form class="form" onsubmit={submitAction} data-view-form={formAction.name}>
      {#each shownFields(view.fields, formAction.ask) as field (field.key)}
        <label class="field"><span>{labelOf(field.key, field.label)}</span><input type="text" bind:value={answers[field.key]} data-ask={field.key} /></label>
      {/each}
      <div class="row"><button type="submit" class="primary" disabled={working} data-view-submit>{working ? t.ext.working : word('submit' in view && view.submit ? view.submit : formAction.label)}</button></div>
    </form>
  {:else if view.type === 'form' && collection && draft}
    {@const fields = view.fields ? shownFields(view.fields, collection.fields).map((s) => collection.fields.find((f) => f.key === s.key)).filter((f) => f !== undefined) : collection.fields}
    <form class="form" onsubmit={save} data-extension-form>
      {@render fieldInputs(fields, draft)}
      <div class="row"><button type="submit" class="primary" data-extension-save>{t.ext.save}</button></div>
    </form>
  {:else if view.type === 'list' && collection}
    {@const columns = shownFields(view.fields, collection.fields)}
    {#if draft}
      <form class="form" onsubmit={save} data-extension-form>
        {@render fieldInputs(collection.fields, draft)}
        <div class="row">
          <button type="submit" class="primary" data-extension-save>{t.ext.save}</button>
          <button type="button" class="quiet" onclick={() => (draft = null)}>{t.ext.cancel}</button>
        </div>
      </form>
    {:else if view.create !== false}
      <button type="button" class="primary" onclick={() => (draft = { id: null, row: blank(collection.fields) })} data-extension-add>+ {t.ext.add}</button>
    {/if}
    {@const shownRows = listRows(rows, view.filter, view.sort)}
    {#if shownRows.length === 0}
      <p class="hint">{t.ext.empty}</p>
    {:else}
      <table>
        <thead>
          <tr>
            {#each columns as column (column.key)}<th>{labelOf(column.key, column.label)}</th>{/each}
            <th></th>
          </tr>
        </thead>
        <tbody>
          {#each shownRows as row (row.id)}
            <tr data-row={row.id}>
              {#each columns as column (column.key)}
                <td>
                  {#if column.display === 'badge' && row[column.key] !== null && row[column.key] !== ''}
                    <span class="badge" data-tone={column.tones[String(row[column.key])] ?? 'neutral'}>{word(shown(row[column.key]))}</span>
                  {:else}{shown(row[column.key])}{/if}
                </td>
              {/each}
              <td class="end">
                {@render buttons(view.rowActions ?? [], row)}
                {#if view.edit !== false}<button type="button" class="quiet" onclick={() => collection && (draft = { id: String(row.id), row: editable(row, collection.fields) })} data-extension-edit>{t.ext.edit}</button>{/if}
                {#if view.delete !== false}
                  {#if pending?.key === `delete/${String(row.id)}`}
                    <button type="button" class="quiet" data-tone="danger" onclick={() => attempt(async () => void ((rows = (await api.deleteExtensionRow(extension.name, collection?.name ?? '', String(row.id))).rows), (pending = null)))} data-extension-delete-sure>{t.ext.sure}</button>
                  {:else}
                    <button type="button" class="quiet" onclick={() => (pending = { key: `delete/${String(row.id)}`, button: { label: '', action: '' }, row, answers: {}, asked: true })} data-extension-delete>{t.ext.delete}</button>
                  {/if}
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  {/if}
</div>

<style>
  h2 { margin: 1rem 0 0.4rem; font-size: 1.05rem; }
  .form { display: grid; gap: 0.7rem; max-width: 36rem; margin: 1rem 0; padding: 1rem; background: #fff; border: 1px solid #dddbe6; border-radius: 8px; }
  .ask { display: inline-grid; gap: 0.4rem; padding: 0.5rem; background: #f0eeff; border-radius: 6px; }
  .field { display: grid; gap: 0.3rem; }
  .row { display: flex; flex-wrap: wrap; gap: 0.5rem; }
  .toolbar { margin: 0.6rem 0; }
  .tabs { display: flex; gap: 0.3rem; margin: 0.8rem 0 0.2rem; border-bottom: 1px solid #dddbe6; }
  .tabs button { border-bottom-left-radius: 0; border-bottom-right-radius: 0; }
  .tabs button.on { background: #f0eeff; border-color: #6d5dfc; }
  table { margin-top: 1rem; border-collapse: collapse; min-width: 30rem; background: #fff; }
  th, td { padding: 0.45rem 0.7rem; border-bottom: 1px solid #e6e4ee; text-align: start; }
  .end { text-align: end; white-space: nowrap; }
  .badge { display: inline-block; padding: 0.05rem 0.45rem; border-radius: 999px; background: #eceaf3; font-size: 0.85rem; }
  [data-tone='success'] { color: #1d6b3a; }
  [data-tone='warning'] { color: #8a5a00; }
  [data-tone='danger'] { color: #b3261e; }
  [data-tone='muted'] { color: #6a6880; }
  .view button.quiet[data-tone='success'] { color: #1d6b3a; }
  .view button.quiet[data-tone='warning'] { color: #8a5a00; }
  .view button.quiet[data-tone='danger'] { color: #b3261e; }
  .badge[data-tone='success'] { background: #e3f4e8; }
  .badge[data-tone='warning'] { background: #fdf0d5; }
  .badge[data-tone='danger'] { background: #fbe4e2; }
  .good { color: #1d6b3a; }
  .reveal { margin: 0.6rem 0; padding: 0.6rem 0.8rem; background: #fff8e5; border: 1px solid #e8c66b; border-radius: 6px; }
  .reveal code { overflow-wrap: anywhere; }
</style>
