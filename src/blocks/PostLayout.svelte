<script lang="ts">
/** A blog post: its date, categories, title and cover, then its blocks. */
import type { Post, Site } from '../core/index.ts';
import { blogPath, categoryPath } from '../core/index.ts';
import BlockView from './BlockView.svelte';
import Shell from './Shell.svelte';
import { dateText } from './words.ts';

let {
  site,
  post,
  menu,
  editing = false,
}: { site: Site; post: Post; menu: { title: string; href: string }[]; editing?: boolean } = $props();
</script>

<Shell {site} {menu} current={blogPath()} {editing}>
  <article class="post">
    <header class="b post-head">
      <div class="b-in">
        <p class="post-meta">
          <time datetime={post.date}>{dateText(post.date, site.language)}</time>
          {#each post.categories as name}<a href={categoryPath(name)}>{name}</a>{/each}
        </p>
        <h1>{post.title}</h1>
        {#if post.cover}<img class="post-cover" src={post.cover.src} alt={post.cover.alt} />{/if}
      </div>
    </header>
    {#each post.blocks as block (block.id)}<BlockView {block} />{/each}
    {#if editing && post.blocks.length === 0}<div class="cms-empty" data-empty="page"></div>{/if}
  </article>
</Shell>
