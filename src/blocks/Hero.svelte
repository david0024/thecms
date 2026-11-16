<script lang="ts">
import type { Block, HeroContent } from '../core/index.ts';

let { block }: { block: Block } = $props();
const c = $derived(block.content as unknown as HeroContent);
</script>

<div class="hero" class:has-image={c.image}>
  <div class="hero-text">
    {#if c.eyebrow}<p class="eyebrow">{c.eyebrow}</p>{/if}
    <h1>{c.title}</h1>
    {#if c.subtitle}<p class="lead">{c.subtitle}</p>{/if}
    {#if c.action || c.secondaryAction}
      <p class="actions">
        {#if c.action}<a class="button" href={c.action.href}>{c.action.label}</a>{/if}
        {#if c.secondaryAction}<a class="button quiet" href={c.secondaryAction.href}>{c.secondaryAction.label}</a>{/if}
      </p>
    {/if}
  </div>
  {#if c.image}<img class="hero-image" src={c.image.src} alt={c.image.alt} />{/if}
</div>
