<script lang="ts">
/**
 * One image field: upload a picture, pick one already uploaded, or point at
 * an address elsewhere. The words describing the picture belong to the place
 * it is used, so they are kept with the block, not with the file.
 */
import type { ImageValue } from '../core/index.ts';
import { api, type MediaItem } from './api.ts';
import { t } from './messages.ts';
import { shrink } from './shrink.ts';

let { label, value, onchange }: { label: string; value: ImageValue | null; onchange: (value: ImageValue) => void } = $props();

let library = $state.raw<MediaItem[] | null>(null);
let busy = $state(false);
let problem = $state('');
let fileInput: HTMLInputElement | undefined = $state();

const src = $derived(value?.src ?? '');
const alt = $derived(value?.alt ?? '');

async function upload(event: Event): Promise<void> {
  const file = (event.currentTarget as HTMLInputElement).files?.[0];
  if (!file) return;
  busy = true;
  problem = '';
  try {
    const { item, media } = await api.upload(await shrink(file), file.name);
    if (library) library = media;
    onchange({ src: item.path, alt });
  } catch (error) {
    problem = error instanceof Error ? error.message : String(error);
  }
  busy = false;
  if (fileInput) fileInput.value = '';
}

async function toggleLibrary(): Promise<void> {
  problem = '';
  if (library) {
    library = null;
    return;
  }
  try {
    library = (await api.media()).media;
  } catch (error) {
    problem = error instanceof Error ? error.message : String(error);
  }
}

async function remove(name: string): Promise<void> {
  problem = '';
  try {
    library = (await api.removeMedia(name)).media;
  } catch (error) {
    problem = error instanceof Error ? error.message : String(error);
  }
}
</script>

<fieldset data-image-field>
  <legend>{label}</legend>
  {#if src}<img class="preview" {src} alt="" />{/if}
  <div class="actions">
    <button type="button" onclick={() => fileInput?.click()} disabled={busy}>{busy ? t.media.uploading : t.media.upload}</button>
    <button type="button" onclick={toggleLibrary} aria-expanded={library !== null} data-media-library>{t.media.library}</button>
    {#if src}<button type="button" class="quiet" onclick={() => onchange({ src: '', alt })}>{t.inspector.remove}</button>{/if}
  </div>
  <input type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/avif" bind:this={fileInput} onchange={upload} hidden data-media-file />
  {#if problem}<p class="bad" role="alert">{problem}</p>{/if}
  {#if library}
    {#if library.length === 0}
      <p class="hint">{t.media.empty}</p>
    {:else}
      <ul class="grid">
        {#each library as item (item.name)}
          <li>
            <button type="button" class="pick" class:current={item.path === src} onclick={() => onchange({ src: item.path, alt })} title={item.label} data-media={item.name}>
              <img src={item.path} alt={item.label} loading="lazy" />
            </button>
            <button type="button" class="quiet drop" onclick={() => remove(item.name)} title={t.media.remove} aria-label={`${t.media.remove}: ${item.label}`}>✕</button>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
  <label><span>{t.inspector.imageAlt}</span>
    <input type="text" maxlength="300" value={alt} oninput={(e) => onchange({ src, alt: e.currentTarget.value })} data-image-alt />
  </label>
  <details>
    <summary>{t.media.elsewhere}</summary>
    <label><span>{t.inspector.imageSrc}</span>
      <input type="url" value={src} oninput={(e) => onchange({ src: e.currentTarget.value, alt })} data-image-src />
    </label>
  </details>
</fieldset>

<style>
  .preview { display: block; width: 100%; max-height: 9rem; object-fit: contain; margin-bottom: 0.5rem; border-radius: 4px; background: #f3f2f7; }
  .actions { display: flex; flex-wrap: wrap; gap: 0.3rem; margin-bottom: 0.5rem; }
  .grid { list-style: none; margin: 0 0 0.6rem; padding: 0; display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.35rem; }
  .grid li { position: relative; }
  .pick { display: block; width: 100%; aspect-ratio: 1; padding: 2px !important; overflow: hidden; }
  .pick.current { border-color: #6d5dfc !important; box-shadow: 0 0 0 2px #6d5dfc; }
  .pick img { width: 100%; height: 100%; object-fit: cover; border-radius: 3px; }
  .drop { position: absolute; top: 2px; inset-inline-end: 2px; padding: 0 0.3rem !important; background: rgb(255 255 255 / 0.85) !important; line-height: 1.4; }
  summary { cursor: pointer; font-size: 12.5px; color: #6a6880; margin-bottom: 0.4rem; }
</style>
