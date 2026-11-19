<script lang="ts">
/** Pictures in a grid, each with its own caption. A picture not chosen yet is a place to choose one in the editor, and nothing on the site. */
import type { Block, GalleryContent } from '../core/index.ts';
import { isEditing, marker } from './editing.ts';

let { block }: { block: Block } = $props();
const c = $derived(block.content as unknown as GalleryContent);
const editing = isEditing();
const mark = marker();
</script>

{#if c.title || editing}<h2 data-edit={mark('title')}>{c.title}</h2>{/if}
{#if c.intro || editing}<p class="lead" data-edit={mark('intro')} data-multiline={mark('1')}>{c.intro}</p>{/if}
{#if c.images.some((item) => item.image) || editing}
  <ul class="gallery">
    {#each c.images as item, i}
      {#if item.image}
        <li>
          <figure class="figure">
            <img src={item.image.src} alt={item.image.alt} loading="lazy" decoding="async" />
            {#if item.caption || editing}<figcaption data-edit={mark(`images.${i}.caption`)}>{item.caption}</figcaption>{/if}
          </figure>
        </li>
      {:else if editing}
        <li><div class="cms-empty" data-empty="image"></div></li>
      {/if}
    {/each}
    {#if editing && !c.images.length}<li><div class="cms-empty" data-empty="gallery"></div></li>{/if}
  </ul>
{/if}
