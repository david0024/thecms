<script lang="ts">
/**
 * One entry of a content type (a blog post, a project). By default: what its
 * type asks for, its title and cover, then its blocks. A type that has its
 * own page (ADR 0015) draws that page instead, with the entry's parts where
 * the page puts them.
 */
import type { Block, ContentType, Crumb, MenuLink, Post, Site } from '../core/index.ts';
import { listPath, pictureIn, placesRelated, postsType } from '../core/index.ts';
import EntryFields from './EntryFields.svelte';
import { type EntryLists, setEntry } from './editing.ts';
import BlockView from './BlockView.svelte';
import Breadcrumbs from './Breadcrumbs.svelte';
import Comments from './Comments.svelte';
import Frozen from './Frozen.svelte';
import PostMeta from './PostMeta.svelte';
import Related from './Related.svelte';
import Shell from './Shell.svelte';

let {
  site,
  post,
  menu,
  editing = false,
  type,
  lists = {},
  template = null,
  designing = false,
  crumbs = [],
}: {
  site: Site;
  post: Post;
  menu: MenuLink[];
  editing?: boolean;
  type?: ContentType;
  lists?: EntryLists;
  /** The type's own page, when it has one. */
  template?: Block[] | null;
  /** The editor is changing the type's page, not this entry. */
  designing?: boolean;
  /** Where the entry is, shown above it (ADR 0050 d4); empty: none. */
  crumbs?: Crumb[];
} = $props();
const kind = $derived(type ?? postsType());
// The entries linked to this one are drawn after it, unless its type's page puts them somewhere (ADR 0052 d3).
const placed = $derived(!!template && placesRelated(template));
// Read once: a page is drawn for one entry and one type.
// svelte-ignore state_referenced_locally
setEntry({ post, type: type ?? postsType(), language: site.language, editing: editing ? (designing ? 'template' : 'entry') : null });
</script>

<Shell {site} {menu} current={listPath(kind)} {editing} {lists} layout={kind.layout}>
  <Breadcrumbs {crumbs} language={site.language} />
  <article class="post">
    {#if template}
      {#if editing && !designing}
        <Frozen>{#each template as block (block.id)}<BlockView {block} />{/each}</Frozen>
      {:else}
        {#each template as block (block.id)}<BlockView {block} />{/each}
        {#if editing && template.length === 0}<div class="cms-empty" data-empty="page"></div>{/if}
      {/if}
    {:else}
      <header class="b post-head">
        <div class="b-in">
          <PostMeta type={kind} {post} language={site.language} />
          <h1>{post.title}</h1>
          {#if post.cover}{@const pa = pictureIn(site, kind.layout, post.cover.src, 'full')}<img class="post-cover" src={post.cover.src} srcset={pa.srcset} sizes={pa.sizes} width={pa.width} height={pa.height} alt={post.cover.alt} />{/if}
          <EntryFields type={kind} {post} language={site.language} />
        </div>
      </header>
      {#each post.blocks as block (block.id)}<BlockView {block} />{/each}
      {#if editing && post.blocks.length === 0}<div class="cms-empty" data-empty="page"></div>{/if}
    {/if}
    {#if !placed}<Related type={kind} {post} language={site.language} />{/if}
    {#if kind.dated && post.author?.bio}
      <aside class="b post-bio" data-author>
        <div class="b-in"><p><strong>{post.author.name}</strong></p><p>{post.author.bio}</p></div>
      </aside>
    {/if}
  </article>
  {#if kind.comments && !editing}<Comments {site} type={kind} {post} />{/if}
</Shell>
