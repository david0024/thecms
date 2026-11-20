<script lang="ts">
/** A list of entries of one content type: its front page, a later page of it, or one category. */
import type { ContentType, MenuLink, Post, Site } from '../core/index.ts';
import { entryPath, listPath, postExcerpt, postsType } from '../core/index.ts';
import PostMeta from './PostMeta.svelte';
import Shell from './Shell.svelte';
import { wordsFor } from './words.ts';

let {
  site,
  menu,
  heading,
  posts,
  newer = '',
  older = '',
  type,
}: {
  site: Site;
  menu: MenuLink[];
  heading: string;
  posts: Post[];
  /** The address of the page with newer posts, when there is one. */
  newer?: string;
  older?: string;
  type?: ContentType;
} = $props();
const kind = $derived(type ?? postsType());
const words = $derived(wordsFor(site.language));
</script>

<Shell {site} {menu} current={listPath(kind)} layout={kind.layout}>
  <section class="b blog">
    <div class="b-in">
      <h1>{heading}</h1>
      {#if posts.length === 0}<p class="lead">{words.noPosts}</p>{/if}
      <ul class="posts">
        {#each posts as post (post.slug)}
          <li class="post-card">
            {#if post.cover}<a href={entryPath(kind, post.slug)} tabindex="-1" aria-hidden="true"><img src={post.cover.src} alt="" loading="lazy" decoding="async" /></a>{/if}
            <PostMeta type={kind} {post} language={site.language} />
            <h2><a href={entryPath(kind, post.slug)}>{post.title}</a></h2>
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
