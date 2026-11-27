/**
 * Redirects written by hand and made when a page moves (ADR 0036): kept
 * without hops, checked before publishing, and written for the hosts that
 * read a list as well as for any other.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addRedirect, htaccessFile, redirectProblems, redirectsFile } from '../src/core/index.ts';
import { describeCheck } from '../src/site/check.ts';
import { exportSite, publishedSite } from '../src/site/export.ts';
import { startEditor } from '../src/site/server.ts';
import { Store } from '../src/site/store.ts';
import plain from '../themes/plain.json';

const dir = await mkdtemp(join(tmpdir(), 'uhlaka-redirects-'));
afterAll(() => rm(dir, { recursive: true, force: true }));

describe('a list of redirects', () => {
  test('takes a new one without hops, and drops what leads away from an address in use again', () => {
    let list = addRedirect([], '/a/', '/b/');
    list = addRedirect(list, '/b/', '/c/');
    expect(list).toEqual([
      { from: '/a/', to: '/c/' },
      { from: '/b/', to: '/c/' },
    ]);
    // Moving back: /c/ leads to /b/, which is a page again.
    list = addRedirect(list, '/c/', '/b/');
    expect(list).toEqual([
      { from: '/a/', to: '/b/' },
      { from: '/c/', to: '/b/' },
    ]);
    expect(addRedirect([{ from: '/x/', to: '/a/#top' }], '/a/', '/z/')).toEqual([{ from: '/x/', to: '/z/#top' }, { from: '/a/', to: '/z/' }]);
    expect(redirectsFile(list)).toBe('/a/ /b/ 301\n/c/ /b/ 301\n');
    expect(htaccessFile(list)).toBe('Redirect 301 /a/ /b/\nRedirect 301 /c/ /b/\n');
    expect(redirectsFile([])).toBe('');
    expect(htaccessFile([])).toBe('');
  });

  test('says which ones loop, chain, lead nowhere or are hidden by a page', () => {
    const answered = new Set(['/', '/b/', '/page/']);
    expect(
      redirectProblems(
        [
          { from: '/ok/', to: '/b/#x' },
          { from: '/l1/', to: '/l2/' },
          { from: '/l2/', to: '/l1/' },
          { from: '/hop/', to: '/ok/' },
          { from: '/lost/', to: '/nowhere/' },
          { from: '/page/', to: '/b/' },
        ],
        answered,
      ).map((p) => `${p.from}:${p.problem}`),
    ).toEqual(['/l1/:loop', '/l2/:loop', '/hop/:chain', '/lost/:missing', '/page/:shadowed']);
    expect(describeCheck({ broken: [], unnamed: [], redirects: [{ from: '/l1/', to: '/l2/', problem: 'loop' }] }).warnings).toEqual(['the redirect from /l1/ to /l2/ comes back to itself']);
  });
});

describe('the store, the editor and the export', () => {
  test('move a page with its menu, versions and translations, keep the old addresses, and write them for every host', async () => {
    const store = await Store.open(join(dir, 'site.db'));
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
      await store.setTheme(plain);
      await store.publishTheme();
      await store.setSite({ name: 'Atelier', languages: ['ro'], menu: [{ id: 'm_1', label: '', target: { kind: 'page', slug: 'servicii' }, children: [] }] });
      await store.savePage({ slug: '', title: 'Home', blocks: [{ id: 'b_l', type: 'text', content: { body: [{ type: 'paragraph', children: [{ text: 'See ', marks: [] }] }] } }] });
      await store.publish('');
      await store.savePage({ slug: 'servicii', title: 'Services', blocks: [] });
      await store.translate('servicii', 'ro');
      await store.publish('servicii');
      await store.savePage({ slug: 'draft', title: 'Draft', blocks: [] });

      // Moved: what was published moves with it, and every address visitors knew leads to the new one.
      const moved = await call('POST', '/api/move', { from: 'servicii', to: 'Ce facem' });
      expect(moved.data.page.slug).toBe('ce-facem');
      expect(moved.data.redirects).toEqual([
        { from: '/servicii/', to: '/ce-facem/' },
        { from: '/ro/servicii/', to: '/ro/ce-facem/' },
      ]);
      expect((await store.site()).menu?.[0]?.target).toEqual({ kind: 'page', slug: 'ce-facem' });
      expect(await store.versions('page', 'ce-facem')).toHaveLength(1);
      expect(await store.draft('servicii')).toBeNull();
      // A page never published leaves nothing behind.
      await call('POST', '/api/move', { from: 'draft', to: 'still-draft' });
      expect((await call('GET', '/api/redirects')).data.redirects).toHaveLength(2);

      // What cannot be done says why.
      for (const [body, error] of [
        [{ from: '', to: 'x' }, 'the home page stays at /'],
        [{ from: 'nothing', to: 'x' }, 'no page "nothing"'],
        [{ from: 'ce-facem', to: 'ce-facem' }, 'a page moves to another address'],
        [{ from: 'ce-facem', to: 'ro/x' }, 'a page in English stays under its language'],
        [{ from: 'ce-facem', to: 'still-draft' }, '"/still-draft/" is already the address of "Draft"'],
        [{ from: 'ce-facem', to: 'media' }, null],
      ] as const) {
        const answer = await call('POST', '/api/move', body);
        expect(answer.status).toBe(400);
        if (error) expect(answer.data.error).toBe(error);
      }

      // A translation published at a new address leaves a way from the old one.
      const ro = (await store.locate('ro/ce-facem'))!;
      await store.saveTranslation('ce-facem', 'ro', { ...ro, slug: 'ro/servicii-noi' });
      await store.publish('ro/servicii-noi');
      expect((await store.redirects()).map((r) => `${r.from}>${r.to}`)).toEqual(['/servicii/>/ce-facem/', '/ro/servicii/>/ro/servicii-noi/', '/ro/ce-facem/>/ro/servicii-noi/']);

      // Written by hand, cleaned, and checked before publishing.
      const written = await call('PUT', '/api/redirects', { redirects: [...(await store.redirects()), { from: '/old-shop', to: '/nowhere/' }, { from: '/ce-facem/', to: '/' }, { from: 'bad', to: '/' }] });
      expect(written.data.redirects).toHaveLength(5);
      const check = (await call('GET', '/api/check')).data.check;
      expect(check.redirects).toEqual([
        { from: '/old-shop/', to: '/nowhere/', problem: 'missing' },
        { from: '/ce-facem/', to: '/', problem: 'shadowed' },
      ]);

      // The export: a list for Cloudflare and Netlify, one for Apache, and a small page for any other host.
      const files = await publishedSite(store);
      expect(files.get('_redirects')).toBe('/servicii/ /ce-facem/ 301\n/ro/servicii/ /ro/servicii-noi/ 301\n/ro/ce-facem/ /ro/servicii-noi/ 301\n');
      expect(files.get('.htaccess')).toContain('Redirect 301 /servicii/ /ce-facem/');
      expect(String(files.get('servicii/index.html'))).toContain('http-equiv="refresh"');
      const warned: string[] = [];
      await exportSite(store, join(dir, 'out'), (line) => warned.push(line));
      expect(warned.some((line) => line.includes('the redirect from /old-shop/ to /nowhere/ leads to an address the site does not have'))).toBe(true);

      // None left that the export writes: no list either.
      await store.setRedirects([]);
      expect((await publishedSite(store)).has('_redirects')).toBe(false);
    } finally {
      editor.stop();
      await store.close();
    }
  });
});
