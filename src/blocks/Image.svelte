<script lang="ts">
import type { Block, ImageContent } from '../core/index.ts';

let { block }: { block: Block } = $props();
const c = $derived(block.content as unknown as ImageContent);
</script>

{#if c.image}
  <figure class="figure">
    <img src={c.image.src} alt={c.image.alt} loading="lazy" decoding="async" />
    {#if c.caption}<figcaption>{c.caption}</figcaption>{/if}
  </figure>
{/if}
