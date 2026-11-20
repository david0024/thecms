<script lang="ts">
/** What clients said, in their words, with who said it. */
import type { Block, TestimonialsContent } from '../core/index.ts';
import { isEditing, marker, picture } from './editing.ts';

let { block }: { block: Block } = $props();
const c = $derived(block.content as unknown as TestimonialsContent);
const editing = isEditing();
const mark = marker();
const pic = picture();
</script>

{#if c.title || editing}<h2 data-edit={mark('title')}>{c.title}</h2>{/if}
<ul class="cards quotes">
  {#each c.items as item, i}
    {#if item.quote || editing}
      <li class="card">
        <figure class="quote">
          <blockquote><p class="lines" data-edit={mark(`items.${i}.quote`)} data-multiline={mark('1')}>{item.quote}</p></blockquote>
          {#if item.name || item.role || item.photo || editing}
            <figcaption>
              {#if item.photo}{@const pa = pic(item.photo.src, 'thumb')}<img src={item.photo.src} srcset={pa.srcset} sizes={pa.sizes} width={pa.width} height={pa.height} alt={item.photo.alt} loading="lazy" decoding="async" />{/if}
              <span>
                {#if item.name || editing}<strong data-edit={mark(`items.${i}.name`)}>{item.name}</strong>{/if}
                {#if item.role || editing}<span class="quote-role" data-edit={mark(`items.${i}.role`)}>{item.role}</span>{/if}
              </span>
            </figcaption>
          {/if}
        </figure>
      </li>
    {/if}
  {/each}
</ul>
