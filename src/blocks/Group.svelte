<script lang="ts">
import type { Block } from '../core/index.ts';
import BlockView from './BlockView.svelte';
import { isEditing } from './editing.ts';

let { block }: { block: Block } = $props();
const editing = isEditing();
</script>

<div class="group">
  {#each block.children ?? [] as child (child.id)}<BlockView block={child} />{/each}
  {#if editing && !block.children?.length}<div class="cms-empty" data-empty="group"></div>{/if}
</div>
