<script lang="ts">
/** A list of entries: a type's front page, a later page of it, one category or tag, one person's (with who they are), or one period (ADR 0056). */
import type { Byline, ContentType, Crumb, MenuLink, Post, Site } from '../core/index.ts';
import { entryPath, listPath, pictureIn, postExcerpt, postsType } from '../core/index.ts';
import Breadcrumbs from './Breadcrumbs.svelte';
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
  crumbs = [],
  kinds = [],
  person = null,
  current = null,
}: {
  site: Site;
  menu: MenuLink[];
  heading: string;
  posts: Post[];
  /** The address of the page with newer posts, when there is one. */
  newer?: string;
  older?: string;
  type?: ContentType;
  /** Where the list is, shown above it (ADR 0050 d4); empty: none. */
  crumbs?: Crumb[];
  /** Each entry's own type, in the order of `posts`, when they are of several (a person's page). */
  kinds?: ContentType[];
  /** Whose entries these are, shown above them. */
  person?: Byline | null;
  /** What the menu marks as where the visitor is; the type's list when not said. */
  current?: string | null;
} = $props();
const kind = $derived(type ?? postsType());
const typeOf = (i: number): ContentType => kinds[i] ?? kind;
const words = $derived(wordsFor(site.language));
</script>

<Shell {site} {menu} current={current ?? listPath(kind)} layout={kind.layout}>
  <Breadcrumbs {crumbs} language={site.language} />
  <section class="b blog">
    <div class="b-in">
      {#if person}
        <div class="author-head" data-author-page>
          {#if person.picture}<img class="author-picture" src={person.picture.src} alt="" width="64" height="64" />{/if}
          <div>
            <h1>{heading}</h1>
            {#if person.bio}<p class="lead">{person.bio}</p>{/if}
          </div>
        </div>
      {:else}
        <h1>{heading}</h1>
      {/if}
      {#if posts.length === 0}<p class="lead">{words.noPosts}</p>{/if}
      <ul class="posts">
        {#each posts as post, i (`${typeOf(i).id}/${post.slug}`)}
          <li class="post-card">
            {#if post.cover}{@const pa = pictureIn(site, kind.layout, post.cover.src, 'card')}<a href={entryPath(typeOf(i), post.slug)} tabindex="-1" aria-hidden="true"><img src={post.cover.src} srcset={pa.srcset} sizes={pa.sizes} width={pa.width} height={pa.height} alt="" loading="lazy" decoding="async" /></a>{/if}
            <PostMeta type={typeOf(i)} {post} language={site.language} />
            <h2><a href={entryPath(typeOf(i), post.slug)}>{post.title}</a></h2>
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
