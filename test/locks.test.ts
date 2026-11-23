/**
 * Pages behind a password (ADR 0043): the runtime asks for it, keeps a key in
 * the visitor's browser once it is given, and an export never holds the page.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBlock } from '../src/core/index.ts';
import { exportSite, publishedSite } from '../src/site/export.ts';
import { lockCookie } from '../src/site/locks.ts';
import { FRESH_MS, startRuntime } from '../src/site/runtime.ts';
import { startEditor } from '../src/site/server.ts';
import { Store } from '../src/site/store.ts';
import plain from '../themes/plain.json';

const dir = await mkdtemp(join(tmpdir(), 'uhlaka-locks-'));
afterAll(() => rm(dir, { recursive: true, force: true }));
const text = (body: string) => ({ id: `b_${Math.random().toString(36).slice(2, 10)}`, type: 'text', content: { body: [{ type: 'paragraph', children: [{ text: body }] }] } });

async function site(name: string): Promise<Store> {
  const store = await Store.open(join(dir, `${name}.db`));
  await store.setTheme(plain);
  await store.publishTheme();
  await store.setSite({ name: 'Atelier', url: 'https://example.com', forms: '/_' });
  await store.savePage({ slug: '', title: 'Home', blocks: [createBlock('search'), text('Welcome.')] });
  await store.publish('');
  await store.savePage({ slug: 'members', title: 'Members', blocks: [text('The secret recipe.')] });
  await store.publish('members');
  return store;
}

describe('a page behind a password', () => {
  test('keeps only the hash, and opens with its own password', async () => {
    const store = await site('store');
    try {
      await expect(store.lockPage('', 'secret')).rejects.toThrow('the home page is open to everyone');
      await expect(store.lockPage('nowhere', 'secret')).rejects.toThrow('no page "nowhere"');
      await expect(store.lockPage('members', 'abc')).rejects.toThrow('a password has 4 to 200 characters');
      expect(await store.lockPage('members', 'open sesame')).toEqual(['members']);
      expect(await store.unlockPage('members', 'wrong')).toBeNull();
      expect(await store.unlockPage('about', 'open sesame')).toBeNull();
      const key = await store.unlockPage('members', 'open sesame');
      expect(key).toBe(await store.pageKey('members'));
      // A new password shuts out whoever had the old one.
      await store.lockPage('members', 'another one');
      expect(await store.pageKey('members')).not.toBe(key);
      expect(await store.pageKey('home')).toBeNull();

      await store.movePage('members', 'club');
      expect(await store.lockedPages()).toEqual(['club']);
      expect(await store.lockPage('club', null)).toEqual([]);
      await store.lockPage('club', 'another one');
      await store.deletePage('club');
      expect(await store.lockedPages()).toEqual([]);
    } finally {
      await store.close();
    }
  });

  test('is marked for the runtime, left out of the sitemap, and not written by an export', async () => {
    const store = await site('export');
    try {
      await store.lockPage('members', 'open sesame');
      const files = await publishedSite(store);
      const html = String(files.get('members/index.html'));
      expect(html).toContain('<meta name="uhlaka-locked" content="members">');
      expect(html).toContain('<meta name="robots" content="noindex">');
      expect(String(files.get('sitemap.xml'))).not.toContain('/members/');

      const out = join(dir, 'out');
      await exportSite(store, out);
      const written = await readFile(join(out, 'members', 'index.html'), 'utf8');
      expect(written).toContain('This page is protected by a password and cannot be opened here.');
      expect(written).not.toContain('secret recipe');
      expect(written).not.toContain('<form');
    } finally {
      await store.close();
    }
  });
});

describe('on the runtime', () => {
  test('the page asks for its password, and opens with the key it gives', async () => {
    const store = await site('runtime');
    await store.lockPage('members', 'open sesame');
    const runtime = startRuntime(store, { listen: false, log: () => {} });
    const call = (path: string, init: RequestInit = {}, ip = '1.1.1.1') => runtime.fetch(new Request(`https://site.local${path}`, init), ip);
    const unlock = (password: string, ip?: string, back = '/members/') =>
      call('/_/unlock', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ back, password }).toString() }, ip);
    try {
      const asked = await call('/members/');
      expect(asked.status).toBe(403);
      expect(asked.headers.get('cache-control')).toBe('private, no-store');
      const form = await asked.text();
      expect(form).toContain('<title>This page is protected · Atelier</title>');
      expect(form).toContain('action="/_/unlock"');
      expect(form).toContain('<input type="hidden" name="back" value="/members/">');
      expect(form).not.toContain('secret recipe');

      const wrong = await unlock('nope');
      expect([wrong.status, wrong.headers.get('location'), wrong.headers.get('set-cookie')]).toEqual([303, '/members/#locked-wrong', null]);
      expect((await unlock('open sesame', '1.1.1.1', '/')).headers.get('location')).toBe('/#locked-wrong');
      expect((await unlock('open sesame', '1.1.1.1', '//evil.example')).headers.get('location')).toBe('/#locked-wrong');
      expect((await call('/_/unlock', { method: 'POST', headers: { 'content-length': '5000' } })).status).toBe(413);

      const right = await unlock('open sesame');
      expect([right.status, right.headers.get('location')]).toEqual([303, '/members/']);
      const cookie = String(right.headers.get('set-cookie'));
      expect(cookie).toStartWith(`${lockCookie('members')}=`);
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('Secure');
      const pair = cookie.split(';')[0] as string;
      const opened = await call('/members/', { headers: { cookie: `other=1; ${pair}` } });
      expect(opened.status).toBe(200);
      expect(opened.headers.get('cache-control')).toBe('private, no-store');
      expect(await opened.text()).toContain('The secret recipe.');
      expect((await call('/members/', { headers: { cookie: `${lockCookie('members')}=forged` } })).status).toBe(403);

      // Search does not find what is behind a password.
      expect(await (await call('/_/search?q=recipe')).text()).toContain('Nothing on this site matches');

      // Ten tries in ten minutes, then even the right one waits.
      for (let i = 0; i < 10; i++) await unlock('guess', '2.2.2.2');
      expect((await unlock('open sesame', '2.2.2.2')).headers.get('location')).toBe('/members/#locked-wrong');
    } finally {
      runtime.stop();
      await store.close();
    }
  });

  test('a new password closes the page to the old key, at the next build', async () => {
    const store = await site('rekey');
    await store.lockPage('members', 'open sesame');
    let clock = 0;
    const runtime = startRuntime(store, { listen: false, log: () => {}, now: () => clock });
    const call = (path: string, init: RequestInit = {}) => runtime.fetch(new Request(`http://site.local${path}`, init), '3.3.3.3');
    try {
      const right = await call('/_/unlock', { method: 'POST', body: new URLSearchParams({ back: '/members/', password: 'open sesame' }).toString() });
      const pair = String(right.headers.get('set-cookie')).split(';')[0] as string;
      expect(String(right.headers.get('set-cookie'))).not.toContain('Secure');
      expect((await call('/members/', { headers: { cookie: pair } })).status).toBe(200);
      await store.lockPage('members', 'a new one');
      expect((await call('/members/', { headers: { cookie: pair } })).status).toBe(403);
      await store.lockPage('members', null);
      clock += FRESH_MS;
      expect((await call('/members/')).status).toBe(200);
    } finally {
      runtime.stop();
      await store.close();
    }
  });
});

describe('the editor', () => {
  test('sets, lists and takes away a page\'s password', async () => {
    const store = await site('editor');
    const editor = await startEditor(store, { listen: false });
    const call = async (method: string, path: string, body?: unknown) => {
      const response = await editor.fetch(
        new Request(`http://127.0.0.1:4321${path}`, {
          method,
          headers: { host: '127.0.0.1:4321', 'x-uhlaka-token': editor.token, 'content-type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
      );
      return { status: response.status, data: (await response.json()) as Record<string, any> };
    };
    try {
      expect((await call('POST', '/api/locks', { slug: 'members', password: 'open sesame' })).data.locked).toEqual(['members']);
      expect((await call('GET', '/api/locks')).data.locked).toEqual(['members']);
      expect((await call('POST', '/api/locks', { slug: 'members', password: 'x' })).status).toBe(400);
      expect((await call('DELETE', '/api/locks?slug=members')).data.locked).toEqual([]);
    } finally {
      editor.stop();
      await store.close();
    }
  });
});
