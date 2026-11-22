<script lang="ts">
import type { Span } from '../core/index.ts';

let { spans }: { spans: Span[] } = $props();
</script>

{#each spans as span}{#if span.href}<a href={span.href} rel={span.nofollow ? 'nofollow' : undefined}>{@render marked(span, 0)}</a>{:else}{@render marked(span, 0)}{/if}{/each}

{#snippet marked(span: Span, i: number)}{@const mark = span.marks?.[i]}{#if mark === 'bold'}<strong>{@render marked(span, i + 1)}</strong>{:else if mark === 'italic'}<em>{@render marked(span, i + 1)}</em>{:else if mark === 'code'}<code>{@render marked(span, i + 1)}</code>{:else}{span.text}{/if}{/snippet}
