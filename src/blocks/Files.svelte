<script lang="ts">
/** Documents to read or download (ADR 0047), each with its kind in letters: a PDF opens, the others are saved. */
import type { Block, FilesContent } from '../core/index.ts';
import { isEditing, marker } from './editing.ts';

let { block }: { block: Block } = $props();
const c = $derived(block.content as unknown as FilesContent);
const editing = isEditing();
const mark = marker();
/** The file's kind as its address ends: PDF, DOCX. Nothing for an address that does not say. */
const kind = (src: string): string => /\.([a-z0-9]{2,4})$/i.exec(src.split(/[?#]/)[0] ?? '')?.[1]?.toUpperCase() ?? '';
</script>

{#if c.title || editing}<h2 data-edit={mark('title')}>{c.title}</h2>{/if}
{#if c.intro || editing}<p class="lead" data-edit={mark('intro')} data-multiline={mark('1')}>{c.intro}</p>{/if}
{#if c.items.some((item) => item.file)}
  <ul class="files">
    {#each c.items as item, i}
      {#if item.file}
        <li>
          <a href={item.file.src}><span data-edit={mark(`items.${i}.file.label`)}>{item.file.label || kind(item.file.src) || item.file.src}</span>{#if kind(item.file.src)}<small class="file-kind">{kind(item.file.src)}</small>{/if}</a>
          {#if item.text || editing}<p data-edit={mark(`items.${i}.text`)} data-multiline={mark('1')}>{item.text}</p>{/if}
        </li>
      {/if}
    {/each}
  </ul>
{:else if editing}
  <div class="cms-empty" data-empty="files"></div>
{/if}
