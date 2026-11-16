<script lang="ts">
/** A whole page: the site's header, the page's blocks, the footer. */
import type { Page, Site } from '../core/index.ts';
import { pagePath } from '../core/index.ts';
import BlockView from './BlockView.svelte';

let { site, page, menu }: { site: Site; page: Page; menu: { title: string; slug: string }[] } = $props();
</script>

<header class="site-header">
  <a class="site-name" href="/">{site.name}</a>
  {#if menu.length > 1}
    <nav aria-label="Main">
      {#each menu as item}
        <a href={pagePath(item.slug)} aria-current={item.slug === page.slug ? 'page' : undefined}>{item.title}</a>
      {/each}
    </nav>
  {/if}
</header>
<main>
  {#each page.blocks as block (block.id)}<BlockView {block} />{/each}
</main>
<footer class="site-footer">
  <p>{site.footer || site.name}</p>
</footer>
