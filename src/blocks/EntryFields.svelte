<script lang="ts">
/** What an entry holds for its type's own fields (ADR 0010, ADR 0052), as a short list of name and value. Empty ones are not drawn. */
import { type ContentType, fieldShown, type Post } from '../core/index.ts';
import { getLists } from './editing.ts';
import FieldValue from './FieldValue.svelte';

let { type, post, language }: { type: ContentType; post: Post; language: string } = $props();
const { lists } = getLists();
const shown = $derived(type.fields.filter((field) => fieldShown(field, post, lists)));
</script>

{#if shown.length}
  <dl class="entry-fields">
    {#each shown as field (field.key)}
      <div class="entry-field" data-field={field.key}>
        <dt>{field.label}</dt>
        <dd><FieldValue {field} {post} {language} /></dd>
      </div>
    {/each}
  </dl>
{/if}
