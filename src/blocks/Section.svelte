<script lang="ts">
/**
 * A section (ADR 0033): blocks written once and shown on many pages. Its
 * blocks are put in `children` when the page is drawn, in the page's
 * language. In the editor it is one block: what it shows is changed where the
 * section is written, so nothing in it is marked for typing.
 */
import type { Block } from '../core/index.ts';
import BlockView from './BlockView.svelte';
import { isEditing } from './editing.ts';
import Frozen from './Frozen.svelte';

let { block }: { block: Block } = $props();
const editing = isEditing();
</script>

{#if block.children?.length}
  <Frozen>
    <div class="section">
      {#each block.children as child (child.id)}<BlockView block={child} />{/each}
    </div>
  </Frozen>
{:else if editing}
  <div class="cms-empty" data-empty="section"></div>
{/if}
