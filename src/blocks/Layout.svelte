<script lang="ts">
/**
 * A whole page: the site's header, the page's blocks, the footer.
 *
 * What the header and footer say belongs to the site (its name or logo, one
 * button, the footer's words and links). How they are laid out belongs to the
 * theme, and reaches them only through the stylesheet (ADR 0006): this markup
 * is the same under every theme.
 */
import type { Page, Site } from '../core/index.ts';
import { isLink, pagePath } from '../core/index.ts';
import BlockView from './BlockView.svelte';
import { marker, setEditing } from './editing.ts';

let {
  site,
  page,
  menu,
  editing = false,
}: { site: Site; page: Page; menu: { title: string; slug: string }[]; editing?: boolean } = $props();
// svelte-ignore state_referenced_locally
setEditing(editing);
const mark = marker();
const footerLinks = $derived(site.footerLinks.filter(isLink));
</script>

<header class="site-header" data-site={mark('header')}>
  <div class="site-in">
    <a class="site-name" href="/">
      {#if site.logo}<img class="site-logo" src={site.logo.src} alt={site.logo.alt || site.name} />{:else}{site.name}{/if}
    </a>
    {#if menu.length > 1 || isLink(site.action)}
      <div class="site-nav">
        {#if menu.length > 1}
          <nav aria-label="Main">
            {#each menu as item}
              <a href={pagePath(item.slug)} aria-current={item.slug === page.slug ? 'page' : undefined}>{item.title}</a>
            {/each}
          </nav>
        {/if}
        {#if isLink(site.action)}<a class="button" href={site.action.href}>{site.action.label}</a>{/if}
      </div>
    {/if}
  </div>
</header>
<main>
  {#each page.blocks as block (block.id)}<BlockView {block} />{/each}
  {#if editing && page.blocks.length === 0}<div class="cms-empty" data-empty="page"></div>{/if}
</main>
<footer class="site-footer" data-site={mark('footer')}>
  <div class="site-in">
    <p>{site.footer || site.name}</p>
    {#if footerLinks.length}
      <nav aria-label="Footer">
        {#each footerLinks as link}<a href={link.href}>{link.label}</a>{/each}
      </nav>
    {/if}
  </div>
</footer>
