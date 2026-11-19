/**
 * The store on every database it supports (ADR 0013). SQLite always runs; a
 * server runs when its address is given:
 *
 *   THECMS_TEST_POSTGRES=postgres://user:pw@127.0.0.1:5432/thecms
 *   THECMS_TEST_MYSQL=mysql://user:pw@127.0.0.1:3306/thecms
 *
 * CI gives both. Each run empties the tables it uses, so give it a database
 * of its own.
 */
import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runImport } from '../src/import/run.ts';
import { planImport } from '../src/import/wxr.ts';
import { exportSite } from '../src/site/export.ts';
import { databaseKind, shownAddress, Store } from '../src/site/store.ts';
import plain from '../themes/plain.json';

const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='), (c) => c.charCodeAt(0));
const WXR = await Bun.file(new URL('./fixtures/wordpress.xml', import.meta.url)).text();

const dir = await mkdtemp(join(tmpdir(), 'thecms-db-'));
afterAll(() => rm(dir, { recursive: true, force: true }));

const databases: [string, string][] = [['SQLite', join(dir, 'site.db')]];
if (process.env.THECMS_TEST_POSTGRES) databases.push(['Postgres', process.env.THECMS_TEST_POSTGRES]);
if (process.env.THECMS_TEST_MYSQL) databases.push(['MySQL', process.env.THECMS_TEST_MYSQL]);

test('an address says which database it is, and its password is never shown', () => {
  expect(databaseKind('site.db')).toBe('sqlite');
  expect(databaseKind('/var/sites/a.db')).toBe('sqlite');
  expect(databaseKind('postgres://u:p@h/db')).toBe('postgres');
  expect(databaseKind('postgresql://u:p@h/db')).toBe('postgres');
  expect(databaseKind('mysql://u:p@h/db')).toBe('mysql');
  expect(databaseKind('mariadb://u:p@h/db')).toBe('mysql');
  expect(shownAddress('postgres://editor:s3cret@db.example:5432/site')).toBe('postgres://editor:***@db.example:5432/site');
  expect(shownAddress('site.db')).toBe('site.db');
});

