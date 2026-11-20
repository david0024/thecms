<script lang="ts">
/**
 * One part of the entry a content type's page is drawn for (ADR 0015): its
 * title, its date, a field, or its own blocks. Outside such a page (on an
 * ordinary page, or inside the entry's own blocks) it draws nothing.
 */
import type { Block, EntryContent, ImageValue, LinkValue } from '../core/index.ts';
import { isLink } from '../core/index.ts';
import BlockView from './BlockView.svelte';
import { getEntry, picture, setEditing, setEntry } from './editing.ts';
import EntryFields from './EntryFields.svelte';
import PostMeta from './PostMeta.svelte';
import { dateText } from './words.ts';

let { block }: { block: Block } = $props();
const c = $derived(block.content as unknown as EntryContent);
const entry = getEntry();
const pic = picture();
const shown = entry && !entry.inBody ? entry : undefined;
// What lies inside belongs to the entry: a part met there draws nothing.
if (entry) setEntry({ ...entry, inBody: true });
// The entry's own blocks are typed into only when the entry is what is being edited.
if (entry?.editing) setEditing(entry.editing === 'entry');
const field = $derived(shown && c.part.startsWith('field:') ? shown.type.fields.find((f) => f.key === c.part.slice(6)) : undefined);
const value = $derived(field && shown ? shown.post.fields[field.key] : undefined);
</script>

{#if shown}
  {@const { post, type, language } = shown}
  {#if c.part === 'header'}
    <div class="post-head">
      <PostMeta {type} {post} {language} />
      <h1>{post.title}</h1>
      {#if post.cover}{@const pa = pic(post.cover.src, 'full')}<img class="post-cover" src={post.cover.src} srcset={pa.srcset} sizes={pa.sizes} width={pa.width} height={pa.height} alt={post.cover.alt} />{/if}
      <EntryFields {type} {post} {language} />
    </div>
  {:else if c.part === 'title'}
    <h1>{post.title}</h1>
  {:else if c.part === 'meta'}
    <PostMeta {type} {post} {language} />
  {:else if c.part === 'cover'}
    {#if post.cover}{@const pa = pic(post.cover.src, 'full')}<img class="post-cover" src={post.cover.src} srcset={pa.srcset} sizes={pa.sizes} width={pa.width} height={pa.height} alt={post.cover.alt} />{/if}
  {:else if c.part === 'fields'}
    <EntryFields {type} {post} {language} />
  {:else if c.part === 'body'}
    <div class="entry-body" data-live={shown.editing === 'entry' ? '' : undefined} data-frozen={shown.editing === 'template' ? '' : undefined}>
      {#each post.blocks as inner (inner.id)}<BlockView block={inner} />{/each}
      {#if shown.editing === 'entry' && post.blocks.length === 0}<div class="cms-empty" data-empty="page"></div>{/if}
    </div>
  {:else if field}
    {#if field.kind === 'link'}
      {#if isLink(value as LinkValue | null)}<p><a href={(value as LinkValue).href}>{(value as LinkValue).label}</a></p>{/if}
    {:else if field.kind === 'image'}
      {#if (value as ImageValue | null)?.src}{@const pa = pic((value as ImageValue).src, 'card')}<img src={(value as ImageValue).src} srcset={pa.srcset} sizes={pa.sizes} width={pa.width} height={pa.height} alt={(value as ImageValue).alt} loading="lazy" decoding="async" />{/if}
    {:else if field.kind === 'date'}
      {#if value}<p><time datetime={value as string}>{dateText(value as string, language)}</time></p>{/if}
    {:else if value}
      <p class={field.kind === 'longtext' ? 'lines' : undefined}>{value}</p>
    {/if}
  {/if}
{/if}
