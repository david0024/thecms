<script lang="ts">
/** Where this page is, from home (ADR 0050 d4): each step a link, the last one this page. */
import type { Crumb } from '../core/index.ts';
import { wordsFor } from './words.ts';

let { crumbs, language }: { crumbs: Crumb[]; language: string } = $props();
</script>

{#if crumbs.length}
  <nav class="b crumbs" aria-label={wordsFor(language).breadcrumbs}>
    <ol class="b-in">
      {#each crumbs as crumb, i (crumb.href)}
        <li>{#if i < crumbs.length - 1}<a href={crumb.href}>{crumb.name}</a>{:else}<span aria-current="page">{crumb.name}</span>{/if}</li>
      {/each}
    </ol>
  </nav>
{/if}
