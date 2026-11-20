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
import { getContext, type Snippet } from 'svelte';
import type { Alternate, MenuLink, Site } from '../core/index.ts';
import { areaBlock, holdsCurrent, isLink, isMega, layoutOf, measureFor } from '../core/index.ts';
import BlockView from './BlockView.svelte';
import { type EntryLists, marker, setEditing, setLists, setMeasure, setSite } from './editing.ts';
import { ALTERNATES, wordsFor } from './words.ts';

let {
  site,
  menu,
  current,
  editing = false,
  lists = {},
  layout = '',
  children,
}: {
  site: Site;
  menu: MenuLink[];
  /** What a block that lists entries can list. */
  lists?: EntryLists;
  /** The address of this page, to mark it in the menu. */
  current: string;
  editing?: boolean;
  /** The layout this page is drawn in (ADR 0035): what is around its blocks. */
  layout?: string;
  children: Snippet;
} = $props();
// svelte-ignore state_referenced_locally
setEditing(editing);
// svelte-ignore state_referenced_locally
setLists(lists, site.language);
// svelte-ignore state_referenced_locally
setSite(site, current);
// svelte-ignore state_referenced_locally
setMeasure(layoutOf(site.layouts, layout).width, measureFor(site.pictures?.widths ?? {}, layoutOf(site.layouts, layout).width));
const mark = marker();
const words = $derived(wordsFor(site.language));
const footerLinks = $derived(site.footerLinks.filter(isLink));
/** The same page in the site's other languages; none when it has one. */
const others: Alternate[] = getContext(ALTERNATES) ?? [];
const home = others.find((a) => a.current)?.home ?? '/';
const frame = $derived(layoutOf(site.layouts, layout));
/** A place of the layout, with what its section holds in this language; nothing when it shows none. */
const area = (section: string) => (section ? { ...areaBlock(section), children: site.areas?.[section] ?? [] } : null);
const top = $derived(area(frame.top));
const side = $derived(frame.sidebar === 'none' ? null : area(frame.side));
const bottom = $derived(area(frame.bottom));
</script>

{#if frame.header}
<header class="site-header" data-site={mark('header')}>
  <div class="site-in">
    <a class="site-name" href={home}>
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
    {#if others.length > 1}
      <nav class="site-languages" aria-label={words.languages}>
        {#each others as other}<a href={other.href} hreflang={other.language} lang={other.language} aria-current={other.current ? 'true' : undefined}>{other.name}</a>{/each}
      </nav>
    {/if}
  </div>
</header>
{/if}
<div class="layout layout-{frame.width}" class:layout-side={frame.sidebar !== 'none'} data-layout={frame.id} data-sidebar={frame.sidebar}>
  {#if top}<div class="layout-top" data-area="top"><BlockView block={top} /></div>{/if}
  {#if frame.sidebar === 'none'}
    <main>
      {@render children()}
    </main>
  {:else}
    <div class="layout-body">
      <main>
        {@render children()}
      </main>
      <aside class="layout-aside" data-area="side">{#if side}<BlockView block={side} />{/if}</aside>
    </div>
  {/if}
  {#if bottom}<div class="layout-bottom" data-area="bottom"><BlockView block={bottom} /></div>{/if}
</div>
{#if frame.footer}
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
{/if}

{#snippet link(item: MenuLink)}<a href={item.href} aria-current={item.href === current ? 'page' : undefined}>{item.title}</a>{/snippet}

{#snippet list(items: MenuLink[])}
  <ul>
    {#each items as item}{#if item.href}<li>{@render link(item)}</li>{/if}{/each}
  </ul>
{/snippet}
