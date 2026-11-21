<script lang="ts">
/**
 * One value of an entry's own field (ADR 0010, ADR 0052 d5), drawn as its
 * kind: a link, a picture, a date, a number, yes or no, a file, the entries
 * it links to. Whoever draws it has already asked `fieldShown`.
 */
import type { ContentType, FileValue, ImageValue, LinkValue, Post, TypeField } from '../core/index.ts';
import { entryPath, linkedEntries } from '../core/index.ts';
import { getLists, picture } from './editing.ts';
import { dateText, wordsFor } from './words.ts';

let { field, post, language }: { field: TypeField; post: Post; language: string } = $props();
const pic = picture();
const { lists } = getLists();
const value = $derived(post.fields[field.key]);
const linked = $derived(field.kind === 'entries' ? linkedEntries(post, field, lists) : []);
const target = $derived<ContentType | undefined>(lists[field.to ?? '']?.type);
const number = (n: number): string => {
  try {
    return new Intl.NumberFormat(language).format(n);
  } catch {
    return String(n);
  }
};
</script>

{#if field.kind === 'link'}
  <a href={(value as LinkValue).href}>{(value as LinkValue).label}</a>
{:else if field.kind === 'image'}{@const pa = pic((value as ImageValue).src, 'card')}
  <img src={(value as ImageValue).src} srcset={pa.srcset} sizes={pa.sizes} width={pa.width} height={pa.height} alt={(value as ImageValue).alt} loading="lazy" decoding="async" />
{:else if field.kind === 'file'}
  <a href={(value as FileValue).src} class="entry-file">{(value as FileValue).label || (value as FileValue).src.split('/').pop()}</a>
{:else if field.kind === 'date'}
  <time datetime={value as string}>{dateText(value as string, language)}</time>
{:else if field.kind === 'number'}
  {number(value as number)}
{:else if field.kind === 'yesno'}
  {value ? wordsFor(language).yes : wordsFor(language).no}
{:else if field.kind === 'entries' && target}
  <ul class="entry-links">
    {#each linked as entry (entry.slug)}
      <li>
        <a href={entryPath(target, entry.slug)}>
          {#if entry.cover}{@const pa = pic(entry.cover.src, 'card')}<img src={entry.cover.src} srcset={pa.srcset} sizes={pa.sizes} width={pa.width} height={pa.height} alt="" loading="lazy" decoding="async" />{/if}
          <span>{entry.title}</span>
        </a>
      </li>
    {/each}
  </ul>
{:else if field.kind === 'longtext'}
  <span class="lines">{value}</span>
{:else}
  {value}
{/if}
