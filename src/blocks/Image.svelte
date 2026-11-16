<script lang="ts">
import type { Block, ImageContent } from '../core/index.ts';
import { isEditing, marker } from './editing.ts';

let { block }: { block: Block } = $props();
const c = $derived(block.content as unknown as ImageContent);
const editing = isEditing();
const mark = marker();
</script>

{#if c.image}
  <figure class="figure">
    <img src={c.image.src} alt={c.image.alt} loading="lazy" decoding="async" />
    {#if c.caption || editing}<figcaption data-edit={mark('caption')}>{c.caption}</figcaption>{/if}
  </figure>
{:else if editing}
  <div class="cms-empty" data-empty="image"></div>
{/if}
