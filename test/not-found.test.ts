/**
 * The addresses visitors ask for that the site does not have, and IndexNow
 * (ADR 0063).
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeTypes } from '../src/core/index.ts';
import { publishedSite } from '../src/site/export.ts';
import { indexNow, INDEXNOW_ENDPOINT, isIndexNowKey, sitemapUrls } from '../src/site/indexnow.ts';
import { FRESH_MS, startRuntime } from '../src/site/runtime.ts';
import { startEditor } from '../src/site/server.ts';
import { NOT_FOUND_KEPT, Store } from '../src/site/store.ts';
import plain from '../themes/plain.json';

const dir = await mkdtemp(join(tmpdir(), 'thecms-not-found-'));
afterAll(() => rm(dir, { recursive: true, force: true }));

/** A site with a home page and an about page, published. */
async function site(name: string, settings: Record<string, unknown> = {}): Promise<Store> {
  const store = await Store.open(join(dir, `${name}.db`));
  await store.setTheme(plain);
  await store.publishTheme();
  await store.setSite({ name: 'Atelier', url: 'https://example.com', ...settings });
  await store.savePage({ slug: '', title: 'Home', blocks: [] });
  await store.publish('');
  await store.savePage({ slug: 'about', title: 'About', blocks: [] });
  await store.publish('about');
  return store;
}

describe('addresses not found (ADR 0063 d1)', () => {
  test('each is counted, with when and where from, the most asked for first', async () => {
    const store = await Store.open(join(dir, 'count.db'));
    try {
      await store.addNotFound('/old-page/', 'example.org/links/', new Date('2026-11-20T10:00:00Z'));
      await store.addNotFound('/gone/', '', new Date('2026-11-21T10:00:00Z'));
      await store.addNotFound('/old-page/', '', new Date('2026-11-22T10:00:00Z'));
      expect(await store.notFound()).toEqual([
        // A visit from nowhere keeps the last page that led there.
        { path: '/old-page/', hits: 2, lastAt: '2026-11-22T10:00:00.000Z', referrer: 'example.org/links/' },
        { path: '/gone/', hits: 1, lastAt: '2026-11-21T10:00:00.000Z', referrer: '' },
      ]);
      await store.forgetNotFound('/gone/');
      expect((await store.notFound()).map((n) => n.path)).toEqual(['/old-page/']);
      // A redirect from an address takes it off the list.
      await store.setRedirects([{ from: '/old-page/', to: '/' }]);
      expect(await store.notFound()).toEqual([]);
      await store.addNotFound('/a/', '');
      await store.forgetNotFound(null);
      expect(await store.notFound()).toEqual([]);
    } finally {
      await store.close();
    }
  });

  test(`no more than ${NOT_FOUND_KEPT} are kept: the oldest go first`, async () => {
    const store = await Store.open(join(dir, 'kept.db'));
    try {
      for (let i = 0; i <= NOT_FOUND_KEPT; i++) await store.addNotFound(`/p${i}/`, '', new Date(Date.UTC(2026, 0, 1, 0, 0, i)));
      const kept = await store.notFound();
      expect(kept.length).toBe(NOT_FOUND_KEPT);
      expect(kept.some((n) => n.path === '/p0/')).toBe(false);
    } finally {
      await store.close();
    }
  });

  test('the runtime notes what it does not have, and not what robots look for', async () => {
    const store = await site('runtime');
    let clock = FRESH_MS;
    const runtime = startRuntime(store, { listen: false, log: () => {}, now: () => (clock += FRESH_MS) });
    const get = (path: string, init: RequestInit = {}) => runtime.fetch(new Request(`http://site.local${path}`, init), '10.0.0.1');
    try {
      expect((await get('/about/')).status).toBe(200);
      expect((await get('/missing/', { headers: { referer: 'https://other.example/page?x=1' } })).status).toBe(404);
      for (const probe of ['/wp-login.php', '/.env', '/.git/config', '/xmlrpc.php', '/admin.php', '/config.yml']) expect((await get(probe)).status).toBe(404);
      await get('/missing/', { method: 'HEAD' });
      await Bun.sleep(20);
      expect(await store.notFound()).toMatchObject([{ path: '/missing/', hits: 1, referrer: 'other.example/page' }]);
    } finally {
      runtime.stop();
      await store.close();
    }
  });

  test('the owner reads and forgets them in the admin', async () => {
    const store = await site('admin');
    const editor = await startEditor(store, { listen: false, log: () => {} });
    const call = (method: string, path: string) => editor.fetch(new Request(`http://127.0.0.1:4321${path}`, { method, headers: { host: '127.0.0.1:4321', 'x-thecms-token': editor.token } }));
    try {
      await store.addNotFound('/a/', '');
      await store.addNotFound('/b c/', '');
      expect(((await (await call('GET', '/api/not-found')).json()) as { notFound: unknown[] }).notFound).toHaveLength(2);
      const one = (await (await call('DELETE', `/api/not-found?path=${encodeURIComponent('/b c/')}`)).json()) as { notFound: { path: string }[] };
      expect(one.notFound.map((n) => n.path)).toEqual(['/a/']);
      expect(((await (await call('DELETE', '/api/not-found')).json()) as { notFound: unknown[] }).notFound).toEqual([]);
    } finally {
      editor.stop();
      await store.close();
    }
  });
});

