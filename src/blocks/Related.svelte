<script lang="ts">
/**
 * The entries that link to this one (ADR 0052 d3): under a client, the
 * projects that name it. Drawn by itself after an entry, or where its type's
 * page puts the part `related`.
 */
import { backlinks, type ContentType, entryPath, type Post, postExcerpt } from '../core/index.ts';
import { getLists, picture } from './editing.ts';
import { dateText } from './words.ts';

let { type, post, language, wrapped = true }: { type: ContentType; post: Post; language: string; /** Drawn as a block of its own, not inside one. */ wrapped?: boolean } = $props();
const { lists } = getLists();
const pic = picture();
const groups = $derived(backlinks(type, post, lists));
</script>

{#snippet list(group: (typeof groups)[number])}
  <h2>{group.named ? `${group.type.name} · ${group.field.label}` : group.type.name}</h2>
  <ul class="cards entries">
    {#each group.entries as entry (entry.slug)}
      <li class="card entry-card">
        {#if entry.cover}{@const pa = pic(entry.cover.src, 'card')}<a href={entryPath(group.type, entry.slug)} tabindex="-1" aria-hidden="true"><img src={entry.cover.src} srcset={pa.srcset} sizes={pa.sizes} width={pa.width} height={pa.height} alt="" loading="lazy" decoding="async" /></a>{/if}
        {#if group.type.dated}<p class="post-meta"><time datetime={entry.date}>{dateText(entry.date, language)}</time></p>{/if}
        <h3><a href={entryPath(group.type, entry.slug)}>{entry.title}</a></h3>
        <p>{postExcerpt(entry)}</p>
      </li>
    {/each}
  </ul>
{/snippet}

{#each groups as group (`${group.type.id}/${group.field.key}`)}
  {#if wrapped}
    <section class="b entry-related" data-related={`${group.type.id}/${group.field.key}`}><div class="b-in">{@render list(group)}</div></section>
  {:else}
    <div class="entry-related" data-related={`${group.type.id}/${group.field.key}`}>{@render list(group)}</div>
  {/if}
{/each}
