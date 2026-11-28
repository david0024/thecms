import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEMO_PAGES, DEMO_SITE } from '../src/site/demo.ts';
import { type EditorServer, startEditor } from '../src/site/server.ts';
import { Store } from '../src/site/store.ts';
import plain from '../themes/plain.json';

let dir: string;
let store: Store;
let editor: EditorServer;
const HOST = '127.0.0.1:4321';

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'uhlaka-'));
  store = await Store.open(join(dir, 'site.db'));
  await store.setSite(DEMO_SITE);
  await store.setTheme(plain);
  await store.publishTheme();
  for (const page of DEMO_PAGES) await store.publish((await store.savePage(page)).slug);
  editor = await startEditor(store, { listen: false });
});
afterAll(async () => {
  await store.close();
  await rm(dir, { recursive: true, force: true });
});

const call = (path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<Response> =>
  editor.fetch(
    new Request(`http://${HOST}${path}`, {
      method: init.method ?? 'GET',
      headers: { host: HOST, 'x-uhlaka-token': editor.token, ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers },
      body: init.body ? JSON.stringify(init.body) : undefined,
    }),
  );

describe('who may call the editing API', () => {
  test('no token, a wrong token, or a token of another length: refused', async () => {
    // The last character is changed to one it is not: a token ending in 0 would otherwise be left as it is.
    const off = `${editor.token.slice(0, -1)}${editor.token.endsWith('0') ? '1' : '0'}`;
    for (const token of ['', 'x', off, `${editor.token}0`]) {
      const response = await call('/api/state', { headers: { 'x-uhlaka-token': token } });
      expect(response.status).toBe(401);
    }
    expect((await call('/api/state')).status).toBe(200);
  });

  test('a request that names another host is refused, even with the token (DNS rebinding)', async () => {
    const response = await call('/api/state', { headers: { host: 'evil.example:4321' } });
    expect(response.status).toBe(403);
    expect((await call('/admin/', { headers: { host: 'evil.example' } })).status).toBe(403);
  });

  test('a request from another origin is refused, even with the token', async () => {
    expect((await call('/api/state', { headers: { origin: 'https://evil.example' } })).status).toBe(403);
    expect((await call('/api/state', { headers: { origin: `http://${HOST}` } })).status).toBe(200);
  });

  test('a write without the token changes nothing', async () => {
    const before = JSON.stringify(await store.pages());
    const response = await call('/api/page?slug=about', { method: 'DELETE', headers: { 'x-uhlaka-token': '' } });
    expect(response.status).toBe(401);
    expect(JSON.stringify(await store.pages())).toBe(before);
  });

  test('pages are served with a policy that runs no script but the editor’s own', async () => {
    const response = await call('/admin/');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(response.headers.get('content-security-policy')).not.toContain("script-src");
    expect(await response.text()).not.toContain(editor.token);
  });
});

describe('the editing API', () => {
  test('the admin and the canvas script are built', async () => {
    for (const path of ['/admin/app.js', '/admin/frame.js']) {
      const response = await call(path);
      expect(response.headers.get('content-type')).toContain('text/javascript');
      expect((await response.text()).length).toBeGreaterThan(1000);
    }
  });

  test('the admin names its icon, the logo drawn for 16 px, served by the program (ADR 0080 d4)', async () => {
    expect(await (await call('/admin/')).text()).toContain('<link rel="icon" href="/admin/icon.svg" type="image/svg+xml">');
    const response = await call('/admin/icon.svg');
    expect(response.headers.get('content-type')).toContain('image/svg+xml');
    expect(await response.text()).toStartWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">');
  });

  test('render draws what would be saved, cleaned, with editor marks', async () => {
    const response = await call('/api/render', {
      method: 'POST',
      body: {
        page: {
          slug: '',
          title: 'Home',
          blocks: [
            { id: 'h', type: 'hero', content: { title: '<img src=x onerror=alert(1)>' }, style: { color: { value: 'red;}' }, background: { token: 'primary' } } },
            { type: 'carousel' },
          ],
        },
      },
    });
    const { body, css } = (await response.json()) as { body: string; css: string };
    expect(body).toContain('data-edit="title"');
    expect(body).toContain('&lt;img src=x onerror=alert(1)>');
    expect(body).not.toContain('<img');
    expect(body).not.toContain('carousel');
    expect(css).toBe('[data-b="h"][data-b][data-b]{background-color:var(--t-color-primary)}\n');
  });

  test('saving a draft leaves the published page alone until it is published', async () => {
    const draft = { slug: 'about', title: 'About us', blocks: [{ type: 'text', content: { body: [{ type: 'paragraph', children: [{ text: 'New words' }] }] } }] };
    const saved = (await (await call('/api/page', { method: 'PUT', body: { page: draft } })).json()) as { pages: { slug: string; changed: boolean }[] };
    expect(saved.pages.find((p) => p.slug === 'about')!.changed).toBe(true);
    expect((await store.published()).find((p) => p.slug === 'about')!.title).toBe('About');
    await call('/api/publish', { method: 'POST', body: { slug: 'about' } });
    expect((await store.published()).find((p) => p.slug === 'about')!.title).toBe('About us');
  });

  test('a new page cannot replace an existing one, and the home page cannot be deleted', async () => {
    const clash = await call('/api/page', { method: 'PUT', body: { page: { slug: 'contact', title: 'Contact' }, create: true } });
    expect(clash.status).toBe(409);
    expect((await store.draft('contact'))!.blocks.length).toBeGreaterThan(0);
    expect((await call('/api/page?slug=', { method: 'DELETE' })).status).toBe(400);
    expect(await store.draft('')).not.toBeNull();
  });

  test('an invalid theme is refused with the reason, and the theme stays', async () => {
    const response = await call('/api/theme', { method: 'PUT', body: { theme: { ...plain, name: '' } } });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toContain('name');
    expect((await store.theme())!.name).toBe('Plain');
  });
});

describe('what was published before', () => {
  test('is listed, and one is given back cleaned, for a page and for an entry', async () => {
    const listed = (await (await call('/api/versions?slug=about')).json()) as { versions: { at: string; title: string }[] };
    expect(listed.versions.length).toBeGreaterThan(0);
    const at = listed.versions[0]?.at ?? '';
    const one = (await (await call(`/api/version?slug=about&at=${encodeURIComponent(at)}`)).json()) as { page: { slug: string; blocks: unknown[] } };
    expect(one.page.slug).toBe('about');
    expect(Array.isArray(one.page.blocks)).toBe(true);
    expect((await call('/api/version?slug=about&at=never')).status).toBe(404);
    await call('/api/page', { method: 'PUT', body: { kind: 'post', page: { slug: 'kept', title: 'Kept', date: '2026-01-01' } } });
    await call('/api/publish', { method: 'POST', body: { kind: 'post', slug: 'kept' } });
    const entry = (await (await call('/api/versions?kind=post&slug=kept')).json()) as { versions: { at: string; title: string }[] };
    expect(entry.versions.map((v) => v.title)).toEqual(['Kept']);
    const back = (await (await call(`/api/version?kind=post&slug=kept&at=${encodeURIComponent(entry.versions[0]?.at ?? '')}`)).json()) as { page: { title: string; date: string } };
    expect(back.page).toMatchObject({ title: 'Kept', date: '2026-01-01' });
  });
});

describe('the check before publishing', () => {
  test('reads the published site as an export would, and says when there is none', async () => {
    const { check } = (await (await call('/api/check')).json()) as { check: { broken: unknown[]; unnamed: unknown[] } };
    expect(check.broken).toEqual([]);
    expect(Array.isArray(check.unnamed)).toBe(true);
    const home = await store.draft('');
    await store.rawForTests('UPDATE pages SET published = NULL WHERE slug = ?', ['']);
    const refused = await call('/api/check');
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: string }).error).toBe('the home page is not published');
    await store.savePage(home);
    await store.publish('');
  });
});

describe('the admin and search engines', () => {
  test('the admin, the preview and the API say noindex, whatever they answer', async () => {
    for (const path of ['/admin', '/admin/', '/admin/app.js', '/admin/nothing', '/preview', '/api/state']) {
      expect((await call(path)).headers.get('x-robots-tag')).toBe('noindex, nofollow');
    }
    // Refused calls too: a page that only says "sign in first" is not for an index either.
    expect((await call('/api/state', { headers: { 'x-uhlaka-token': 'x' } })).headers.get('x-robots-tag')).toBe('noindex, nofollow');
  });

  test("the site's own pages are left open", async () => {
    const response = await call('/');
    expect(response.status).toBe(200);
    expect(response.headers.get('x-robots-tag')).toBeNull();
  });
});
