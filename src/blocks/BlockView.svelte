<script lang="ts">
/** One block: the wrapper every type shares, then the type's own component. */
import type { Block } from '../core/index.ts';
import { COMPONENTS } from './components.ts';
import { marker } from './editing.ts';

let { block }: { block: Block } = $props();
const Component = $derived(COMPONENTS[block.type]);
const mark = marker();
</script>

<section class={['b', `b-${block.type}`, block.variant && `v-${block.variant}`]} data-b={block.id} data-type={mark(block.type)}>
  <div class="b-in"><Component {block} /></div>
</section>
