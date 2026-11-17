<script lang="ts">
/**
 * What every page of a site shares: the header, the footer, and between them
 * whatever this page is.
 *
 * What the header and footer say belongs to the site (its name or logo, one
 * button, the footer's words and links). How they are laid out belongs to the
 * theme, and reaches them only through the stylesheet (ADR 0006): this markup
 * is the same under every theme.
 */
import type { Snippet } from 'svelte';
import type { Site } from '../core/index.ts';
import { isLink } from '../core/index.ts';
import { marker, setEditing } from './editing.ts';
import { wordsFor } from './words.ts';

let {
  site,
  menu,
  current,
  editing = false,
  children,
}: { site: Site; menu: { title: string; href: string }[]; /** The address of this page, to mark it in the menu. */ current: string; editing?: boolean; children: Snippet } = $props();
// svelte-ignore state_referenced_locally
setEditing(editing);
const mark = marker();
const words = $derived(wordsFor(site.language));
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
          <nav aria-label={words.mainMenu}>
            {#each menu as item}
              <a href={item.href} aria-current={item.href === current ? 'page' : undefined}>{item.title}</a>
            {/each}
          </nav>
        {/if}
        {#if isLink(site.action)}<a class="button" href={site.action.href}>{site.action.label}</a>{/if}
      </div>
    {/if}
  </div>
</header>
<main>
  {@render children()}
</main>
<footer class="site-footer" data-site={mark('footer')}>
  <div class="site-in">
    <p>{site.footer || site.name}</p>
    {#if footerLinks.length}
      <nav aria-label={words.footerMenu}>
        {#each footerLinks as link}<a href={link.href}>{link.label}</a>{/each}
      </nav>
    {/if}
  </div>
</footer>
