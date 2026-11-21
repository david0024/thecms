<script lang="ts">
/** Buttons in a row (ADR 0047): the first stands out, the others are quieter. One with no address yet shows only in the editor. */
import { type ButtonsContent, isLink } from '../core/index.ts';
import type { Block } from '../core/index.ts';
import { isEditing, marker } from './editing.ts';

let { block }: { block: Block } = $props();
const c = $derived(block.content as unknown as ButtonsContent);
const editing = isEditing();
const mark = marker();
const shown = (link: ButtonsContent['items'][number]['action']): link is NonNullable<typeof link> => (editing ? !!link?.label : isLink(link));
</script>

{#if c.items.some((item) => shown(item.action))}
  <p class="actions">
    {#each c.items as item, i}
      {#if shown(item.action)}<a class={['button', i > 0 && 'quiet']} href={item.action.href || undefined}><span data-edit={mark(`items.${i}.action.label`)}>{item.action.label}</span></a>{/if}
    {/each}
  </p>
{:else if editing}
  <div class="cms-empty" data-empty="buttons"></div>
{/if}
