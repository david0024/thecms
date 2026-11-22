<script lang="ts">
/**
 * The months of a dated type, newest first, each with how many entries it
 * holds and a link to them; or its years (ADR 0056 d4). Like the entries
 * block, it holds only which type: the months are counted when the page is
 * drawn, in the page's language, from what is published there.
 */
import type { ArchiveContent, Block } from '../core/index.ts';
import { datePath, periodName, periodsOf } from '../core/index.ts';
import { getLists, isEditing, marker } from './editing.ts';
import { wordsFor } from './words.ts';

let { block }: { block: Block } = $props();
const c = $derived(block.content as unknown as ArchiveContent);
const editing = isEditing();
const mark = marker();
const { lists, language } = getLists();
const list = $derived(lists[c.source]);
const periods = $derived(list?.type.dated ? periodsOf(list.entries, c.years ? 4 : 7) : []);
</script>

{#if c.title || editing}<h2 data-edit={mark('title')}>{c.title}</h2>{/if}
{#if list && periods.length}
  <ul class="archive-list">
    {#each periods as { period, posts } (period)}
      <li><a href={datePath(list.type, period)}>{periodName(period, language)}</a> ({posts.length})</li>
    {/each}
  </ul>
{:else if editing}
  <p class="lead">{wordsFor(language).noPosts}</p>
{/if}