describe('IndexNow (ADR 0063 d2)', () => {
  test('a key is made once, of the kind IndexNow takes', async () => {
    const store = await Store.open(join(dir, 'key.db'));
    try {
      const key = await store.indexNowKey();
      expect(isIndexNowKey(key)).toBe(true);
      expect(await store.indexNowKey()).toBe(key);
      expect(isIndexNowKey('short')).toBe(false);
    } finally {
      await store.close();
    }
  });

  test('the sitemap is read as it is written', () => {
    expect([...sitemapUrls('<url><loc>https://e.com/a/?x=1&amp;y=2</loc></url><url><loc>https://e.com/</loc></url>')]).toEqual(['https://e.com/a/?x=1&y=2', 'https://e.com/']);
  });

  test('the runtime proves the key only while the owner asks for IndexNow', async () => {
    const store = await site('prove');
    const runtime = startRuntime(store, { listen: false, log: () => {} });
    const key = await store.indexNowKey();
    try {
      expect((await runtime.fetch(new Request(`http://site.local/${key}.txt`), '')).status).toBe(404);
      await store.setSite({ ...(await store.site()), indexNow: true });
      const proof = await runtime.fetch(new Request(`http://site.local/${key}.txt`), '');
      expect(proof.status).toBe(200);
      expect(await proof.text()).toBe(key);
      expect((await runtime.fetch(new Request('http://site.local/0123456789abcdef.txt'), '')).status).toBe(404);
    } finally {
      runtime.stop();
      await store.close();
    }
  });

  test('what is published is told, once, when it is in the sitemap', async () => {
    const store = await site('tell', {
      indexNow: true,
      types: normalizeTypes([{ name: 'Events', fields: [] }]),
    });
    const sent: { url: string; body: Record<string, unknown> }[] = [];
    const claimed = new Set<string>();
    const told = indexNow(store, {
      files: () => publishedSite(store),
      claim: async (key) => !claimed.has(key) && !!claimed.add(key),
      fetch: async (url, init) => {
        sent.push({ url, body: JSON.parse(String(init.body)) });
        return new Response(null, { status: 202 });
      },
      delayMs: 60_000,
      log: () => {},
    });
    try {
      const type = (await store.site()).types[0]?.id as string;
      await store.savePage({ slug: 'about', title: 'About us', blocks: [] });
      await store.publish('about');
      await store.savePage({ slug: 'hidden', title: 'Hidden', noindex: true, blocks: [] });
      await store.publish('hidden');
      await store.saveEntry(type, { slug: 'fair', title: 'Fair', blocks: [] });
      await store.publishEntry(type, 'fair');
      await told.flush();
      const key = await store.indexNowKey();
      expect(sent).toEqual([
        {
          url: INDEXNOW_ENDPOINT,
          body: { host: 'example.com', key, keyLocation: `https://example.com/${key}.txt`, urlList: ['https://example.com/about/', 'https://example.com/events/fair/'] },
        },
      ]);
      // Said once, even when another process heard it too.
      await store.publish('about');
      await told.flush();
      expect(sent).toHaveLength(1);
      // Without the owner's ask, nothing is said.
      await store.setSite({ ...(await store.site()), indexNow: undefined });
      await store.savePage({ slug: 'new', title: 'New', blocks: [] });
      await store.publish('new');
      await told.flush();
      expect(sent).toHaveLength(1);
    } finally {
      told.stop();
      await store.close();
    }
  });
});
