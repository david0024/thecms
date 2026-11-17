<script lang="ts">
/** A page: its blocks, inside what every page shares. */
import type { MenuLink, Page, Site } from '../core/index.ts';
import type { EntryLists } from './editing.ts';
import { pagePath } from '../core/index.ts';
import BlockView from './BlockView.svelte';
import Shell from './Shell.svelte';

let {
  site,
  page,
  menu,
  editing = false,
  lists = {},
}: { site: Site; page: Page; menu: MenuLink[]; editing?: boolean; lists?: EntryLists } = $props();
</script>

<Shell {site} {menu} current={pagePath(page.slug)} {editing} {lists}>
  {#each page.blocks as block (block.id)}<BlockView {block} />{/each}
  {#if editing && page.blocks.length === 0}<div class="cms-empty" data-empty="page"></div>{/if}
</Shell>
