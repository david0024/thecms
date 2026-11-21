<script lang="ts">
/**
 * A search field (ADR 0042). It is plain HTML: it asks the site's own server
 * at `/_/search`, which answers with a page of what matches (ADR 0044).
 */
import type { Block } from '../core/index.ts';
import { getSite, isEditing, marker } from './editing.ts';
import { wordsFor } from './words.ts';

let { block }: { block: Block } = $props();
const c = $derived(block.content as { title?: string; placeholder?: string; button?: string });
const editing = isEditing();
const mark = marker();
const where = getSite();
const words = wordsFor(where?.site.language ?? 'en');
</script>

{#if c.title || editing}<h2 data-edit={mark('title')}>{c.title}</h2>{/if}
<form class="search-form" role="search" method="get" action={editing ? undefined : '/_/search'}>
  <label class="search-label" for={`s-${block.id}`}>{words.search}</label>
  {#if !editing && where?.site.languages.includes(where.site.language)}<input type="hidden" name="l" value={where.site.language} />{/if}
  <input id={`s-${block.id}`} name="q" type="search" maxlength="200" placeholder={c.placeholder} required disabled={editing} />
  <button class="button" type={editing ? 'button' : 'submit'}><span data-edit={mark('button')}>{c.button}</span></button>
</form>
