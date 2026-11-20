<script lang="ts">
/** One block: the wrapper every type shares, then the type's own component. */
import { type Block, measureFor } from '../core/index.ts';
import { COMPONENTS } from './components.ts';
import { getMeasure, getSite, marker, setMeasure } from './editing.ts';

let { block }: { block: Block } = $props();
// The width this block runs at, for the pictures inside it (ADR 0005 d8).
const outer = getMeasure();
// svelte-ignore state_referenced_locally
setMeasure(outer.layout, measureFor(getSite()?.site.pictures?.widths ?? {}, outer.layout, block.type, block.style?.maxWidth));
const Component = $derived(COMPONENTS[block.type]);
const mark = marker();
</script>

<section class={['b', `b-${block.type}`, block.variant && `v-${block.variant}`]} data-b={block.id} data-type={mark(block.type)}>
  <div class="b-in"><Component {block} /></div>
</section>
