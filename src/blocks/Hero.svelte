<script lang="ts">
import { type Block, type HeroContent, isLink } from '../core/index.ts';
import { isEditing, marker } from './editing.ts';

let { block }: { block: Block } = $props();
const c = $derived(block.content as unknown as HeroContent);
const editing = isEditing();
const mark = marker();
// In the editor a button shows as soon as it has words, so it can be seen while its address is still missing.
const shown = (link: HeroContent['action']): link is NonNullable<HeroContent['action']> => (editing ? !!link?.label : isLink(link));
</script>

<div class="hero" class:has-image={c.image}>
  <div class="hero-text">
    {#if c.eyebrow || editing}<p class="eyebrow" data-edit={mark('eyebrow')}>{c.eyebrow}</p>{/if}
    <h1 data-edit={mark('title')}>{c.title}</h1>
    {#if c.subtitle || editing}<p class="lead" data-edit={mark('subtitle')} data-multiline={mark('1')}>{c.subtitle}</p>{/if}
    {#if shown(c.action) || shown(c.secondaryAction)}
      <p class="actions">
        {#if shown(c.action)}<a class="button" href={c.action.href || undefined}><span data-edit={mark('action.label')}>{c.action.label}</span></a>{/if}
        {#if shown(c.secondaryAction)}<a class="button quiet" href={c.secondaryAction.href || undefined}><span data-edit={mark('secondaryAction.label')}>{c.secondaryAction.label}</span></a>{/if}
      </p>
    {/if}
  </div>
  {#if c.image}<img class="hero-image" src={c.image.src} alt={c.image.alt} />{/if}
</div>
