<script lang="ts">
import type { Block } from '../core/index.ts';
import BlockView from './BlockView.svelte';

let { block }: { block: Block } = $props();
</script>

<div class="group">
  {#each block.children ?? [] as child (child.id)}<BlockView block={child} />{/each}
</div>
