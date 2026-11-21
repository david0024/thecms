<script lang="ts">
/** A table of plain text (ADR 0047). On a phone it scrolls sideways inside itself, never the page. */
import type { Block, TableContent } from '../core/index.ts';
import { isEditing, marker } from './editing.ts';

let { block }: { block: Block } = $props();
const c = $derived(block.content as unknown as TableContent);
const editing = isEditing();
const mark = marker();
const head = $derived(c.table.header && c.table.rows.length > 1 ? c.table.rows[0] : null);
const body = $derived(head ? c.table.rows.slice(1) : c.table.rows);
const first = $derived(head ? 1 : 0);
</script>

{#if c.title || editing}<h2 data-edit={mark('title')}>{c.title}</h2>{/if}
<div class="table-wrap">
  <table class="table">
    {#if c.caption || editing}<caption data-edit={mark('caption')}>{c.caption}</caption>{/if}
    {#if head}
      <thead><tr>{#each head as cell, j}<th scope="col" data-edit={mark(`table.rows.0.${j}`)}>{cell}</th>{/each}</tr></thead>
    {/if}
    <tbody>
      {#each body as row, i}
        <tr>{#each row as cell, j}<td data-edit={mark(`table.rows.${i + first}.${j}`)}>{cell}</td>{/each}</tr>
      {/each}
    </tbody>
  </table>
</div>
