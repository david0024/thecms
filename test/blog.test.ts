import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { categoriesOf, isDate, newestFirst, normalizePost, normalizeSite, paginate, parseTheme, type Post, postExcerpt, type Theme } from '../src/core/index.ts';
import { DEMO_PAGES, DEMO_POSTS, DEMO_SITE } from '../src/site/demo.ts';
import { renderPost } from '../src/site/document.ts';
import { buildSite, exportSite } from '../src/site/export.ts';
import { type EditorServer, startEditor } from '../src/site/server.ts';
import { Store } from '../src/site/store.ts';
import plain from '../themes/plain.json';

/** The page without its data for search engines: the one script element, which no browser runs (ADR 0030). */
const withoutData = (html: string): string => html.replace(/<script type="application\/ld\+json">[^<]*<\/script>/g, '');

const theme = parseTheme(plain).theme as Theme;
const site = normalizeSite({ ...DEMO_SITE, url: 'https://example.com' });
const post = (over: Record<string, unknown> = {}): Post => normalizePost({ title: 'A post', date: '2026-03-04', blocks: [], ...over }).post;
const text = (files: Map<string, string | Uint8Array>, path: string): string => files.get(path) as string;
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='), (c) => c.charCodeAt(0));

describe('a post as a document', () => {
  test('a date is a real day, written one way', async () => {
    for (const good of ['2026-01-31', '2024-02-29']) expect(isDate(good)).toBe(true);
    for (const bad of ['2026-02-30', '2026-13-01', '26-01-01', '2026-1-1', '2026-01-01T00:00', '', null, 20260101]) expect(isDate(bad)).toBe(false);
  });

  test('a post with no valid date takes the day it is given; its address comes from its title', async () => {
    const { post: cleaned, issues } = normalizePost({ title: 'Prețuri noi!', date: 'tomorrow' }, '2026-05-06');
    expect(cleaned).toMatchObject({ slug: 'preturi-noi', date: '2026-05-06', cover: null, categories: [], excerpt: '' });
    expect(issues).toEqual([]);
    expect(normalizePost({ title: '' }).issues.map((i) => i.path)).toEqual(['title', 'slug']);
  });

  test('categories: trimmed, at most eight, and two spellings of one address are one category', async () => {
    const { categories } = post({ categories: ['  News ', 'news', 'NEWS!', '', '!!!', 7, 'Work  shop', ...'abcdefgh'.split('')] });
    expect(categories).toEqual(['News', 'Work shop', 'a', 'b', 'c', 'd', 'e', 'f']);
  });

  test('tags: like categories, at most twenty; a type without categories keeps neither', async () => {
    expect(post({ tags: [' Oak ', 'oak', 'Kitchen', ...Array.from({ length: 30 }, (_, i) => `t${i}`)] }).tags).toEqual(['Oak', 'Kitchen', ...Array.from({ length: 18 }, (_, i) => `t${i}`)]);
    const plainType = { id: 'team', name: 'Team', singular: 'Person', path: 'team', dated: false, categories: false, feed: false, fields: [] };
    expect(normalizePost({ title: 'A', tags: ['x'], categories: ['y'] }, '2026-01-01', plainType).post).toMatchObject({ tags: [], categories: [] });
  });

  test('a cover is checked like any image', async () => {
    expect(post({ cover: { src: 'javascript:alert(1)', alt: '' } }).cover).toBeNull();
    expect(post({ cover: { src: '/media/x.png', alt: 'A' } }).cover).toEqual({ src: '/media/x.png', alt: 'A' });
  });

  test('the summary is the author\'s, or the start of the post', async () => {
    const body = { type: 'text', content: { body: [{ type: 'paragraph', children: [{ text: 'First words of the post.' }] }] } };
    expect(postExcerpt(post({ blocks: [body] }))).toBe('First words of the post.');
    expect(postExcerpt(post({ blocks: [body], excerpt: 'Mine.' }))).toBe('Mine.');
  });

  test('newest first, and a fixed order within a day', async () => {
    const posts = [post({ slug: 'b', date: '2026-01-01' }), post({ slug: 'c', date: '2026-02-01' }), post({ slug: 'a', date: '2026-01-01' })];
    expect(newestFirst(posts).map((p) => p.slug)).toEqual(['c', 'a', 'b']);
  });

  test('categories gather their posts; a list is cut into pages and an empty one still has a page', async () => {
    const posts = [post({ slug: 'a', categories: ['News'] }), post({ slug: 'b', categories: ['news', 'Tips'] })];
    expect(categoriesOf(posts).map((c) => `${c.name}:${c.posts.map((p) => p.slug).join('+')}`)).toEqual(['News:a+b', 'Tips:b']);
    expect(paginate([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(paginate([], 2)).toEqual([[]]);
  });
});

describe('the blog as files', () => {
  const pages = DEMO_PAGES.map((p) => ({ ...p, description: '', inMenu: true })) as never;
  const many = Array.from({ length: 23 }, (_, i) => post({ slug: `post-${String(i + 1).padStart(2, '0')}`, title: `Post ${i + 1}`, date: `2026-01-${String(i + 1).padStart(2, '0')}`, categories: i < 12 ? ['Old'] : ['New'] }));

  test('a site with no posts has no blog: no pages, no menu entry, no feed', async () => {
    const files = await buildSite(site, theme, pages);
    expect([...files.keys()].filter((path) => path.startsWith('blog'))).toEqual([]);
    expect(text(files, 'index.html')).not.toContain('href="/blog/"');
  });

  test('the list is cut into pages that lead to each other', async () => {
    const files = await buildSite(site, theme, pages, () => null, many);
    const first = text(files, 'blog/index.html');
    const second = text(files, 'blog/page/2/index.html');
    const third = text(files, 'blog/page/3/index.html');
    expect(first.match(/class="post-card"/g)).toHaveLength(10);
    expect(first).toContain('<h2><a href="/blog/post-23/">Post 23</a></h2>');
    expect(first).toContain('<a rel="next" href="/blog/page/2/">Older posts</a>');
    expect(first).not.toContain('rel="prev"');
    expect(second).toContain('<a rel="prev" href="/blog/">Newer posts</a>');
    expect(second).toContain('<a rel="next" href="/blog/page/3/">Older posts</a>');
    expect(third.match(/class="post-card"/g)).toHaveLength(3);
    expect(third).not.toContain('rel="next"');
    expect(files.has('blog/page/4/index.html')).toBe(false);
    // A category has its own pages.
    expect(text(files, 'blog/category/old/page/2/index.html').match(/class="post-card"/g)).toHaveLength(2);
    expect(text(files, 'index.html')).toContain('<a href="/blog/">Blog</a>');
  });

  test('a tag has its list, its pages and its place in the feed; a post links to its tags', async () => {
    const tagged = [post({ slug: 'a', title: 'A', categories: ['News'], tags: ['Oak', 'Kitchen'] }), post({ slug: 'b', title: 'B', date: '2026-03-05', tags: ['oak'] })];
    const files = await buildSite(site, theme, pages, () => null, tagged);
    const oak = text(files, 'blog/tag/oak/index.html');
    // Spelled as the newest post spells it, as a category is.
    expect(oak).toContain('<h1>#oak</h1>');
    expect(oak.match(/class="post-card"/g)).toHaveLength(2);
    expect(text(files, 'blog/tag/kitchen/index.html').match(/class="post-card"/g)).toHaveLength(1);
    expect(text(files, 'blog/a/index.html')).toContain('<a class="post-tag" href="/blog/tag/oak/">#Oak</a>');
    expect(text(files, 'sitemap.xml')).toContain('<loc>https://example.com/blog/tag/oak/</loc>');
    expect(text(files, 'blog/feed.xml')).toContain('<category term="Kitchen"/>');
  });

  test('the sitemap and the feed name every address in full; the feed stops at thirty', async () => {
    const files = await buildSite(site, theme, pages, () => null, [...many, ...Array.from({ length: 10 }, (_, i) => post({ slug: `extra-${i}`, date: '2025-01-01' }))]);
    const sitemap = text(files, 'sitemap.xml');
    for (const path of ['/blog/', '/blog/page/2/', '/blog/post-01/', '/blog/category/new/']) expect(sitemap).toContain(`<loc>https://example.com${path}</loc>`);
    const feed = text(files, 'blog/feed.xml');
    expect(feed.match(/<entry>/g)).toHaveLength(30);
    expect(feed).toContain('<updated>2026-01-23T00:00:00Z</updated>');
    expect(text(files, 'blog/index.html')).toContain('<link rel="alternate" type="application/atom+xml" title="Atelier Nord" href="/blog/feed.xml">');
  });

  test('without the site\'s address there is no feed, and no page points at one', async () => {
    const files = await buildSite({ ...site, url: '' }, theme, pages, () => null, many);
    expect(files.has('blog/feed.xml')).toBe(false);
    expect(text(files, 'blog/index.html')).not.toContain('atom');
  });

  test('what an author wrote is text everywhere it lands: the page, its head, the list, the feed', async () => {
    const evil = post({ title: '<script>alert(1)</script> & "co"', excerpt: '</summary><x>', categories: ['<b>Tag</b>'] });
    const files = await buildSite(site, theme, pages, () => null, [evil]);
    for (const [path, contents] of files) {
      // The site's data (ADR 0057 d3) holds the words as words; the HTML it carries is escaped like the page.
      const shown = path.endsWith('.json') ? JSON.stringify(JSON.parse(contents as string).html ?? '') : contents;
      if (typeof contents === 'string') expect(`${path}: ${/<script|<x>|<b>Tag/.test(withoutData(shown as string))}`).toBe(`${path}: false`);
    }
    expect(JSON.parse(text(files, 'blog/script-alert-1-script-co/index.json')).title).toBe('<script>alert(1)</script> & "co"');
    expect(text(files, 'blog/feed.xml')).toContain('<title>&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;co&quot;</title>');
  });

  test('a post page: an article with its date in the site\'s language, and a picture for link previews', async () => {
    const html = renderPost({ ...site, language: 'ro' }, theme, post({ cover: { src: '/media/c.png', alt: 'Cover' }, categories: ['Știri'] }), []);
    expect(html).toContain('<time datetime="2026-03-04">4 martie 2026</time>');
    expect(html).toContain('<a href="/blog/category/stiri/">Știri</a>');
    expect(html).toContain('<meta property="og:type" content="article">');
    expect(html).toContain('<meta property="og:image" content="https://example.com/media/c.png">');
    expect(html).toContain('<img class="post-cover" src="/media/c.png" alt="Cover"');
    expect(withoutData(html)).not.toMatch(/data-edit|cms-|<script/);
    expect(html).toContain('<script type="application/ld+json">');
  });
});

describe('posts in the store and the editor', () => {
  let dir: string;
  let store: Store;
  let editor: EditorServer;
  const HOST = '127.0.0.1:4321';
  const call = (path: string, method = 'GET', body?: unknown): Promise<Response> =>
    editor.fetch(new Request(`http://${HOST}${path}`, { method, headers: { host: HOST, 'x-uhlaka-token': editor.token, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }));

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'uhlaka-'));
    store = await Store.open(join(dir, 'site.db'));
    await store.setSite(DEMO_SITE);
    await store.setTheme(plain);
    await store.publishTheme();
    for (const page of DEMO_PAGES) await store.publish((await store.savePage(page)).slug);
    editor = await startEditor(store, { listen: false });
  });
  afterEach(async () => {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  });

  test('a draft post is not in the export; a published one stays as published while its draft changes', async () => {
    await store.savePost(DEMO_POSTS[0]);
    const out = join(dir, 'out');
    expect((await exportSite(store, out)).filter((f) => f.startsWith('blog'))).toEqual([]);
    await store.publishPost('a-table-for-twelve');
    await store.savePost({ ...DEMO_POSTS[0], title: 'Changed, not published' });
    expect((await store.posts())[0]).toMatchObject({ title: 'Changed, not published', published: true, changed: true });
    await exportSite(store, out);
    const html = await Bun.file(join(out, 'blog/a-table-for-twelve/index.html')).text();
    expect(html).toContain('<h1>A table for twelve</h1>');
    expect(html).not.toContain('Changed');
  });

  test('a post and a page may share a name; a page may not take an address the site uses', async () => {
    await store.savePost({ title: 'About' });
    expect((await store.postDraft('about'))?.title).toBe('About');
    expect((await store.draft('about'))?.title).toBe('About');
    for (const title of ['Blog', 'Media', 'Assets']) {
      expect((await call('/api/page', 'PUT', { page: { title, slug: title }, create: true })).status).toBe(409);
      await expect(store.savePage({ title, slug: title })).rejects.toThrow('used by the site itself');
    }
  });

  test('the editing API: create, refuse a second of the same address, draw, publish, delete', async () => {
    const created = await call('/api/page', 'PUT', { kind: 'post', create: true, page: { title: 'Hello there', blocks: [] } });
    const { page, posts } = (await created.json()) as { page: Post; posts: { slug: string; published: boolean }[] };
    expect(page.slug).toBe('hello-there');
    expect(page.date).toBe(new Date().toISOString().slice(0, 10));
    expect(posts).toEqual([expect.objectContaining({ slug: 'hello-there', published: false })]);
    expect((await call('/api/page', 'PUT', { kind: 'post', create: true, page: { title: 'Hello there' } })).status).toBe(409);
    const drawn = (await (await call('/api/render', 'POST', { kind: 'post', page })).json()) as { body: string };
    expect(drawn.body).toContain('<article class="post">');
    expect(drawn.body).toContain('<a href="/blog/" aria-current="page">Blog</a>');
    expect((await call('/api/publish', 'POST', { kind: 'post', slug: 'hello-there' })).status).toBe(200);
    expect(await store.publishedPosts()).toHaveLength(1);
    expect((await call('/api/page?kind=post&slug=hello-there')).status).toBe(200);
    expect((await call('/api/page?kind=post&slug=hello-there', 'DELETE')).status).toBe(200);
    expect((await call('/api/page?kind=post&slug=hello-there')).status).toBe(404);
    expect(await store.pages()).toHaveLength(DEMO_PAGES.length);
  });

  test('a post\'s cover is an image in use, and is exported', async () => {
    const item = await store.addMedia(PNG);
    await store.publishPost((await store.savePost({ title: 'With a cover', cover: { src: item.path, alt: '' } })).slug);
    await expect(store.deleteMedia(item.name)).rejects.toThrow('With a cover');
    expect(await exportSite(store, join(dir, 'out'))).toContain(item.path.slice(1));
  });
});
