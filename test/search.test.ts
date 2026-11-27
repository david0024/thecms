/**
 * Search on the site (ADR 0042): a field the owner places, answered by the
 * runtime with a page of the site's own that lists what matches.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBlock, normalizeSite, parseTheme, type Theme } from '../src/core/index.ts';
import { renderPage } from '../src/site/document.ts';
import { FRESH_MS, startRuntime } from '../src/site/runtime.ts';
import { search, searchIndex } from '../src/site/search.ts';
import { Store } from '../src/site/store.ts';
import plain from '../themes/plain.json';

const dir = await mkdtemp(join(tmpdir(), 'uhlaka-search-'));
afterAll(() => rm(dir, { recursive: true, force: true }));
const theme = parseTheme(plain).theme as Theme;
const main = (html: string): string => html.slice(html.indexOf('<main'), html.indexOf('</main>'));
const text = (body: string) => ({ id: `b_${Math.random().toString(36).slice(2, 10)}`, type: 'text', content: { body: [{ type: 'paragraph', children: [{ text: body }] }] } });

describe('the search field', () => {
  test('asks the site\'s own server, whatever form service is set', () => {
    const page = { slug: 'find', title: 'Find', description: '', inMenu: true, blocks: [createBlock('search')] };
    expect(main(renderPage(normalizeSite({ name: 'S', forms: 'https://forms.example.com' }), theme, page, []))).toContain('action="/_/search"');
    const html = main(renderPage(normalizeSite({ name: 'S', language: 'ro', forms: '/_' }), theme, page, []));
    expect(html).toContain('action="/_/search"');
    expect(html).toContain('method="get"');
    expect(html).toContain('name="q"');
    expect(html).toContain('placeholder="Search this site"');
    expect(html).toContain('>Caută</label>');
    expect(html).not.toContain('<script');
  });
});

describe('search', () => {
  test('finds every word, without minding case or accents, titles first', () => {
    const index = [
      { path: '/a/', title: 'Oak tables', text: 'We make tables from oak.' },
      { path: '/b/', title: 'About', text: 'Our oak comes from the forest; the tables last.' },
      { path: '/c/', title: 'Păduri', text: 'Pădurile din nord.' },
    ];
    expect(search(index, 'TABLES oak').map((h) => h.path)).toEqual(['/a/', '/b/']);
    expect(search(index, 'paduri').map((h) => h.path)).toEqual(['/c/']);
    expect(search(index, 'oak chairs')).toEqual([]);
    expect(search(index, '  ,, ')).toEqual([]);
    expect(search(index, 'oak', 1)).toHaveLength(1);
    expect(search(index, 'padurile')[0]?.snippet).toBe('<mark>Pădurile</mark> din nord.');
  });

  test('shows the words around the match, escaped', () => {
    const long = `${'word '.repeat(60)}the <b> oak & ash ${'more '.repeat(60)}`;
    const [hit] = search([{ path: '/x/', title: 'X', text: long }], 'oak');
    expect(hit?.snippet.startsWith('… ')).toBe(true);
    expect(hit?.snippet.endsWith(' …')).toBe(true);
    expect(hit?.snippet).toContain('the &lt;b&gt; <mark>oak</mark> &amp; ash');
  });
});

describe('on the runtime', () => {
  test('answers with a page of the site that lists what matches', async () => {
    const store = await Store.open(join(dir, 'site.db'));
    let clock = 0;
    const runtime = startRuntime(store, { listen: false, log: () => {}, now: () => clock });
    const get = (path: string, init: RequestInit = {}) => runtime.fetch(new Request(`http://site.local${path}`, init), '1.1.1.1');
    try {
      expect((await get('/_/search?q=oak')).status).toBe(404);
      await store.setTheme(plain);
      await store.publishTheme();
      await store.setSite({ name: 'Atelier', url: 'https://example.com', forms: '/_' });
      await store.savePage({ slug: '', title: 'Home', blocks: [createBlock('search'), text('Welcome to the workshop.')] });
      await store.publish('');
      await store.savePage({ slug: 'oak', title: 'Oak & ash', blocks: [text('Our oak comes from the hills.'), createBlock('form')] });
      await store.publish('oak');
      await store.savePost({ slug: 'drying', title: 'Drying wood', date: '2026-11-01', blocks: [text('Oak dries for two years.')] });
      await store.publishPost('drying');
      await store.setRedirects([{ from: '/old-oak/', to: '/oak/' }]);
      clock += FRESH_MS;

      const found = await get('/_/search?q=OAK');
      expect(found.status).toBe(200);
      expect(found.headers.get('cache-control')).toBe('no-store');
      expect(found.headers.get('content-security-policy')).toContain("default-src 'none'");
      const html = await found.text();
      expect(html).toContain('<title>Search · Atelier</title>');
      expect(html).toContain('<meta name="robots" content="noindex">');
      expect(html).toContain('<h1>Pages that match “OAK”</h1>');
      expect(html).toContain('value="OAK"');
      expect([...html.slice(html.indexOf('search-results')).matchAll(/<li><a href="([^"]+)">/g)].map((m) => m[1])).toEqual(['/oak/', '/blog/drying/']);
      expect(html).toContain('<a href="/oak/">Oak &amp; ash</a>');
      expect(html).toContain('<mark>oak</mark>');
      // The form's own words are not what a page is found by.
      expect(search(searchIndex(new Map([['x/index.html', '<meta property="og:title" content="X"><main><form><label>Name</label></form></main>']])), 'name')).toEqual([]);

      const none = await (await get('/_/search?q=%3Cscript%3E')).text();
      expect(none).toContain('Nothing on this site matches “&lt;script&gt;”.');
      expect(none).not.toContain('<script>');
      const empty = await (await get('/_/search')).text();
      expect(empty).toContain('<h1>Search</h1>');
      expect(empty).not.toContain('search-results');
      expect((await get('/_/search?q=oak', { method: 'HEAD' })).status).toBe(200);
      expect((await get('/_/search', { method: 'POST' })).status).toBe(404);
    } finally {
      runtime.stop();
      await store.close();
    }
  });
});
