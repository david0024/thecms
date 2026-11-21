<script lang="ts">
/**
 * A player from another service (ADR 0047). Its address is made from the one
 * the author pasted, for a service the site knows; any other draws nothing on
 * the site, and says why in the editor.
 */
import { type Block, type EmbedContent, embedOf } from '../core/index.ts';
import { isEditing, marker } from './editing.ts';
import Player from './Player.svelte';

let { block }: { block: Block } = $props();
const c = $derived(block.content as unknown as EmbedContent);
const editing = isEditing();
const mark = marker();
const embed = $derived(embedOf(c.url));
</script>

{#if embed}
  <figure class="figure">
    <Player {embed} title={c.title} />
    {#if c.caption || editing}<figcaption data-edit={mark('caption')}>{c.caption}</figcaption>{/if}
  </figure>
{:else if editing}
  <div class="cms-empty" data-empty={c.url ? 'embedUnknown' : 'embed'}></div>
{/if}
