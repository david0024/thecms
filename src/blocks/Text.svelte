<script lang="ts">
import type { Block, TextContent } from '../core/index.ts';
import RichText from './RichText.svelte';

let { block }: { block: Block } = $props();
const c = $derived(block.content as unknown as TextContent);
</script>

<RichText doc={c.body} />
