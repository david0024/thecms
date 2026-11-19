<script lang="ts">
/**
 * What the extensions turned on offer here in the editor (ADR 0026): on the
 * block being edited, or on the page. What one gives back is put in the
 * editor as a change, to look at, undo or save like any other.
 */
import type { ExtensionPoint } from '../core/index.ts';
import type { ExtensionInfo } from './api.ts';
import { adminLanguage, t } from './messages.ts';

let {
  extensions,
  on,
  languages,
  onrun,
}: { extensions: ExtensionInfo[]; on: ExtensionPoint; languages: { language: string; name: string }[]; onrun: (extension: string, action: string, ask: Record<string, string>) => Promise<void> } = $props();

const word = (extension: ExtensionInfo, text: string): string => extension.messages[adminLanguage()]?.[text] || extension.messages[adminLanguage().split('-')[0] ?? '']?.[text] || text;
const offered = $derived(extensions.filter((e) => e.enabled).flatMap((extension) => extension.actions.filter((a) => a.on === on).map((action) => ({ extension, action }))));
/** The action whose questions are open, and the answers so far. */
let asking = $state<{ key: string; answers: Record<string, string> } | null>(null);
let working = $state('');

async function run(extension: string, action: string, ask: Record<string, string>): Promise<void> {
  working = `${extension}/${action}`;
  try {
    await onrun(extension, action, ask);
    asking = null;
  } finally {
    working = '';
  }
}
</script>

{#if offered.length}
  <div class="tools" data-extension-tools={on}>
    <h3>{t.ext.tools}</h3>
    {#each offered as { extension, action } (`${extension.name}/${action.name}`)}
      {@const key = `${extension.name}/${action.name}`}
      {#if asking?.key === key}
        {@const answers = asking.answers}
        <form class="ask" onsubmit={(e) => (e.preventDefault(), run(extension.name, action.name, answers))}>
          <strong>{word(extension, action.label)}</strong>
          {#each action.ask as question (question.key)}
            <label class="field">
              <span>{word(extension, question.label)}</span>
              {#if question.kind === 'language'}
                <select bind:value={answers[question.key]} data-ask={question.key}>
                  {#each languages as l}<option value={l.language}>{l.name}</option>{/each}
                </select>
              {:else}
                <input type="text" bind:value={answers[question.key]} data-ask={question.key} />
              {/if}
            </label>
          {/each}
          <div class="row">
            <button type="submit" class="primary" disabled={working !== ''} data-run>{working === key ? t.ext.working : t.ext.run}</button>
            <button type="button" class="quiet" onclick={() => (asking = null)}>{t.ext.cancel}</button>
          </div>
        </form>
      {:else}
        <button
          type="button"
          disabled={working !== ''}
          onclick={() => (action.ask.length ? (asking = { key, answers: Object.fromEntries(action.ask.map((q) => [q.key, q.kind === 'language' ? (languages[0]?.language ?? '') : ''])) }) : run(extension.name, action.name, {}))}
          data-extension-action={key}>{working === key ? t.ext.working : `✦ ${word(extension, action.label)}`}</button>
      {/if}
    {/each}
  </div>
{/if}

<style>
  .tools { display: grid; gap: 0.4rem; margin-top: 1.2rem; padding-top: 0.8rem; border-top: 1px solid #e6e4ee; }
  h3 { margin: 0; font-size: 0.85rem; color: #6a6880; text-transform: uppercase; letter-spacing: 0.04em; }
  .tools > button { text-align: start; }
  .ask { display: grid; gap: 0.5rem; padding: 0.6rem; background: #f0eeff; border-radius: 6px; }
  .field { display: grid; gap: 0.2rem; }
  .row { display: flex; gap: 0.4rem; }
</style>
