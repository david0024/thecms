<script lang="ts">
/**
 * Every image the site holds (ADR 0005), in one place: upload, look, delete.
 * An image a page still shows is not deleted; the server says where it is used.
 */
import { onMount } from 'svelte';
import { api, type MediaItem } from './api.ts';
import { t } from './messages.ts';
import { shrink } from './shrink.ts';

let items = $state.raw<MediaItem[] | null>(null);
let busy = $state(false);
let problem = $state('');
let fileInput: HTMLInputElement | undefined = $state();

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
  for (const file of files) await attempt(async () => api.upload(await shrink(file), file.name));
  busy = false;
  if (fileInput) fileInput.value = '';
}

const size = (bytes: number): string => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

onMount(() => void attempt(api.media));
</script>

<section class="screen" data-list="media">
  <header>
    <h1>{t.nav.media}</h1>
    <button type="button" class="primary" onclick={() => fileInput?.click()} disabled={busy}>{busy ? t.media.uploading : t.media.upload}</button>
    <input type="file" multiple accept="image/png,image/jpeg,image/gif,image/webp,image/avif" bind:this={fileInput} onchange={upload} hidden data-library-file />
  </header>
  {#if problem}<p class="bad" role="alert">{problem}</p>{/if}
  {#if items && items.length === 0}
    <p class="hint">{t.media.empty}</p>
  {:else if items}
    <ul>
      {#each items as item (item.name)}
        <li data-media-item={item.name}>
          <img src={item.path} alt="" loading="lazy" />
          <span class="label" title={item.label}>{item.label || item.name}</span>
          <small>{size(item.size)}</small>
          <button type="button" class="quiet" onclick={() => attempt(() => api.removeMedia(item.name))}>{t.media.remove}</button>
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
  img { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; border-radius: 4px; background: #f3f2f7; }
  .label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
</style>
