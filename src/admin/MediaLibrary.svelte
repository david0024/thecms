<script lang="ts">
/**
 * Every file the site holds, in one place: images (ADR 0005), documents, sound
 * and video (ADR 0046). Upload, look, delete. A file a page still shows or
 * links to is not deleted; the server says where it is used.
 */
import { onMount } from 'svelte';
import { api, type MediaItem } from './api.ts';
import { say, t } from './messages.ts';
import { ACCEPT_FILES, missing, prepareAll, uploadFile } from './sizes.ts';

let items = $state.raw<MediaItem[] | null>(null);
let busy = $state(false);
let problem = $state('');
let fileInput: HTMLInputElement | undefined = $state();
/** The smaller copies being made: how many pictures are done, of how many. */
let sizing = $state<{ done: number; count: number } | null>(null);
/** Which kind of file is shown; empty for all. */
let only = $state<'' | MediaItem['kind']>('');
const kinds = $derived([...new Set((items ?? []).map((item) => item.kind))]);
const shown = $derived((items ?? []).filter((item) => !only || item.kind === only));
/** What a file is, in a few letters: PDF, DOCX, MP3. */
const badge = (name: string): string => (name.split('.').pop() ?? '').toUpperCase();

const attempt = async (work: () => Promise<{ media: MediaItem[] }>): Promise<void> => {
  problem = '';
  try {
    items = (await work()).media;
  } catch (error) {
    problem = error instanceof Error ? error.message : String(error);
  }
};

async function upload(event: Event): Promise<void> {
  const files = [...((event.currentTarget as HTMLInputElement).files ?? [])];
  busy = true;
  for (const file of files) await attempt(() => uploadFile(file));
  busy = false;
  if (fileInput) fileInput.value = '';
}

const size = (bytes: number): string => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

/** Pictures uploaded before they were made get their smaller copies here, once (ADR 0005 d8). */
async function prepare(): Promise<void> {
  if (!items || sizing) return;
  items = await prepareAll(items, (done, count) => (sizing = { done, count }));
  sizing = null;
}

onMount(async () => {
  await attempt(api.media);
  await prepare();
});
</script>

<section class="screen" data-list="media">
  <header>
    <h1>{t.nav.media}</h1>
    <button type="button" class="primary" onclick={() => fileInput?.click()} disabled={busy}>{busy ? t.media.uploading : t.media.uploadFile}</button>
    <input type="file" multiple accept={ACCEPT_FILES} bind:this={fileInput} onchange={upload} hidden data-library-file />
  </header>
  <p class="hint">{t.media.accepts}</p>
  {#if kinds.length > 1}
    <div class="kinds" role="group">
      <button type="button" class="quiet" aria-pressed={only === ''} onclick={() => (only = '')}>{t.media.all}</button>
      {#each kinds as kind (kind)}<button type="button" class="quiet" aria-pressed={only === kind} onclick={() => (only = kind)} data-media-kind={kind}>{t.media.kinds[kind] ?? kind}</button>{/each}
    </div>
  {/if}
  {#if problem}<p class="bad" role="alert">{problem}</p>{/if}
  {#if sizing}
    <p class="hint" data-media-sizing>{say(t.media.sizing, sizing)}</p>
  {:else if items?.some((item) => missing(item).length > 0)}
    <p><button type="button" class="quiet" onclick={prepare} data-media-sizes>{t.media.sizes}</button></p>
  {/if}
  {#if items && items.length === 0}
    <p class="hint">{t.media.empty}</p>
  {:else if items}
    <ul>
      {#each shown as item (item.name)}
        <li data-media-item={item.name}>
          {#if item.kind === 'image'}
            <img src={item.path} alt="" loading="lazy" />
          {:else if item.kind === 'video'}
            <!-- svelte-ignore a11y_media_has_caption -->
            <video src={item.path} preload="metadata" controls></video>
          {:else}
            <a class="file" href={item.path} target="_blank" rel="noopener" data-kind={item.kind}>{badge(item.name)}</a>
          {/if}
          {#if item.kind === 'audio'}<audio src={item.path} preload="none" controls></audio>{/if}
          <span class="label" title={item.label}>{item.label || item.name}</span>
          <small>{size(item.size)}</small>
          <button type="button" class="quiet" onclick={() => attempt(() => api.removeMedia(item.name))}>{item.kind === 'image' ? t.media.remove : t.media.removeFile}</button>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  header { display: flex; align-items: center; gap: 1rem; margin-bottom: 1rem; }
  h1 { margin: 0; font-size: 1.4rem; flex: 1; }
  ul { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr)); gap: 0.8rem; }
  li { display: grid; gap: 0.25rem; padding: 0.6rem; background: #fff; border: 1px solid #dddbe6; border-radius: 8px; }
  img, video, .file { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; border-radius: 4px; background: #f3f2f7; }
  .file { display: grid; place-items: center; font-weight: 700; font-size: 1.3rem; color: #4b4867; text-decoration: none; }
  audio { width: 100%; }
  .kinds { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-bottom: 1rem; }
  .kinds [aria-pressed='true'] { font-weight: 700; text-decoration: underline; }
  .label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
</style>
