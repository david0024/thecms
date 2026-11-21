<script lang="ts">
/** A video (ADR 0047): from the library, played by the browser itself, or from YouTube or Vimeo, by their player. */
import { type Block, embedOf, type VideoContent } from '../core/index.ts';
import { isEditing, marker } from './editing.ts';
import Player from './Player.svelte';

let { block }: { block: Block } = $props();
const c = $derived(block.content as unknown as VideoContent);
const editing = isEditing();
const mark = marker();
const embed = $derived(c.video ? embedOf(c.video.src) : null);
</script>

{#if c.video}
  <figure class="figure">
    {#if embed}
      <Player {embed} title={c.title} />
    {:else}
      <!-- A caption track is a file of its own, not yet in the library: the caption below says what the video shows. -->
      <!-- svelte-ignore a11y_media_has_caption -->
      <video class="video" src={c.video.src} poster={c.poster?.src} title={c.title || undefined} controls preload="metadata" playsinline></video>
    {/if}
    {#if c.caption || editing}<figcaption data-edit={mark('caption')}>{c.caption}</figcaption>{/if}
  </figure>
{:else if editing}
  <div class="cms-empty" data-empty="video"></div>
{/if}
