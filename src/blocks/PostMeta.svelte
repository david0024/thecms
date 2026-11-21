<script lang="ts">
/** What sits above an entry's title: its date and who wrote it (ADR 0055 d3), whose name leads to all they wrote in this type (ADR 0056 d1), its categories and its tags, each a link to the entries that share it. */
import type { ContentType, Post } from '../core/index.ts';
import { typeAuthorPath, typeCategoryPath, typeTagPath } from '../core/index.ts';
import { dateText, wordsFor } from './words.ts';

let { type, post, language }: { type: ContentType; post: Post; language: string } = $props();
</script>

{#if type.dated || post.categories.length || post.tags.length}
  <p class="post-meta">
    {#if type.dated}<time datetime={post.date}>{dateText(post.date, language)}</time>{/if}
    {#if type.dated && post.author}
      {@const [before, after] = wordsFor(language).by.split('{name}')}
      <span class="post-author">{before}{#if post.author.slug}<a href={typeAuthorPath(type, post.author.slug)} rel="author">{post.author.name}</a>{:else}{post.author.name}{/if}{after ?? ''}</span>
    {/if}
    {#each post.categories as name}<a href={typeCategoryPath(type, name)}>{name}</a>{/each}
    {#each post.tags as name}<a class="post-tag" href={typeTagPath(type, name)}>#{name}</a>{/each}
  </p>
{/if}