for (const [name, address] of databases) {
  describe(`the store on ${name}`, () => {
    let store: Store;

    beforeEach(async () => {
      const old = await Store.open(address);
      for (const table of ['meta', 'pages', 'entries', 'media']) await old.rawForTests(`DROP TABLE IF EXISTS ${table}`);
      await old.close();
      store = await Store.open(address);
      await store.setTheme(plain);
      await store.publishTheme();
    });

    test('settings, theme and redirects are kept, and saving twice replaces', async () => {
      expect(await store.isEmpty()).toBe(true);
      await store.setSite({ name: 'Atelier Nord', language: 'ro' });
      expect(await store.isEmpty()).toBe(false);
      await store.setSite({ name: 'Atelier Sud ăîșțâ 🌲', language: 'ro' });
      expect((await store.site()).name).toBe('Atelier Sud ăîșțâ 🌲');
      expect((await store.theme())?.name).toBe('Plain');
      expect(await store.themeChanged()).toBe(false);
      await store.setRedirects([{ from: '/old/', to: '/' }]);
      expect(await store.redirects()).toEqual([{ from: '/old/', to: '/' }]);
    });

    test('pages: a draft, then a copy for visitors; publishing twice is not an error', async () => {
      await store.savePage({ slug: '', title: 'Home', blocks: [] });
      await store.savePage({ slug: 'about', title: 'About', blocks: [] });
      await store.savePage({ slug: 'about', title: 'About us', blocks: [] });
      expect((await store.pages()).map((p) => [p.slug, p.title, p.published])).toEqual([
        ['', 'Home', false],
        ['about', 'About us', false],
      ]);
      await store.publish('about');
      // MySQL counts a row whose values did not change as untouched; that is still a page.
      await store.publish('about');
      await expect(store.publish('nowhere')).rejects.toThrow('no page');
      expect((await store.published()).map((p) => p.title)).toEqual(['About us']);
      await store.savePage({ slug: 'about', title: 'About them', blocks: [] });
      expect((await store.pages())[1]).toMatchObject({ published: true, changed: true });
      expect((await store.published())[0]?.title).toBe('About us');
      await store.deletePage('about');
      expect(await store.draft('about')).toBeNull();
    });

    test('a long page is kept whole', async () => {
      // Past what a MySQL TEXT column holds (64 KB), in letters that take two bytes.
      const paragraph = { type: 'paragraph', children: [{ text: 'Lemn de stejar, tăiat și uscat încet, apoi șlefuit de mână. '.repeat(30) }] };
      const saved = await store.savePage({ slug: 'long', title: 'Long', blocks: Array.from({ length: 60 }, () => ({ type: 'text', content: { body: [paragraph] } })) });
      expect(new TextEncoder().encode(JSON.stringify(saved)).length).toBeGreaterThan(100_000);
      expect(await store.draft('long')).toEqual(saved);
    });

    test('entries of each type, and a type that still has entries is not removed', async () => {
      await store.setSite({ name: 'S', types: [{ id: 'projects', name: 'Projects', singular: 'Project', path: 'projects' }] });
      await store.savePost({ slug: 'b', title: 'B', date: '2026-02-01', blocks: [] });
      await store.savePost({ slug: 'a', title: 'A', date: '2026-03-01', blocks: [] });
      await store.saveEntry('projects', { slug: 'oak', title: 'Oak', blocks: [] });
      await store.publishPost('a');
      await store.publishPost('a');
      expect((await store.posts()).map((p) => p.slug)).toEqual(['a', 'b']);
      expect((await store.publishedPosts()).map((p) => p.slug)).toEqual(['a']);
      expect((await store.draftEntries('projects')).map((p) => p.title)).toEqual(['Oak']);
      await expect(store.setSite({ name: 'S', types: [] })).rejects.toThrow('"Projects" still has 1 entry');
      await store.deleteEntry('projects', 'oak');
      await store.setSite({ name: 'S', types: [] });
      expect((await store.site()).types).toEqual([]);
    });

    test('an image comes back byte for byte, is stored once, and is not deleted while shown', async () => {
      const first = await store.addMedia(PNG, 'pixel.png');
      const again = await store.addMedia(PNG, 'again.png');
      expect(again.name).toBe(first.name);
      expect(await store.media()).toEqual([expect.objectContaining({ name: first.name, size: PNG.length, label: 'pixel.png' })]);
      const file = await store.mediaFile(first.name);
      expect(file?.bytes).toBeInstanceOf(Uint8Array);
      expect([...(file?.bytes ?? [])]).toEqual([...PNG]);
      await store.savePage({ slug: '', title: 'Home', blocks: [{ type: 'image', content: { image: { src: first.path, alt: '' } } }] });
      await expect(store.deleteMedia(first.name)).rejects.toThrow('used on: Home');
      await store.savePage({ slug: '', title: 'Home', blocks: [] });
      await store.deleteMedia(first.name);
      expect(await store.media()).toEqual([]);
    });

    test('a WordPress import and an export, end to end', async () => {
      const report = await runImport(store, planImport(WXR, '2026-11-19', { types: ['product'] }), { fetchImage: async () => PNG, fresh: true });
      expect(report).toMatchObject({ pages: 4, posts: 2, entries: 1, images: 2, menu: true });
      const files = await exportSite(store, join(dir, `out-${name}`));
      expect(files).toContain('blog/hello-world/index.html');
      expect(files).toContain('product/chair/index.html');
      expect(files.some((f) => f.startsWith('media/'))).toBe(true);
    });

    test('closing, then opening again, finds everything where it was', async () => {
      await store.setSite({ name: 'Kept' });
      await store.close();
      store = await Store.open(address);
      expect((await store.site()).name).toBe('Kept');
    });
  });
}
