<script lang="ts">
import type { Block, ServicesContent } from '../core/index.ts';

let { block }: { block: Block } = $props();
const c = $derived(block.content as unknown as ServicesContent);
</script>

{#if c.title}<h2>{c.title}</h2>{/if}
{#if c.intro}<p class="lead">{c.intro}</p>{/if}
<ul class="cards">
  {#each c.items as item}
    <li class="card">
      <h3>{item.title}</h3>
      {#if item.text}<p>{item.text}</p>{/if}
    </li>
  {/each}
</ul>
