<script lang="ts">
/** Draws a rich text document. Every string is escaped by Svelte; no HTML is trusted. */
import type { RichText } from '../core/index.ts';
import { marker } from './editing.ts';
import Spans from './Spans.svelte';

let { doc, path = '' }: { doc: RichText; path?: string } = $props();
const mark = marker();
</script>

<div class="prose" data-edit-rich={path ? mark(path) : undefined}>
  {#each doc as node}
    {#if node.type === 'paragraph'}
      <p><Spans spans={node.children} /></p>
    {:else if node.type === 'heading'}
      <svelte:element this={`h${node.level}`}><Spans spans={node.children} /></svelte:element>
    {:else if node.type === 'quote'}
      <blockquote><Spans spans={node.children} /></blockquote>
    {:else if node.type === 'list'}
      <svelte:element this={node.ordered ? 'ol' : 'ul'}>
        {#each node.items as item}<li><Spans spans={item} /></li>{/each}
      </svelte:element>
    {/if}
  {/each}
</div>
