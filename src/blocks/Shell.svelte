<script lang="ts">
/**
 * What every page of a site shares: the header, the footer, and between them
 * whatever this page is.
 *
 * What the header and footer say belongs to the site (its name or logo, one
 * button, the footer's words and links). How they are laid out belongs to the
 * theme, and reaches them only through the stylesheet (ADR 0006): this markup
 * is the same under every theme.
 *
 * The menu works without script (ADR 0008). An item that holds others is a
 * <details>: a click, a tap or the keyboard opens it. On a narrow screen the
 * whole menu folds behind a checkbox and its label.
 */
import type { Snippet } from 'svelte';
import type { MenuLink, Site } from '../core/index.ts';
import { holdsCurrent, isLink, isMega } from '../core/index.ts';
import { marker, setEditing } from './editing.ts';
import { wordsFor } from './words.ts';

let {
  site,
  menu,
  current,
  editing = false,
  children,
}: { site: Site; menu: MenuLink[]; /** The address of this page, to mark it in the menu. */ current: string; editing?: boolean; children: Snippet } = $props();
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
      <input class="menu-check" type="checkbox" id="site-menu" aria-label={words.menu} />
      <label class="menu-button" for="site-menu">{words.menu}</label>
      <div class="site-nav">
        {#if menu.length > 1}
          <nav aria-label={words.mainMenu}>
            <ul class="menu">
              {#each menu as item}
                {#if item.children.length === 0}
                  <li>{@render link(item)}</li>
                {:else}
                  <li class={isMega(item) ? 'mega' : undefined}>
                    <details name="site-menu">
                      <summary class={holdsCurrent(item, current) ? 'current' : undefined}>{item.title}</summary>
                      <div class="sub">
                        {#if isMega(item)}
                          {#if item.href}<p class="sub-own">{@render link(item)}</p>{/if}
                          <div class="cols">
                            {#each item.children as column}
                              <div class="col">
                                <p class="col-title">{#if column.href}{@render link(column)}{:else}{column.title}{/if}</p>
                                {#if column.children.length}{@render list(column.children)}{/if}
                              </div>
                            {/each}
                          </div>
                        {:else}
                          {@render list(item.href ? [{ ...item, children: [] }, ...item.children] : item.children)}
                        {/if}
                      </div>
                    </details>
                  </li>
                {/if}
              {/each}
            </ul>
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

{#snippet link(item: MenuLink)}<a href={item.href} aria-current={item.href === current ? 'page' : undefined}>{item.title}</a>{/snippet}

{#snippet list(items: MenuLink[])}
  <ul>
    {#each items as item}{#if item.href}<li>{@render link(item)}</li>{/if}{/each}
  </ul>
{/snippet}
