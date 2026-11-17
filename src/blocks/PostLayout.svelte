<script lang="ts">
/** One entry of a content type (a blog post, a project): what its type asks for, its title and cover, then its blocks. */
import type { ContentType, MenuLink, Post, Site } from '../core/index.ts';
import { listPath, postsType, typeCategoryPath } from '../core/index.ts';
import EntryFields from './EntryFields.svelte';
import BlockView from './BlockView.svelte';
import Shell from './Shell.svelte';
import { dateText } from './words.ts';

let {
  site,
  post,
  menu,
  editing = false,
  type,
}: { site: Site; post: Post; menu: MenuLink[]; editing?: boolean; type?: ContentType } = $props();
const kind = $derived(type ?? postsType(site.blogTitle));
</script>

<Shell {site} {menu} current={listPath(kind)} {editing}>
  <article class="post">
    <header class="b post-head">
      <div class="b-in">
        {#if kind.dated || post.categories.length}
          <p class="post-meta">
            {#if kind.dated}<time datetime={post.date}>{dateText(post.date, site.language)}</time>{/if}
            {#each post.categories as name}<a href={typeCategoryPath(kind, name)}>{name}</a>{/each}
          </p>
        {/if}
        <h1>{post.title}</h1>
        {#if post.cover}<img class="post-cover" src={post.cover.src} alt={post.cover.alt} />{/if}
        <EntryFields type={kind} {post} language={site.language} />
      </div>
    </header>
    {#each post.blocks as block (block.id)}<BlockView {block} />{/each}
    {#if editing && post.blocks.length === 0}<div class="cms-empty" data-empty="page"></div>{/if}
  </article>
</Shell>
