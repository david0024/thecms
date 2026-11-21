<script lang="ts">
/** Sound (ADR 0047): a file from the library, played by the browser, or a song or a show from Spotify or SoundCloud. */
import { type AudioContent, type Block, embedOf } from '../core/index.ts';
import { isEditing, marker } from './editing.ts';
import Player from './Player.svelte';

let { block }: { block: Block } = $props();
const c = $derived(block.content as unknown as AudioContent);
const editing = isEditing();
const mark = marker();
const embed = $derived(c.audio ? embedOf(c.audio.src) : null);
</script>

{#if c.audio}
  <figure class="figure">
    {#if c.title || editing}<h3 data-edit={mark('title')}>{c.title}</h3>{/if}
    {#if embed}
      <Player {embed} title={c.title} />
    {:else}
      <audio class="audio" src={c.audio.src} title={c.title || undefined} controls preload="metadata"></audio>
    {/if}
    {#if c.caption || editing}<figcaption data-edit={mark('caption')}>{c.caption}</figcaption>{/if}
  </figure>
{:else if editing}
  <div class="cms-empty" data-empty="audio"></div>
{/if}
