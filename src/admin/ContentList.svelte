<script lang="ts">
/**
 * One section of the admin: every page, or every post, as a list. Choosing
 * one opens it in the builder; the list itself changes nothing.
 */
import { type ContentType, entryPath, pagePath, POSTS_TYPE, slugify } from '../core/index.ts';
import type { Kind, PageInfo, PostInfo } from './api.ts';
import { t } from './messages.ts';

let {
  kind,
  type,
  items,
  onopen,
  oncreate,
}: { kind: Kind; /** The content type listed; none for pages. */ type?: ContentType; items: (PageInfo | PostInfo)[]; onopen: (slug: string) => void; oncreate: (title: string) => void } = $props();

/** Posts keep the name the rest of the admin knows them by. */
const mark = $derived(kind === POSTS_TYPE ? 'post' : kind);

let title = $state<string | null>(null);
const words = $derived(
  !type
    ? { heading: t.nav.pages, add: t.app.newPage, none: '' }
    : kind === POSTS_TYPE
      ? { heading: type.name, add: t.posts.newPost, none: t.posts.none }
      : { heading: type.name, add: t.ctypes.newEntry(type.singular), none: t.ctypes.noEntries },
);
const status = (item: PageInfo): string => (!item.published ? t.bar.draft : item.changed ? t.bar.changed : t.bar.published);
</script>

<section class="screen" data-list={mark}>
  <header>
    <h1>{words.heading}</h1>
    {#if title === null}
      <button type="button" class="primary" onclick={() => (title = '')} data-new={mark}>+ {words.add}</button>
    {:else}
      <form
        onsubmit={(e) => {
          e.preventDefault();
          if (slugify(title)) oncreate((title ?? '').trim());
          title = null;
        }}
      >
        <!-- svelte-ignore a11y_autofocus -->
        <input type="text" placeholder={t.app.pageTitle} bind:value={title} maxlength="200" autofocus />
        <button type="submit" class="primary" disabled={!slugify(title)}>{t.app.create}</button>
        <button type="button" class="quiet" onclick={() => (title = null)}>{t.app.cancel}</button>
      </form>
    {/if}
  </header>
  {#if items.length === 0}
    <p class="hint">{words.none}</p>
  {:else}
    <table>
      <thead>
        <tr>
          <th>{t.inspector.title}</th>
          <th>{t.list.address}</th>
          {#if type?.dated}<th>{t.posts.date}</th>{/if}
          <th>{t.list.status}</th>
        </tr>
      </thead>
      <tbody>
        {#each items as item (item.slug)}
          <tr>
            <td><button type="button" class="open" onclick={() => onopen(item.slug)} data-open={item.slug}>{item.title}</button></td>
            <td class="quiet">{type ? entryPath(type, item.slug) : pagePath(item.slug)}</td>
            {#if type?.dated}<td class="quiet">{'date' in item ? item.date : ''}</td>{/if}
            <td class="quiet" class:live={item.published && !item.changed}>{status(item)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</section>

<style>
  header { display: flex; align-items: center; gap: 1rem; margin-bottom: 1rem; }
  h1 { margin: 0; font-size: 1.4rem; flex: 1; }
  form { display: flex; gap: 0.4rem; }
  form input { width: 16rem; }
  table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #dddbe6; border-radius: 8px; overflow: hidden; }
  th, td { padding: 0.55rem 0.8rem; text-align: start; border-bottom: 1px solid #eceaf3; }
  th { font-size: 12px; letter-spacing: 0.05em; text-transform: uppercase; color: #6a6880; font-weight: 600; }
  tr:last-child td { border-bottom: 0; }
  td.quiet { color: #6a6880; }
  td.live { color: #1b7a43; }
  .open { border: 0 !important; padding: 0 !important; background: none !important; font-weight: 600 !important; color: #4a3bd6 !important; text-align: start; }
  .open:hover { text-decoration: underline; }
</style>
