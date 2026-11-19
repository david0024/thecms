<script lang="ts">
/**
 * An extension's screen (ADR 0026): one of its collections as a list, and a
 * form for a row, drawn from what the extension declared. No code of the
 * extension runs here. A secret is never shown again: left empty, it stays.
 */
import { onMount } from 'svelte';
import type { ExtensionCollection, ExtensionView } from '../core/index.ts';
import { api, type ExtensionInfo } from './api.ts';
import { adminLanguage, t } from './messages.ts';

let { extension, view, collection }: { extension: ExtensionInfo; view: ExtensionView; collection: ExtensionCollection } = $props();

const word = (text: string): string => extension.messages[adminLanguage()]?.[text] || extension.messages[adminLanguage().split('-')[0] ?? '']?.[text] || text;
let rows = $state.raw<Record<string, unknown>[]>([]);
let problem = $state('');
/** The row being written: a new one (id null), or one being changed. */
let draft = $state<{ id: string | null; row: Record<string, unknown> } | null>(null);

async function attempt(work: () => Promise<{ rows: Record<string, unknown>[] }>): Promise<boolean> {
  problem = '';
  try {
    rows = (await work()).rows;
    return true;
  } catch (error) {
    problem = error instanceof Error ? error.message : String(error);
    return false;
  }
}

const blank = (): Record<string, unknown> => Object.fromEntries(collection.fields.map((f) => [f.key, f.kind === 'secret' ? '' : f.initial ?? (f.kind === 'boolean' ? false : '')]));
const start = (row: Record<string, unknown> | null): void => {
  draft = row ? { id: String(row.id), row: Object.fromEntries(collection.fields.map((f) => [f.key, f.kind === 'secret' ? '' : (row[f.key] ?? '')])) } : { id: null, row: blank() };
};
async function save(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  if (!draft) return;
  const { id, row } = draft;
  if (await attempt(() => api.saveExtensionRow(extension.name, collection.name, row, id))) draft = null;
}
const shown = (value: unknown): string => (value === true ? '✓' : value === false ? '–' : value === null || value === undefined ? '' : String(value));

onMount(() => void attempt(() => api.extensionRows(extension.name, collection.name)));
</script>

<section class="screen" data-extension-screen={`${extension.name}/${collection.name}`}>
  <h1>{word(view.title)}</h1>
  <p class="hint">{extension.displayName}</p>
  {#if problem}<p class="bad" role="alert">{problem}</p>{/if}

  {#if draft}
    {@const editing = draft}
    <form class="form" onsubmit={save} data-extension-form>
      {#each collection.fields as field (field.key)}
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
      <div class="row">
        <button type="submit" class="primary" data-extension-save>{t.ext.save}</button>
        <button type="button" class="quiet" onclick={() => (draft = null)}>{t.ext.cancel}</button>
      </div>
    </form>
  {:else if view.create}
    <button type="button" class="primary" onclick={() => start(null)} data-extension-add>+ {t.ext.add}</button>
  {/if}

  {#if rows.length === 0}
    <p class="hint">{t.ext.empty}</p>
  {:else}
    <table>
      <thead>
        <tr>
          {#each view.columns as key}<th>{word(collection.fields.find((f) => f.key === key)?.label ?? key)}</th>{/each}
          <th></th>
        </tr>
      </thead>
      <tbody>
        {#each rows as row (row.id)}
          <tr data-row={row.id}>
            {#each view.columns as key}<td>{shown(row[key])}</td>{/each}
            <td class="end">
              {#if view.edit}<button type="button" class="quiet" onclick={() => start(row)} data-extension-edit>{t.ext.edit}</button>{/if}
              {#if view.remove}<button type="button" class="quiet" onclick={() => attempt(() => api.deleteExtensionRow(extension.name, collection.name, String(row.id)))} data-extension-delete>{t.ext.delete}</button>{/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</section>

<style>
  h1 { margin: 0 0 0.3rem; font-size: 1.4rem; }
  .form { display: grid; gap: 0.7rem; max-width: 36rem; margin: 1rem 0; padding: 1rem; background: #fff; border: 1px solid #dddbe6; border-radius: 8px; }
  .field { display: grid; gap: 0.3rem; }
  .row { display: flex; gap: 0.5rem; }
  table { margin-top: 1rem; border-collapse: collapse; min-width: 30rem; background: #fff; }
  th, td { padding: 0.45rem 0.7rem; border-bottom: 1px solid #e6e4ee; text-align: start; }
  .end { text-align: end; white-space: nowrap; }
</style>
