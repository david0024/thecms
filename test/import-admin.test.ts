import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { DEMO_PAGES, DEMO_SITE } from '../src/site/demo.ts';
import { IMPORT_MAX_BYTES, runImport } from '../src/import/run.ts';
import { planImport } from '../src/import/wxr.ts';
import { type EditorServer, type ImportPreview, type ImportProgress, startEditor } from '../src/site/server.ts';
import { Store } from '../src/site/store.ts';
import plain from '../themes/plain.json';

const WXR = await Bun.file(new URL('./fixtures/wordpress.xml', import.meta.url)).text();
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='), (c) => c.charCodeAt(0));
const HOST = '127.0.0.1:4321';

describe('an import from the admin (ADR 0012)', () => {
  let store: Store;
  let editor: EditorServer;
  /** Held until the test lets go, so a running import can be looked at. */
  let gate: Promise<void> = Promise.resolve();
  const fetched: string[] = [];

  beforeEach(async () => {
    store = await Store.open(':memory:');
    await store.setSite(DEMO_SITE);
    await store.setTheme(plain);
    await store.publishTheme();
    for (const page of DEMO_PAGES) await store.publish((await store.savePage(page)).slug);
    gate = Promise.resolve();
    fetched.length = 0;
    editor = await startEditor(store, {
      listen: false,
      fetchImage: async (url) => {
        fetched.push(url);
        await gate;
        return PNG;
      },
    });
  });
  afterEach(async () => await store.close());

  const call = (path: string, init: { method?: string; body?: string; headers?: Record<string, string> } = {}): Promise<Response> =>
    editor.fetch(new Request(`http://${HOST}${path}`, { method: init.method ?? 'GET', headers: { host: HOST, 'x-thecms-token': editor.token, ...init.headers }, body: init.body }));
  const finished = async (): Promise<ImportProgress> => {
    for (let i = 0; i < 200; i++) {
      const progress = (await (await call('/api/import')).json()) as ImportProgress;
      if (progress.status !== 'running') return progress;
      await Bun.sleep(5);
    }
    throw new Error('the import never finished');
  };

  test('the file is read and counted, and nothing is written', async () => {
    const before = JSON.stringify([await store.pages(), await store.posts(), await store.site(), await store.media(), await store.redirects()]);
    const response = await call('/api/import/plan', { method: 'POST', body: WXR });
    expect(response.status).toBe(200);
    const preview = (await response.json()) as ImportPreview;
    expect(preview).toMatchObject({ pages: 4, posts: 2, images: 2, redirects: 4, menu: true, types: [], others: [{ type: 'product', count: 1 }] });
    expect(preview.site.url).toStartWith('http');
    expect(preview.notes.length).toBeGreaterThan(0);
    expect(JSON.stringify([await store.pages(), await store.posts(), await store.site(), await store.media(), await store.redirects()])).toBe(before);
  });

  test('a kind the owner ticks moves from "other" to a content type', async () => {
    const preview = (await (await call('/api/import/plan?types=product', { method: 'POST', body: WXR })).json()) as ImportPreview;
    expect(preview.types).toEqual([{ id: 'product', name: 'Product', count: 1 }]);
    expect(preview.others).toEqual([]);
  });

  test('a file that is not an export is refused, in words, and so is one too large or sent without the token', async () => {
    const wrong = await call('/api/import/plan', { method: 'POST', body: '<html><body>hello</body></html>' });
    expect(wrong.status).toBe(400);
    expect(((await wrong.json()) as { error: string }).error).toContain('not a WordPress export');
    const run = await call('/api/import/run', { method: 'POST', body: 'not xml at all' });
    expect(run.status).toBe(400);
    expect(await finished()).toEqual({ status: 'idle' });
    expect((await call('/api/import/plan', { method: 'POST', body: WXR, headers: { 'content-length': String(IMPORT_MAX_BYTES + 1) } })).status).toBe(413);
    expect((await call('/api/import/run', { method: 'POST', body: WXR, headers: { 'x-thecms-token': 'no' } })).status).toBe(401);
    expect(await store.posts()).toHaveLength(0);
  });

  test('it runs after the request has answered, says how far it is, and refuses a second one meanwhile', async () => {
    let release = (): void => {};
    gate = new Promise((resolve) => (release = resolve));
    const started = await call('/api/import/run?types=product', { method: 'POST', body: WXR });
    expect(started.status).toBe(202);
    expect(await started.json()).toEqual({ status: 'running', done: 0, total: 2 });
    expect((await call('/api/import/run', { method: 'POST', body: WXR })).status).toBe(409);
    // Forgetting does not stop it.
    expect(await (await call('/api/import', { method: 'DELETE' })).json()).toMatchObject({ status: 'running' });
    release();
    const done = await finished();
    expect(done).toMatchObject({ status: 'done', report: { pages: 2, posts: 2, entries: 1, images: 2, menu: false } });
    expect(fetched).toHaveLength(2);
    // The site kept its own name, menu and home page; the content came beside them.
    expect((await store.site()).name).toBe(DEMO_SITE.name);
    expect((await store.draft(''))?.title).toBe(DEMO_PAGES.find((p) => p.slug === '')?.title as string);
    expect((await store.site()).types.map((t) => t.id)).toContain('product');
    expect(await store.publishedEntries('product')).toHaveLength(1);
    const state = (await (await call('/api/state')).json()) as { posts: unknown[]; entries: Record<string, unknown[]> };
    expect(state.posts).toHaveLength(2);
    expect(state.entries.product).toHaveLength(1);
    expect(await (await call('/api/import', { method: 'DELETE' })).json()).toEqual({ status: 'idle' });
  });

  test('images are left where they are when asked, and the settings come over when asked', async () => {
    await call('/api/import/run?images=0&settings=1', { method: 'POST', body: WXR });
    const done = await finished();
    expect(done).toMatchObject({ status: 'done', report: { images: 0, menu: true } });
    expect(fetched).toHaveLength(0);
    expect((await store.site()).name).not.toBe(DEMO_SITE.name);
    expect(await store.media()).toHaveLength(0);
  });
});

describe('a content type the site cannot take', () => {
  test('is left out with its entries and named; the rest still comes', async () => {
    const store = await Store.open(':memory:');
    await store.setTheme(plain);
    await store.savePage({ slug: 'product', title: 'Product', description: '', inMenu: true, blocks: [] });
    const report = await runImport(store, planImport(WXR, '2026-11-17', { types: ['product'] }), { fetchImage: null, fresh: false });
    expect(report.entries).toBe(0);
    expect(report.pages).toBeGreaterThan(0);
    expect(report.notes.join('\n')).toContain('The content type "Product" was not added');
    expect((await store.site()).types.map((t) => t.id)).toEqual(['posts']);
    await store.close();
  });
});
