/**
 * Archives by author and by date (ADR 0056): a dated type's entries by who
 * wrote them and by year, month and day, at that type's own address, in each
 * of its languages; each person's page across every dated type, with their
 * picture; the archive block; the addresses an entry may not take; and the
 * people and old archives a WordPress import brings.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  authorPath,
  authorSlugs,
  type Byline,
  datePath,
  entrySlugProblem,
  listTrail,
  normalizePost,
  normalizeSite,
  normalizeTypes,
  parseTheme,
  periodName,
  periodsOf,
  type Post,
  postsType,
  RESERVED_SLUGS,
  type Theme,
  typeAuthorPath,
  typeIn,
} from '../src/core/index.ts';
import { runImport } from '../src/import/run.ts';
import { planImport } from '../src/import/wxr.ts';
import { DEMO_PAGES, DEMO_SITE } from '../src/site/demo.ts';
import { renderPage } from '../src/site/document.ts';
import { buildSite } from '../src/site/export.ts';
import { Store } from '../src/site/store.ts';
import plain from '../themes/plain.json';

const dir = await mkdtemp(join(tmpdir(), 'thecms-archives-'));
afterAll(() => rm(dir, { recursive: true, force: true }));

const theme = parseTheme(plain).theme as Theme;
const blog = { ...postsType(), translations: { ro: { name: 'Jurnal', singular: 'Articol', path: 'jurnal' } } };
const news = { id: 'news', name: 'News', singular: 'Story', path: 'news', dated: true, categories: false, feed: false, fields: [] };
const team = { id: 'team', name: 'Team', singular: 'Person', path: 'team', dated: false, categories: false, feed: false, fields: [] };
const site = normalizeSite({ ...DEMO_SITE, url: 'https://example.com', languages: ['ro'], types: [blog, news, team] });
const [posts, stories, people] = normalizeTypes([blog, news, team]);
const entry = (type: typeof posts, over: Record<string, unknown>): Post => normalizePost({ blocks: [], ...over }, undefined, type).post;

const PIC = `${'a'.repeat(32)}.png`;
const ana: Byline = { name: 'Ana Pop', bio: 'Ana restores old doors.', slug: 'ana-pop', picture: { src: `/media/${PIC}`, alt: 'Ana Pop' } };
const ion: Byline = { name: 'Ion', bio: '', slug: 'ion' };
const published = {
  posts: [
    entry(posts!, { slug: 'oak', title: 'Oak', date: '2026-11-21', translations: { ro: { slug: 'stejar', title: 'Stejar' } } }),
    entry(posts!, { slug: 'ash', title: 'Ash', date: '2026-11-03' }),
    entry(posts!, { slug: 'pine', title: 'Pine', date: '2025-02-10' }),
  ],
  news: [entry(stories!, { slug: 'opening', title: 'We open', date: '2026-10-01' })],
  team: [entry(people!, { slug: 'maria', title: 'Maria' })],
};
const bylines: Record<string, Byline> = { 'posts/oak': ana, 'posts/pine': ana, 'posts/ash': ion, 'news/opening': ana, 'team/maria': ana };
const PICTURE = new Uint8Array([1]);
const pages = DEMO_PAGES.map((p) => ({ ...p, description: '', inMenu: true })) as never;
const build = () => buildSite(site, theme, pages, (name) => (name === PIC ? PICTURE : null), published, [], {}, [], {}, {}, {}, bylines);
const text = (files: Map<string, string | Uint8Array>, path: string): string => String(files.get(path) ?? '');

describe('the addresses', () => {
  test('are made from each type\'s own, in each language', () => {
    expect(typeAuthorPath(stories!, 'ana-pop')).toBe('/news/author/ana-pop/');
    expect(typeAuthorPath(posts!, 'ana-pop', 2)).toBe('/blog/author/ana-pop/page/2/');
    expect(typeAuthorPath(typeIn(site, posts!, 'ro'), 'ana-pop')).toBe('/ro/jurnal/author/ana-pop/');
    expect(datePath(stories!, '2026')).toBe('/news/2026/');
    expect(datePath(stories!, '2026-11')).toBe('/news/2026/11/');
    expect(datePath(stories!, '2026-11-21', 3)).toBe('/news/2026/11/21/page/3/');
    expect(authorPath('', 'ana-pop')).toBe('/author/ana-pop/');
    expect(authorPath('/ro', 'ana-pop', 2)).toBe('/ro/author/ana-pop/page/2/');
    // A page may not take the people's address.
    expect(RESERVED_SLUGS).toContain('author');
  });

  test('each person\'s comes from their name, in the order they joined; someone without a name has none', () => {
    const slugs = authorSlugs([
      { id: 'a', name: 'Ana Pop' },
      { id: 'b', name: '' },
      { id: 'c', name: 'Ana  Pop!' },
      { id: 'd', name: 'Ana Pop' },
    ]);
    expect([...slugs]).toEqual([
      ['a', 'ana-pop'],
      ['c', 'ana-pop-2'],
      ['d', 'ana-pop-3'],
    ]);
  });

  test('a dated entry may not take one of digits alone, or the people\'s; an undated one may', () => {
    expect(entrySlugProblem(posts!, '2026')).toContain('only digits');
    expect(entrySlugProblem(posts!, 'author')).toContain('authors');
    expect(entrySlugProblem(posts!, '2026-plans')).toBe('');
    expect(entrySlugProblem(people!, '2026')).toBe('');
  });

  test('periods, newest first, named in the language', () => {
    const all = published.posts;
    expect(periodsOf(all, 4).map((p) => [p.period, p.posts.length])).toEqual([
      ['2026', 2],
      ['2025', 1],
    ]);
    expect(periodsOf(all, 7).map((p) => p.period)).toEqual(['2026-11', '2025-02']);
    expect(periodsOf(all, 10).map((p) => p.period)).toEqual(['2026-11-21', '2026-11-03', '2025-02-10']);
    expect(periodName('2026', 'ro')).toBe('2026');
    expect(periodName('2026-11', 'ro')).toBe('noiembrie 2026');
    expect(periodName('2026-11', 'en')).toBe('November 2026');
    expect(periodName('2026-11-21', 'ro')).toBe('21 noiembrie 2026');
    expect(periodName('2026-11', 'not a language!')).toBe('2026-11');
  });

  test('a list of an author or a period is one step under its type\'s', () => {
    expect(listTrail('Home', posts!, 'Ana Pop', '/blog/author/ana-pop/').map((c) => c.href)).toEqual(['/', '/blog/', '/blog/author/ana-pop/']);
    expect(listTrail('Home', posts!, 'Blog', '/blog/page/2/').map((c) => c.href)).toEqual(['/', '/blog/']);
  });
});

describe('the built site', async () => {
  const files = await build();
  const sitemap = text(files, 'sitemap.xml');

  test('a dated type has a page for each person who wrote in it, with who they are', () => {
    const page = text(files, 'blog/author/ana-pop/index.html');
    expect(page).toContain('<h1>Ana Pop</h1>');
    expect(page).toContain('Ana restores old doors.');
    expect(page).toContain(`<img class="author-picture" src="/media/${PIC}"`);
    expect(page).toContain('href="/blog/oak/"');
    expect(page).toContain('href="/blog/pine/"');
    expect(page).not.toContain('href="/blog/ash/"');
    expect(page).toContain('"@type":"ProfilePage"');
    expect(page).toContain(`"mainEntity":{"@type":"Person","name":"Ana Pop","description":"Ana restores old doors.","image":"https://example.com/media/${PIC}"}`);
    expect(page).toContain('<meta property="og:type" content="profile">');
    expect(page).not.toContain('noindex');
    expect(sitemap).toContain('<loc>https://example.com/blog/author/ana-pop/</loc>');
    expect(text(files, 'blog/author/ion/index.html')).toContain('href="/blog/ash/"');
    expect(text(files, 'news/author/ana-pop/index.html')).toContain('href="/news/opening/"');
    // Her picture is published with the site.
    expect(files.get(`media/${PIC}`)).toBe(PICTURE);
  });

  test('a post names its author with a link to that page, and shows her picture at its end', () => {
    const oak = text(files, 'blog/oak/index.html');
    expect(oak).toContain('<a href="/blog/author/ana-pop/" rel="author">Ana Pop</a>');
    expect(oak).toContain(`class="author-picture" src="/media/${PIC}"`);
  });

  test('a dated type has its years, months and days, kept out of search engines', () => {
    const month = text(files, 'blog/2026/11/index.html');
    expect(month).toContain('<h1>November 2026</h1>');
    expect(month).toContain('href="/blog/oak/"');
    expect(month).toContain('href="/blog/ash/"');
    expect(month).not.toContain('href="/blog/pine/"');
    expect(month).toContain('<meta name="robots" content="noindex">');
    expect(text(files, 'blog/2026/index.html')).toContain('<h1>2026</h1>');
    expect(text(files, 'blog/2025/02/10/index.html')).toContain('<h1>February 10, 2025</h1>');
    expect(text(files, 'news/2026/10/01/index.html')).toContain('href="/news/opening/"');
    expect(sitemap).not.toContain('/blog/2026/');
    // Breadcrumbs lead back to the type's list.
    expect(month).toContain('<li><a href="/blog/">Blog</a></li>');
  });

  test('a type without dates has none of it', () => {
    for (const path of files.keys()) expect(path.startsWith('team/author/') || /^team\/\d/.test(path)).toBe(false);
  });

  test('each person has one page across every dated type, newest first, in each language', () => {
    const page = text(files, 'author/ana-pop/index.html');
    const order = ['/blog/oak/', '/news/opening/', '/blog/pine/'].map((href) => page.indexOf(`<h2><a href="${href}"`));
    expect(order.every((at) => at > 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(page).not.toContain('/team/maria/');
    expect(page).toContain('<li><a href="/">Home</a></li>');
    expect(sitemap).toContain('<loc>https://example.com/author/ana-pop/</loc>');
    // In Romanian, only what is translated, in its words.
    const ro = text(files, 'ro/author/ana-pop/index.html');
    expect(ro).toContain('href="/ro/jurnal/stejar/"');
    expect(ro).not.toContain('pine');
    expect(files.has('ro/author/ion/index.html')).toBe(false);
  });

  test('in another language, each list holds only what is translated, with its months in that language', () => {
    const month = text(files, 'ro/jurnal/2026/11/index.html');
    expect(month).toContain('<h1>noiembrie 2026</h1>');
    expect(month).toContain('href="/ro/jurnal/stejar/"');
    expect(month).not.toContain('ash');
    expect(files.has('ro/jurnal/2025/index.html')).toBe(false);
    expect(text(files, 'ro/jurnal/author/ana-pop/index.html')).toContain('href="/ro/jurnal/stejar/"');
    expect(text(files, 'ro/jurnal/stejar/index.html')).toContain('href="/ro/jurnal/author/ana-pop/"');
  });

  test('an old address may lead to a period\'s list, which is not in the sitemap', async () => {
    const moved = await buildSite(site, theme, pages, () => PICTURE, published, [{ from: '/2026/11/', to: '/blog/2026/11/' }], {}, [], {}, {}, {}, bylines);
    expect(text(moved, '2026/11/index.html')).toContain('url=/blog/2026/11/');
  });
});

describe('the archive block', () => {
  const lists = { posts: { type: posts!, entries: published.posts }, team: { type: people!, entries: published.team } };
  const page = (content: Record<string, unknown>) => ({ slug: 'x', title: 'X', description: '', inMenu: false, blocks: [{ id: 'b_arch', type: 'archive' as const, content }] });

  test('lists a dated type\'s months with how many each holds, or its years', () => {
    const months = renderPage(site, theme, page({ title: 'Archive', source: 'posts', years: false }), [], lists);
    expect(months).toContain('<h2>Archive</h2>');
    expect(months).toContain('<li><a href="/blog/2026/11/">November 2026</a> (2)</li>');
    expect(months).toContain('<li><a href="/blog/2025/02/">February 2025</a> (1)</li>');
    const years = renderPage(site, theme, page({ title: '', source: 'posts', years: true }), [], lists);
    expect(years).toContain('<li><a href="/blog/2026/">2026</a> (2)</li>');
    expect(years).not.toContain('<h2>');
  });

  test('of a type without dates, or one the page has nothing of, shows nothing', () => {
    expect(renderPage(site, theme, page({ title: '', source: 'team', years: false }), [], lists)).not.toContain('archive-list');
    expect(renderPage(site, theme, page({ title: '', source: 'gone', years: false }), [], lists)).not.toContain('archive-list');
  });
});

const databases: [string, string][] = [['SQLite', join(dir, 'store.db')]];
if (process.env.THECMS_TEST_POSTGRES) databases.push(['Postgres', process.env.THECMS_TEST_POSTGRES]);
if (process.env.THECMS_TEST_MYSQL) databases.push(['MySQL', process.env.THECMS_TEST_MYSQL]);
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='), (c) => c.charCodeAt(0));

for (const [name, address] of databases) {
  describe(`people's pages on ${name}`, () => {
    const open = async (): Promise<Store> => {
      const old = await Store.open(address);
      for (const table of ['users', 'sessions', 'links', 'entries', 'entry_authors', 'entry_reviews', 'user_bios', 'user_pictures', 'meta', 'media']) await old.rawForTests(`DROP TABLE IF EXISTS ${table}`);
      await old.close();
      return Store.open(address);
    };

    test('a picture is an image of the library, shown on the byline; it goes with the person', async () => {
      const store = await open();
      try {
        const image = await store.addMedia(PNG, 'Ana');
        const ana = await store.addUser({ email: 'ana@example.com', name: 'Ana Pop', role: 'author' });
        await expect(store.setProfile(ana.id, 'Ana Pop', '', 'https://elsewhere.example/a.png')).rejects.toThrow('an image from the media library');
        expect((await store.setProfile(ana.id, 'Ana Pop', 'Doors.', image.path)).picture).toBe(image.path);
        // Left out, it stays; empty, it goes.
        expect((await store.setProfile(ana.id, 'Ana Pop', 'Doors.')).picture).toBe(image.path);
        await store.saveEntry('posts', { slug: 'oak', title: 'Oak' }, ana.id);
        expect(await store.bylines()).toEqual({ 'posts/oak': { name: 'Ana Pop', bio: 'Doors.', slug: 'ana-pop', picture: { src: image.path, alt: 'Ana Pop' } } });
        expect((await store.setProfile(ana.id, 'Ana Pop', 'Doors.', '')).picture).toBe('');
        await store.setProfile(ana.id, 'Ana Pop', 'Doors.', image.path);
        const owner = await store.addUser({ email: 'o@example.com', role: 'owner', password: 'a long enough password' });
        await store.removeUser(ana.id, owner.id);
        expect(await store.bylines()).toEqual({});
      } finally {
        await store.close();
      }
    });

    test('a new name leads the old pages to the new ones; taking a name back drops the way away from it', async () => {
      const store = await open();
      try {
        await store.setSite({ ...(await store.site()), languages: ['ro'] });
        const ana = await store.addUser({ email: 'ana@example.com', name: 'Ana Pop', role: 'author' });
        await store.setProfile(ana.id, 'Ana Ionescu', '');
        const redirects = await store.redirects();
        expect(redirects).toContainEqual({ from: '/author/ana-pop/', to: '/author/ana-ionescu/' });
        expect(redirects).toContainEqual({ from: '/ro/author/ana-pop/', to: '/ro/author/ana-ionescu/' });
        expect(redirects).toContainEqual({ from: '/blog/author/ana-pop/', to: '/blog/author/ana-ionescu/' });
        expect(redirects).toContainEqual({ from: '/ro/blog/author/ana-pop/', to: '/ro/blog/author/ana-ionescu/' });
        // Setting the same name again changes nothing.
        await store.setProfile(ana.id, 'Ana Ionescu', 'A few words');
        expect((await store.redirects()).length).toBe(redirects.length);
        await store.setProfile(ana.id, 'Ana Pop', '');
        const back = await store.redirects();
        expect(back).toContainEqual({ from: '/author/ana-ionescu/', to: '/author/ana-pop/' });
        expect(back.some((r) => r.from === '/author/ana-pop/')).toBe(false);
      } finally {
        await store.close();
      }
    });

    test('a dated entry may not take an address its archives use, nor may its translation', async () => {
      const store = await open();
      try {
        await expect(store.saveEntry('posts', { slug: '2026', title: 'Plans' })).rejects.toThrow('only digits');
        await expect(store.saveEntry('posts', { slug: 'plans', title: 'Plans', translations: { ro: { slug: 'author', title: 'Planuri' } } })).rejects.toThrow('authors');
      } finally {
        await store.close();
      }
    });
  });
}

describe('a WordPress import', () => {
  const WXR = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:wp="http://wordpress.org/export/1.2/" xmlns:excerpt="http://wordpress.org/export/1.2/excerpt/">
<channel>
  <title>Atelier</title><link>https://old.example</link><language>en</language>
  <wp:wxr_version>1.2</wp:wxr_version><wp:base_site_url>https://old.example</wp:base_site_url>
  <wp:author><wp:author_id>1</wp:author_id><wp:author_login><![CDATA[ana]]></wp:author_login><wp:author_email><![CDATA[ana@example.com]]></wp:author_email><wp:author_display_name><![CDATA[Ana Pop]]></wp:author_display_name></wp:author>
  <wp:author><wp:author_id>2</wp:author_id><wp:author_login><![CDATA[ion.v]]></wp:author_login><wp:author_email><![CDATA[]]></wp:author_email><wp:author_display_name><![CDATA[]]></wp:author_display_name><wp:author_first_name><![CDATA[Ion]]></wp:author_first_name><wp:author_last_name><![CDATA[Vasile]]></wp:author_last_name></wp:author>
  <wp:author><wp:author_id>3</wp:author_id><wp:author_login><![CDATA[nobody]]></wp:author_login><wp:author_email><![CDATA[n@example.com]]></wp:author_email></wp:author>
  <item><title>Oak</title><link>https://old.example/oak/</link><dc:creator><![CDATA[ana]]></dc:creator><content:encoded><![CDATA[<p>See <a href="https://old.example/2024/01/">January</a>.</p>]]></content:encoded><wp:post_id>10</wp:post_id><wp:post_date>2024-01-15 10:00:00</wp:post_date><wp:post_name>oak</wp:post_name><wp:status>publish</wp:status><wp:post_type>post</wp:post_type></item>
  <item><title>The year</title><link>https://old.example/2023/</link><dc:creator><![CDATA[ion.v]]></dc:creator><content:encoded><![CDATA[<p>Hi</p>]]></content:encoded><wp:post_id>11</wp:post_id><wp:post_date>2023-05-01 10:00:00</wp:post_date><wp:post_name>2023</wp:post_name><wp:status>publish</wp:status><wp:post_type>post</wp:post_type></item>
</channel></rss>`;

  test('plans the people who wrote what comes, and gives a dated entry an address its archives do not use', () => {
    const plan = planImport(WXR, '2026-11-21');
    expect(plan.authors).toEqual([
      { login: 'ana', email: 'ana@example.com', name: 'Ana Pop' },
      { login: 'ion.v', email: '', name: 'Ion Vasile' },
    ]);
    expect(plan.posts.map((p) => [p.slug, p.author])).toEqual([
      ['oak', 'ana'],
      ['post-2023', 'ion.v'],
    ]);
    // A link to an old month leads to the blog's.
    expect(JSON.stringify(plan.posts[0]?.blocks)).toContain('/blog/2024/01/');
    expect(plan.redirects).toContainEqual({ from: '/2024/01/15/', to: '/blog/2024/01/15/' });
  });

  test('brings them as people without access, signs their posts, and leads their old archives here', async () => {
    const store = await Store.open(join(dir, 'import.db'));
    try {
      const report = await runImport(store, planImport(WXR, '2026-11-21'), { fetchImage: async () => new Uint8Array(), fresh: true });
      expect(report.notes.join('\n')).toContain('2 people who wrote here were added under People, without access');
      const users = await store.users();
      expect(users.map((u) => [u.email, u.name, u.role, u.active])).toEqual([
        ['ana@example.com', 'Ana Pop', 'author', false],
        ['ion-v@authors.invalid', 'Ion Vasile', 'author', false],
      ]);
      expect(Object.fromEntries(Object.entries(await store.bylines()).map(([k, v]) => [k, v.slug]))).toEqual({ 'posts/oak': 'ana-pop', 'posts/post-2023': 'ion-vasile' });
      const redirects = await store.redirects();
      expect(redirects).toContainEqual({ from: '/author/ana/', to: '/author/ana-pop/' });
      expect(redirects).toContainEqual({ from: '/author/ion-v/', to: '/author/ion-vasile/' });
      // A second import finds them by their address and adds nobody.
      const again = await runImport(store, planImport(WXR, '2026-11-21'), { fetchImage: async () => new Uint8Array(), fresh: false });
      expect(again.notes.join('\n')).not.toContain('added under People');
      expect((await store.users()).length).toBe(2);
    } finally {
      await store.close();
    }
  });
});
