<script lang="ts">
/**
 * The extensions (ADR 0026), for the owner: what is installed, turned on or
 * off, removed; a new one installed from its file, after the owner has seen
 * what it asks for and accepted that very file.
 */
import { api, type ExtensionInfo, type ExtensionOffer } from './api.ts';
import { say, t } from './messages.ts';

let { extensions, onchange, onopen }: { extensions: ExtensionInfo[]; onchange: (next: ExtensionInfo[]) => void; onopen: (name: string, collection: string) => void } = $props();

let problem = $state('');
let file = $state.raw<File | null>(null);
let offer = $state.raw<ExtensionOffer | null>(null);
/** Removing asks once more, on the same button. */
let removing = $state('');

async function attempt(work: () => Promise<{ extensions: ExtensionInfo[] }>): Promise<void> {
  problem = '';
  try {
    onchange((await work()).extensions);
  } catch (error) {
    problem = error instanceof Error ? error.message : String(error);
  }
}

async function choose(chosen: File | undefined): Promise<void> {
  problem = '';
  offer = null;
  file = chosen ?? null;
  if (!chosen) return;
  try {
    offer = (await api.offerExtension(chosen)).offer;
  } catch (error) {
    problem = error instanceof Error ? error.message : String(error);
  }
}

async function accept(): Promise<void> {
  if (!file || !offer) return;
  const [sent, sha] = [file, offer.sha256];
  await attempt(() => api.installExtension(sent, sha));
  if (!problem) {
    file = null;
    offer = null;
  }
}
</script>

<section class="screen" data-list="extensions">
  <h1>{t.ext.heading}</h1>
  <p class="hint">{t.ext.intro}</p>
  {#if problem}<p class="bad" role="alert">{problem}</p>{/if}

  {#if extensions.length === 0}
    <p data-no-extensions>{t.ext.none}</p>
  {:else}
    <ul class="cards">
      {#each extensions as extension (extension.name)}
        <li data-extension={extension.name}>
          <div class="who">
            <strong>{extension.displayName}</strong>
            <small>{extension.version}{extension.publisher ? ` · ${say(t.ext.by, { publisher: extension.publisher })}` : ''}</small>
            {#if extension.description}<p>{extension.description}</p>{/if}
          </div>
          <label class="check">
            <input type="checkbox" checked={extension.enabled} onchange={(e) => attempt(() => api.enableExtension(extension.name, e.currentTarget.checked))} data-extension-on />
            <span>{extension.enabled ? t.ext.on : t.ext.off}</span>
          </label>
          {#if extension.enabled}
            {#each extension.views ?? [] as view (view.collection)}
              <button type="button" onclick={() => onopen(extension.name, view.collection)} data-extension-view={view.collection}>{view.title}</button>
            {/each}
          {/if}
          {#if removing === extension.name}
            <button type="button" class="quiet bad" onclick={() => attempt(() => api.uninstallExtension(extension.name))} data-extension-remove-sure>{t.ext.removeSure}</button>
          {:else}
            <button type="button" class="quiet" onclick={() => (removing = extension.name)} data-extension-remove>{t.ext.remove}</button>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  <h2>{t.ext.install}</h2>
  <label class="field">
    <span>{t.ext.file}</span>
    <input type="file" accept=".thecms-extension,application/json" onchange={(e) => choose(e.currentTarget.files?.[0])} data-extension-file />
  </label>
  {#if offer}
    <div class="offer" data-offer>
      <p>
        <strong>{offer.manifest.displayName} {offer.manifest.version}</strong>
        {#if offer.manifest.publisher}<small>{say(t.ext.by, { publisher: offer.manifest.publisher })}</small>{/if}
      </p>
      {#if offer.manifest.description}<p>{offer.manifest.description}</p>{/if}
      {#if offer.replaces}<p>{say(t.ext.replaces, { version: offer.replaces })}</p>{/if}
      <p>{t.ext.asks}</p>
      <ul data-asks>
        {#if offer.asks.collections.length}<li>{say(t.ext.keeps, { list: offer.asks.collections.join(', ') })}</li>{/if}
        {#if offer.asks.secrets.length}<li>{say(t.ext.secrets, { list: offer.asks.secrets.join(', ') })}</li>{/if}
        <li>{offer.asks.egress.length ? say(t.ext.calls, { list: offer.asks.egress.join(', ') }) : t.ext.callsNothing}</li>
        {#each offer.asks.points as point}
          <li>{say(point.on === 'page' ? t.ext.onPage : t.ext.onBlock, { action: point.action })}</li>
        {/each}
      </ul>
      <small class="sum">{say(t.ext.checksum, { sha: offer.sha256 })}</small>
      <div class="row">
        <button type="button" class="primary" onclick={accept} data-accept>{t.ext.accept}</button>
        <button type="button" class="quiet" onclick={() => ((offer = null), (file = null))}>{t.ext.cancel}</button>
      </div>
    </div>
  {/if}
</section>

<style>
  h1 { margin: 0 0 0.5rem; font-size: 1.4rem; }
  h2 { margin: 2rem 0 0.5rem; font-size: 1.05rem; }
  .cards { list-style: none; margin: 1rem 0 0; padding: 0; display: grid; gap: 0.5rem; max-width: 46rem; }
  .cards li { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem 0.8rem; padding: 0.7rem 1rem; background: #fff; border: 1px solid #dddbe6; border-radius: 8px; }
  .who { flex: 1 1 16rem; }
  .who p { margin: 0.2rem 0 0; color: #4a4860; }
  .who small { margin-inline-start: 0.5rem; color: #6a6880; }
  .field { display: grid; gap: 0.3rem; max-width: 46rem; }
  .offer { max-width: 46rem; margin: 1rem 0; padding: 0.8rem 1rem; background: #f0eeff; border: 1px solid #c9c2ff; border-radius: 8px; }
  .offer p { margin: 0 0 0.4rem; }
  .offer ul { margin: 0 0 0.6rem; }
  .sum { display: block; margin-bottom: 0.6rem; color: #6a6880; overflow-wrap: anywhere; }
  .row { display: flex; flex-wrap: wrap; gap: 0.5rem; }
</style>
