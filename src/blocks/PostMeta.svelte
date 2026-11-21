<script lang="ts">
/** What sits above an entry's title: its date and who wrote it (ADR 0055 d3), its categories and its tags, each a link to the entries that share it. */
import type { ContentType, Post } from '../core/index.ts';
import { typeCategoryPath, typeTagPath } from '../core/index.ts';
import { dateText, wordsFor } from './words.ts';

let { type, post, language }: { type: ContentType; post: Post; language: string } = $props();
</script>

{#if type.dated || post.categories.length || post.tags.length}
  <p class="post-meta">
    {#if type.dated}<time datetime={post.date}>{dateText(post.date, language)}</time>{/if}
    {#if type.dated && post.author}<span class="post-author">{wordsFor(language).by.replace('{name}', post.author.name)}</span>{/if}
    {#each post.categories as name}<a href={typeCategoryPath(type, name)}>{name}</a>{/each}
    {#each post.tags as name}<a class="post-tag" href={typeTagPath(type, name)}>#{name}</a>{/each}
  </p>
{/if}
