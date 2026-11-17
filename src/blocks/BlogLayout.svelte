<script lang="ts">
/** A list of posts: the blog's front page, a later page of it, or one category. */
import type { Post, Site } from '../core/index.ts';
import { blogPath, categoryPath, postExcerpt, postPath } from '../core/index.ts';
import Shell from './Shell.svelte';
import { dateText, wordsFor } from './words.ts';

let {
  site,
  menu,
  heading,
  posts,
  newer = '',
  older = '',
}: {
  site: Site;
  menu: { title: string; href: string }[];
  heading: string;
  posts: Post[];
  /** The address of the page with newer posts, when there is one. */
  newer?: string;
  older?: string;
} = $props();
const words = $derived(wordsFor(site.language));
</script>

<Shell {site} {menu} current={blogPath()}>
  <section class="b blog">
    <div class="b-in">
      <h1>{heading}</h1>
      {#if posts.length === 0}<p class="lead">{words.noPosts}</p>{/if}
      <ul class="posts">
        {#each posts as post (post.slug)}
          <li class="post-card">
            {#if post.cover}<a href={postPath(post.slug)} tabindex="-1" aria-hidden="true"><img src={post.cover.src} alt="" loading="lazy" decoding="async" /></a>{/if}
            <p class="post-meta">
              <time datetime={post.date}>{dateText(post.date, site.language)}</time>
              {#each post.categories as name}<a href={categoryPath(name)}>{name}</a>{/each}
            </p>
            <h2><a href={postPath(post.slug)}>{post.title}</a></h2>
            <p>{postExcerpt(post)}</p>
          </li>
        {/each}
      </ul>
      {#if newer || older}
        <nav class="pager" aria-label={words.pages}>
          {#if newer}<a rel="prev" href={newer}>{words.newer}</a>{/if}
          {#if older}<a rel="next" href={older}>{words.older}</a>{/if}
        </nav>
      {/if}
    </div>
  </section>
</Shell>
