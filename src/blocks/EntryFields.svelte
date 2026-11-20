<script lang="ts">
/** What an entry holds for its type's own fields (ADR 0010), as a short list of name and value. Empty ones are not drawn. */
import { type ContentType, type ImageValue, isLink, type LinkValue, type Post } from '../core/index.ts';
import { picture } from './editing.ts';
import { dateText } from './words.ts';

let { type, post, language }: { type: ContentType; post: Post; language: string } = $props();
const pic = picture();

const shown = $derived(
  type.fields.filter((field) => {
    const value = post.fields[field.key];
    return field.kind === 'link' ? isLink(value as LinkValue | null) : field.kind === 'image' ? !!(value as ImageValue | null)?.src : !!value;
  }),
);
</script>

{#if shown.length}
  <dl class="entry-fields">
    {#each shown as field (field.key)}
      {@const value = post.fields[field.key]}
      <div class="entry-field" data-field={field.key}>
        <dt>{field.label}</dt>
        <dd>
          {#if field.kind === 'link'}
            <a href={(value as LinkValue).href}>{(value as LinkValue).label}</a>
          {:else if field.kind === 'image'}{@const pa = pic((value as ImageValue).src, 'card')}
            <img src={(value as ImageValue).src} srcset={pa.srcset} sizes={pa.sizes} width={pa.width} height={pa.height} alt={(value as ImageValue).alt} loading="lazy" decoding="async" />
          {:else if field.kind === 'date'}
            <time datetime={value as string}>{dateText(value as string, language)}</time>
          {:else if field.kind === 'longtext'}
            <span class="lines">{value}</span>
          {:else}
            {value}
          {/if}
        </dd>
      </div>
    {/each}
  </dl>
{/if}
