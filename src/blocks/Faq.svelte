<script lang="ts">
/**
 * Questions and their answers. On the site each answer opens under its
 * question without any script; in the editor all are open, so each can be typed into.
 */
import type { Block, FaqContent } from '../core/index.ts';
import { isEditing, marker } from './editing.ts';

let { block }: { block: Block } = $props();
const c = $derived(block.content as unknown as FaqContent);
const editing = isEditing();
const mark = marker();
</script>

{#if c.title || editing}<h2 data-edit={mark('title')}>{c.title}</h2>{/if}
{#if c.intro || editing}<p class="lead" data-edit={mark('intro')} data-multiline={mark('1')}>{c.intro}</p>{/if}
<div class="faq">
  {#each c.items as item, i}
    {#if editing}
      <div class="faq-item">
        <h3 class="faq-question" data-edit={mark(`items.${i}.question`)}>{item.question}</h3>
        <p class="lines" data-edit={mark(`items.${i}.answer`)} data-multiline={mark('1')}>{item.answer}</p>
      </div>
    {:else if item.question}
      <details class="faq-item">
        <summary class="faq-question">{item.question}</summary>
        {#if item.answer}<p class="lines">{item.answer}</p>{/if}
      </details>
    {/if}
  {/each}
</div>
