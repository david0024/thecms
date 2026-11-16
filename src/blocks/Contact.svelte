<script lang="ts">
import type { Block, ContactContent } from '../core/index.ts';

let { block }: { block: Block } = $props();
const c = $derived(block.content as unknown as ContactContent);
// Only what a phone can dial: digits and a leading plus.
const dial = $derived(c.phone.replace(/[^\d+]/g, ''));
</script>

{#if c.title}<h2>{c.title}</h2>{/if}
{#if c.text}<p class="lead">{c.text}</p>{/if}
<address class="contact">
  {#if c.email}<p><a href={`mailto:${c.email}`}>{c.email}</a></p>{/if}
  {#if c.phone}<p>{#if dial}<a href={`tel:${dial}`}>{c.phone}</a>{:else}{c.phone}{/if}</p>{/if}
  {#if c.address}<p class="lines">{c.address}</p>{/if}
</address>
