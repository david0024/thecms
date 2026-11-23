/**
 * The site is served (ADR 0044): the editor serves the site at its own
 * address, as WordPress does; pages are built again only when what visitors
 * see has changed; an export says what a static host would lose.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBlock, formsAddress } from '../src/core/index.ts';
import { describeCheck, serverOnly } from '../src/site/check.ts';
import { exportSite, fullCheck, publishedSite } from '../src/site/export.ts';
import { FRESH_MS, startRuntime } from '../src/site/runtime.ts';
import { startEditor } from '../src/site/server.ts';
import { Store } from '../src/site/store.ts';
import plain from '../themes/plain.json';

const dir = await mkdtemp(join(tmpdir(), 'uhlaka-served-'));
afterAll(() => rm(dir, { recursive: true, force: true }));

async function site(name: string): Promise<Store> {
  const store = await Store.open(join(dir, `${name}.db`));
  await store.setTheme(plain);
  await store.publishTheme();
  await store.setSite({ name: 'Atelier', url: 'https://example.com' });
  await store.savePage({ slug: '', title: 'Home', blocks: [createBlock('search'), createBlock('form')] });
  await store.publish('');
  return store;
}

describe('the editor', () => {
  test('serves the site at its own address, and the admin beside it', async () => {
    const store = await site('editor');
    const editor = await startEditor(store, { listen: false });
    const get = (path: string, init: RequestInit = {}) => editor.fetch(new Request(`http://127.0.0.1:4321${path}`, { ...init, headers: { host: '127.0.0.1:4321', ...(init.headers ?? {}) } }));
    try {
      const home = await get('/');
      expect(home.status).toBe(200);
      const html = await home.text();
      expect(html).toContain('<title>Atelier</title>');
      expect(html).toContain('action="/_/send"');
      expect((await get('/_/search?q=home')).status).toBe(200);
      expect(await (await get('/assets/site.css')).text()).toContain('--t-color-primary');
      // The canvas's stylesheet is the theme as it is being built, at an address of the admin's.
      expect((await get('/admin/site.css')).headers.get('content-type')).toContain('text/css');
      expect((await get('/admin')).headers.get('location')).toBe('/admin/');
      expect((await get('/admin/')).status).toBe(200);
      expect((await get('/nowhere/')).status).toBe(404);
      // Another host is not this editor's, for the site as for the admin.
      expect((await editor.fetch(new Request('http://127.0.0.1:4321/', { headers: { host: 'evil.example' } }))).status).toBe(403);
    } finally {
      editor.stop();
      await store.close();
    }
  });
});

describe('the pages', () => {
  test('are built again only when what visitors see has changed', async () => {
    const store = await site('cache');
    let clock = 0;
    const runtime = startRuntime(store, { listen: false, log: () => {}, now: () => clock });
    const get = async (path: string) => runtime.fetch(new Request(`http://site.local${path}`));
    try {
      const before = await store.siteVersion();
      await store.savePage({ slug: 'about', title: 'About', blocks: [] });
      expect(await store.siteVersion()).toBe(before);
      expect((await get('/about/')).status).toBe(404);
      await store.publish('about');
      expect(await store.siteVersion()).not.toBe(before);
      // Asked again only after FRESH_MS: then the new page is there.
      expect((await get('/about/')).status).toBe(404);
      clock += FRESH_MS;
      expect((await get('/about/')).status).toBe(200);
      const version = await store.siteVersion();
      clock += FRESH_MS;
      expect((await get('/about/')).status).toBe(200);
      expect(await store.siteVersion()).toBe(version);
    } finally {
      runtime.stop();
      await store.close();
    }
  });
});

describe('forms, comments and search', () => {
  test('are answered by the site\'s own server unless a form service is set', () => {
    expect(formsAddress({ forms: '' })).toBe('/_');
    expect(formsAddress({ forms: 'https://forms.example.com' })).toBe('https://forms.example.com');
  });
});

describe('a static export', () => {
  test('says what only the site\'s own server does', async () => {
    const store = await site('export');
    try {
      await store.savePage({ slug: 'club', title: 'Club', blocks: [] });
      await store.publish('club');
      await store.lockPage('club', 'open sesame');
      const files = await publishedSite(store);
      expect(serverOnly(files)).toEqual(['forms', 'search', 'locked']);
      expect(serverOnly(files, { formsElsewhere: true, routes: true })).toEqual(['search', 'locked', 'extensions']);
      expect(serverOnly(new Map([['index.html', '<form action="/_/comment">']]))).toEqual(['comments']);
      expect((await fullCheck(store, files)).server).toEqual(['forms', 'search', 'locked']);
      expect(describeCheck({ broken: [], unnamed: [], server: ['forms', 'comments', 'search', 'locked', 'extensions'] }).warnings).toEqual([
        'on a static host, the contact forms have nowhere to send (set a form service in Site settings)',
        'on a static host, comments cannot be sent (set a form service in Site settings)',
        'on a static host, the search field finds nothing',
        'on a static host, the pages behind a password cannot be opened',
        'on a static host, the addresses extensions answer at, under /_/x/, do not exist',
      ]);
      const said: string[] = [];
      await exportSite(store, join(dir, 'out'), (line) => said.push(line));
      expect(said).toContain('on a static host, the search field finds nothing');
    } finally {
      await store.close();
    }
  });
});
