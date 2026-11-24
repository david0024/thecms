/**
 * The site's runtime (ADR 0038): the published site and its forms from one
 * address. The pages are what the export writes; an old address answers with
 * a real 301; what a visitor sends goes under /_/.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Block, cleanFormsAddress, normalizeBlocks } from '../src/core/index.ts';
import { FRESH_MS, startRuntime } from '../src/site/runtime.ts';
import { Store } from '../src/site/store.ts';
import plain from '../themes/plain.json';

const dir = await mkdtemp(join(tmpdir(), 'uhlaka-runtime-'));
afterAll(() => rm(dir, { recursive: true, force: true }));

const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='), (c) => c.charCodeAt(0));

describe('the runtime', () => {
  test('serves the published site, its old addresses and its forms, from one address', async () => {
    const store = await Store.open(join(dir, 'site.db'));
    let clock = 0;
    const runtime = startRuntime(store, { listen: false, log: () => {}, now: () => clock });
    const get = (path: string, init: RequestInit = {}) => runtime.fetch(new Request(`http://site.local${path}`, init), '10.0.0.1');
    try {
      expect((await get('/')).status).toBe(404);
      expect(await (await get('/')).text()).toBe('nothing is published yet\n');

      await store.setTheme(plain);
      await store.publishTheme();
      const form = normalizeBlocks([{ type: 'form', content: { title: 'Write', consent: 'Keep it.', button: 'Send', sent: 'Sent', failed: 'No' } }]).blocks[0] as Block;
      await store.setSite({ name: 'Atelier', url: 'https://example.com', forms: '/_' });
      const image = await store.addMedia(PNG);
      await store.savePage({ slug: '', title: 'Home', blocks: [form, { id: 'b_i', type: 'image', content: { image: { src: image.path, alt: 'A pixel' }, caption: '' } }] });
      await store.publish('');
      await store.savePage({ slug: 'about', title: 'About', blocks: [] });
      await store.publish('about');
      await store.setRedirects([{ from: '/old/', to: '/about/' }]);

      // Built once, then again only when it is older than FRESH_MS.
      expect((await get('/')).status).toBe(404);
      clock += FRESH_MS;
      const home = await get('/');
      expect(home.status).toBe(200);
      expect(home.headers.get('content-type')).toBe('text/html; charset=utf-8');
      expect(home.headers.get('content-security-policy')).toContain("default-src 'none'");
      const html = await home.text();
      expect(html).toContain('action="/_/send"');
      expect((await get('/about/')).status).toBe(200);
      expect((await get('/about')).headers.get('location')).toBe('/about/');
      const moved = await get('/old/');
      expect([moved.status, moved.headers.get('location')]).toEqual([301, '/about/']);
      expect((await get('/assets/site.css')).headers.get('content-type')).toBe('text/css; charset=utf-8');
      // The switch of colours (ADR 0074 d4): its script, from the site itself, and nothing else may run.
      expect(home.headers.get('content-security-policy')).toContain("script-src 'self';");
      expect(html).toContain('<script src="/assets/scheme.js"></script>');
      expect((await get('/assets/scheme.js')).headers.get('content-type')).toBe('text/javascript; charset=utf-8');
      expect((await get(image.path)).headers.get('cache-control')).toContain('immutable');
      for (const hidden of ['/_redirects', '/.htaccess', '/x/%2e%2e%2fabout/', '/%E0%A4%A']) expect((await get(hidden)).status).toBe(404);
      const missing = await get('/nowhere/');
      expect(missing.status).toBe(404);
      expect(await missing.text()).toContain('<!doctype html>');
      expect((await get('/', { method: 'POST' })).status).toBe(405);

      // What cannot be static is under /_/.
      expect(await (await get('/_/')).text()).toBe('uhlaka runtime\n');
      expect((await get('/_/nothing')).status).toBe(404);
      const sent = await get('/_/send', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://example.com' },
        body: new URLSearchParams({ back: '/', form: form.id, name: 'Ana', email: 'ana@example.org', message: 'Hello', consent: 'yes', website: '' }).toString(),
      });
      expect([sent.status, sent.headers.get('location')]).toEqual([303, `https://example.com/#f-${form.id}-sent`]);
      expect((await store.messages()).map((m) => m.name)).toEqual(['Ana']);
    } finally {
      runtime.stop();
      await store.close();
    }
  });

  test('listens when asked, and the form service may be the site\'s own runtime', async () => {
    expect(cleanFormsAddress('/_')).toBe('/_');
    expect(cleanFormsAddress('/_/')).toBe('/_');
    const store = await Store.open(join(dir, 'listen.db'));
    const runtime = startRuntime(store, { port: 0, log: () => {} });
    try {
      expect(await (await fetch(`${runtime.url}/_/`)).text()).toBe('uhlaka runtime\n');
    } finally {
      runtime.stop();
      await store.close();
    }
  });
});
