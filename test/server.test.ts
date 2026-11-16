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
  dir = await mkdtemp(join(tmpdir(), 'thecms-'));
  store = new Store(join(dir, 'site.db'));
  store.setSite(DEMO_SITE);
  store.setTheme(plain);
  store.publishTheme();
  for (const page of DEMO_PAGES) store.publish(store.savePage(page).slug);
  editor = await startEditor(store, { listen: false });
});
afterAll(async () => {
  store.close();
  await rm(dir, { recursive: true, force: true });
});

const call = (path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<Response> =>
  editor.fetch(
    new Request(`http://${HOST}${path}`, {
      method: init.method ?? 'GET',
      headers: { host: HOST, 'x-thecms-token': editor.token, ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers },
      body: init.body ? JSON.stringify(init.body) : undefined,
    }),
  );

describe('who may call the editing API', () => {
  test('no token, a wrong token, or a token of another length: refused', async () => {
    for (const token of ['', 'x', `${editor.token.slice(0, -1)}0`, `${editor.token}0`]) {
      const response = await call('/api/state', { headers: { 'x-thecms-token': token } });
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
    const before = JSON.stringify(store.pages());
    const response = await call('/api/page?slug=about', { method: 'DELETE', headers: { 'x-thecms-token': '' } });
    expect(response.status).toBe(401);
    expect(JSON.stringify(store.pages())).toBe(before);
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
    expect(store.published().find((p) => p.slug === 'about')!.title).toBe('About');
    await call('/api/publish', { method: 'POST', body: { slug: 'about' } });
    expect(store.published().find((p) => p.slug === 'about')!.title).toBe('About us');
  });

  test('a new page cannot replace an existing one, and the home page cannot be deleted', async () => {
    const clash = await call('/api/page', { method: 'PUT', body: { page: { slug: 'contact', title: 'Contact' }, create: true } });
    expect(clash.status).toBe(409);
    expect(store.draft('contact')!.blocks.length).toBeGreaterThan(0);
    expect((await call('/api/page?slug=', { method: 'DELETE' })).status).toBe(400);
    expect(store.draft('')).not.toBeNull();
  });

  test('an invalid theme is refused with the reason, and the theme stays', async () => {
    const response = await call('/api/theme', { method: 'PUT', body: { theme: { ...plain, name: '' } } });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toContain('name');
    expect(store.theme()!.name).toBe('Plain');
  });
});
