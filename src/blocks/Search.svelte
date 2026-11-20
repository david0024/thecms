<script lang="ts">
/**
 * A search field (ADR 0042). It is plain HTML: it asks the site's runtime at
 * `/_/search`, which answers with a page of what matches. A site with no
 * runtime has nothing to ask, so the site draws nothing and the editor says
 * what is missing.
 */
import type { Block } from '../core/index.ts';
import { getSite, isEditing, marker } from './editing.ts';
import { wordsFor } from './words.ts';

let { block }: { block: Block } = $props();
const c = $derived(block.content as { title?: string; placeholder?: string; button?: string });
const editing = isEditing();
const mark = marker();
const where = getSite();
const action = where?.site.forms === '/_' ? '/_/search' : '';
const words = wordsFor(where?.site.language ?? 'en');
</script>

{#if action || editing}
  {#if c.title || editing}<h2 data-edit={mark('title')}>{c.title}</h2>{/if}
  {#if editing && !action}<div class="cms-empty" data-empty="search"></div>{/if}
  <form class="search-form" role="search" method="get" action={editing ? undefined : action}>
    <label class="search-label" for={`s-${block.id}`}>{words.search}</label>
    <input id={`s-${block.id}`} name="q" type="search" maxlength="200" placeholder={c.placeholder} required disabled={editing} />
    <button class="button" type={editing ? 'button' : 'submit'}><span data-edit={mark('button')}>{c.button}</span></button>
  </form>
{/if}
