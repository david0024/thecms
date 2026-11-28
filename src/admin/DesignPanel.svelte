<script lang="ts">
/**
 * Design (ADR 0082): the one place for how the site looks and what it says
 * around every page. Three parts, as the page shows them: the style of the
 * whole site, the header with its menu, and the footer. A click on the header
 * or the footer in the canvas opens its part.
 */
import type { MenuList, Site, Theme } from '../core/index.ts';
import type { PageInfo, SectionInfo } from './api.ts';
import FooterPanel from './FooterPanel.svelte';
import HeaderPanel from './HeaderPanel.svelte';
import { t } from './messages.ts';
import ThemeBuilder from './ThemeBuilder.svelte';
import { DESIGN_PARTS, type DesignPart } from './themeEdit.ts';

let {
  part,
  site,
  theme,
  ready,
  changed,
  pages,
  lists,
  sections = [],
  shop = false,
  handPicked = 0,
  onpart,
  onsite,
  ontheme,
  onchoose,
  onpublish,
}: {
  part: DesignPart;
  site: Site;
  theme: Theme;
  ready: Theme[];
  /** The style differs from the one visitors see. */
  changed: boolean;
  pages: PageInfo[];
  lists: MenuList[];
  /** The sections the bar above the header may show (ADR 0085 d3). */
  sections?: SectionInfo[];
  /** Whether the shop is on: the header may then show the cart. */
  shop?: boolean;
  handPicked?: number;
  onpart: (part: DesignPart) => void;
  onsite: (site: Site) => void;
  ontheme: (theme: Theme) => void;
  onchoose: (theme: Theme) => void;
  onpublish: () => void;
} = $props();

</script>

<h2>{t.look.heading}</h2>
<div class="parts" role="tablist" aria-label={t.look.heading}>
  {#each DESIGN_PARTS as one (one)}
    <button type="button" role="tab" aria-selected={part === one} onclick={() => onpart(one)} data-design-part={one}>{t.look.parts[one]}</button>
  {/each}
</div>

<div class="saved" data-theme-state={changed ? 'changed' : 'published'}>
  <p class="hint">{changed ? t.look.savedDraft : t.look.savedLive}</p>
  {#if changed}<button type="button" class="primary" onclick={onpublish} data-theme-publish-here>{t.theme.publish}</button>{/if}
</div>

<div role="tabpanel" data-design={part}>
  {#if part === 'style'}
    <p class="hint" data-panel-intro="theme">{t.look.styleIntro}</p>
    <ThemeBuilder {theme} onchange={ontheme} {handPicked} {ready} {onchoose} />
  {:else if part === 'header'}
    <HeaderPanel {site} {theme} {pages} {lists} {sections} {shop} {onsite} {ontheme} />
  {:else}
    <FooterPanel {site} {theme} {onsite} {ontheme} />
  {/if}
</div>

<style>
  .parts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 2px; padding: 3px; margin: 0 0 0.8rem; border-radius: 9px; background: #eceaf4; }
  .parts button { margin: 0; padding: 0.4rem 0.2rem; border: 0; border-radius: 7px; background: transparent; font-size: 12.5px; font-weight: 600; color: #4b4960; line-height: 1.2; }
  .parts button[aria-selected='true'] { background: #fff; color: #1e1e27; box-shadow: 0 1px 2px rgb(30 30 39 / 0.12); }
  .parts button:focus-visible { outline: 2px solid #5b4cdb; outline-offset: 1px; }
  .saved { display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem 0.6rem; margin: 0 0 0.8rem; padding: 0.55rem 0.7rem; border-radius: 8px; background: #f2f1f7; }
  .saved[data-theme-state='changed'] { background: #fff6d6; }
  .saved p { margin: 0; flex: 1 1 12rem; }
</style>
