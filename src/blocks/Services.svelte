<script lang="ts">
import type { Block, ServicesContent } from '../core/index.ts';
import { isEditing, marker } from './editing.ts';

let { block }: { block: Block } = $props();
const c = $derived(block.content as unknown as ServicesContent);
const editing = isEditing();
const mark = marker();
</script>

{#if c.title || editing}<h2 data-edit={mark('title')}>{c.title}</h2>{/if}
{#if c.intro || editing}<p class="lead" data-edit={mark('intro')} data-multiline={mark('1')}>{c.intro}</p>{/if}
<ul class="cards">
  {#each c.items as item, i}
    <li class="card">
      <h3 data-edit={mark(`items.${i}.title`)}>{item.title}</h3>
      {#if item.text || editing}<p data-edit={mark(`items.${i}.text`)} data-multiline={mark('1')}>{item.text}</p>{/if}
    </li>
  {/each}
</ul>
