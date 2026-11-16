<script lang="ts">
/** One block: the wrapper every type shares, then the type's own component. */
import type { Block } from '../core/index.ts';
import { COMPONENTS } from './components.ts';

let { block }: { block: Block } = $props();
const Component = $derived(COMPONENTS[block.type]);
</script>

<section class={['b', `b-${block.type}`, block.variant && `v-${block.variant}`]} data-b={block.id}>
  <div class="b-in"><Component {block} /></div>
</section>
