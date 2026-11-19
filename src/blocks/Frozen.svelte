<script lang="ts">
/**
 * Blocks drawn in the editor that are not the ones being edited (ADR 0015):
 * the page of a content type around the entry being typed into. Nothing in
 * here is marked for typing, and the canvas does not select it.
 */
import type { Snippet } from 'svelte';
import { isEditing, setEditing } from './editing.ts';

let { children }: { children: Snippet } = $props();
const editing = isEditing();
setEditing(false);
</script>

{#if editing}<div data-frozen>{@render children()}</div>{:else}{@render children()}{/if}
