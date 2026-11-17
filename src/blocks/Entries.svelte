<script lang="ts">
/**
 * A few entries of one content type on any page: the latest posts on the home
 * page, three projects under a service (ADR 0011). The block holds only which
 * type and how many; the entries are looked up when the page is drawn, so the
 * page is never out of date after a new post is published and exported.
 */
import type { Block, EntriesContent } from '../core/index.ts';
import { entryPath, listPath, postExcerpt } from '../core/index.ts';
import { getLists, isEditing, marker } from './editing.ts';
import { dateText, wordsFor } from './words.ts';

let { block }: { block: Block } = $props();
const c = $derived(block.content as unknown as EntriesContent);
const editing = isEditing();
const mark = marker();
const { lists, language } = getLists();
const list = $derived(lists[c.source]);
const shown = $derived(list ? list.entries.slice(0, c.count) : []);
</script>

{#if c.title || editing}<h2 data-edit={mark('title')}>{c.title}</h2>{/if}
{#if list && shown.length}
  <ul class="cards entries">
    {#each shown as entry (entry.slug)}
      <li class="card entry-card">
        {#if entry.cover}<a href={entryPath(list.type, entry.slug)} tabindex="-1" aria-hidden="true"><img src={entry.cover.src} alt="" loading="lazy" decoding="async" /></a>{/if}
        {#if list.type.dated}<p class="post-meta"><time datetime={entry.date}>{dateText(entry.date, language)}</time></p>{/if}
        <h3><a href={entryPath(list.type, entry.slug)}>{entry.title}</a></h3>
        <p>{postExcerpt(entry)}</p>
      </li>
    {/each}
  </ul>
  {#if c.more || editing}<p class="entries-more"><a href={listPath(list.type)} data-edit={mark('more')}>{c.more}</a></p>{/if}
{:else if editing}
  <!-- Only the author is told; a visitor sees a page without the block's list, not an apology. -->
  <p class="lead">{wordsFor(language).noPosts}</p>
{/if}
