/**
 * Layouts (ADR 0035): how a page is arranged around its blocks, from closed
 * choices; picked by a page, given by a content type to its entries, with
 * sections in the sidebar and the bands.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { layoutAreas, layoutOf, layoutSections, MAX_LAYOUTS, normalizeLayouts, normalizePage, normalizeSite, normalizeTypes, parseTheme, READY_LAYOUTS, STANDARD, type Theme, translatedPage, withAreas } from '../src/core/index.ts';
import { renderPage } from '../src/site/document.ts';
import { publishedSite } from '../src/site/export.ts';
import { startEditor } from '../src/site/server.ts';
import { Store } from '../src/site/store.ts';
import plain from '../themes/plain.json';

const dir = await mkdtemp(join(tmpdir(), 'thecms-page-layouts-'));
afterAll(() => rm(dir, { recursive: true, force: true }));
const theme = parseTheme(plain).theme as Theme;

describe('a layout', () => {
  test('is a few closed choices, cleaned; a site has the ready ones until it changes them, and always a standard one', () => {
    expect(normalizeLayouts(undefined)).toEqual(READY_LAYOUTS.map((l) => ({ ...l })));
    expect(READY_LAYOUTS.map((l) => l.id)).toEqual(['standard', 'landing', 'sidebar', 'article']);
    const cleaned = normalizeLayouts([
      { name: 'Shop  page', header: false, width: 'huge', sidebar: 'left', side: 'Get In Touch', top: 7 },
      { id: 'shop-page', name: 'Again' },
      { name: '' },
      'nonsense',
    ]);
    expect(cleaned).toEqual([
      { ...(READY_LAYOUTS[0] as object), id: STANDARD },
      { id: 'shop-page', name: 'Shop page', header: false, footer: true, width: 'normal', sidebar: 'left', side: 'get-in-touch', top: '', bottom: '' },
    ] as never);
    expect(normalizeLayouts(Array.from({ length: 30 }, (_, i) => ({ name: `L${i}` })))).toHaveLength(MAX_LAYOUTS + 1);
    expect(layoutOf(cleaned, 'shop-page').name).toBe('Shop page');
    expect(layoutOf(cleaned, 'gone').id).toBe(STANDARD);
    expect(layoutOf(undefined, undefined).id).toBe(STANDARD);
    expect(layoutOf([], 'x')).toEqual(READY_LAYOUTS[0] as never);
    expect(layoutSections([...cleaned, { ...cleaned[1]!, id: 'b', top: 'offer', bottom: 'get-in-touch' }])).toEqual(['get-in-touch', 'offer']);
  });

  test('is named by a page, given by a type, and kept by the site only once it is changed', () => {
    expect(normalizePage({ slug: 'x', title: 'X', layout: 'Landing' }).page.layout).toBe('landing');
    expect('layout' in normalizePage({ slug: 'x', title: 'X' }).page).toBe(false);
    expect(normalizeTypes([{ name: 'Projects', layout: 'sidebar' }])[0]?.layout).toBe('sidebar');
    expect('layouts' in normalizeSite({ name: 'S' })).toBe(false);
    expect(normalizeSite({ name: 'S', layouts: [] }).layouts?.map((l) => l.id)).toEqual([STANDARD]);
    const site = normalizeSite({ name: 'S', languages: ['ro'] });
    const page = normalizePage({ slug: 'x', title: 'X', layout: 'landing', translations: { ro: {} } }).page;
    expect(translatedPage(site, page, 'ro')?.layout).toBe('landing');
    expect(layoutAreas(READY_LAYOUTS, [], 'en')).toEqual({});
  });

  test('draws what is around the blocks: no header, a sidebar with its section, a band, a width', () => {
    const section = normalizePage({ slug: 'offer', title: 'Offer', blocks: [{ id: 'b_o', type: 'hero', content: { title: 'Ten percent off' } }], translations: { ro: { fields: { 'b_o.title': 'Zece la sută' } } } }).page;
    const site = withAreas(
      normalizeSite({ name: 'Atelier', footer: 'Made by hand', languages: ['ro'], layouts: [...READY_LAYOUTS, { id: 'shop', name: 'Shop', width: 'wide', sidebar: 'left', side: 'offer', top: 'offer', bottom: 'missing' }] }),
      [section],
      'ro',
    );
    const page = (layout?: string) => renderPage(site, theme, normalizePage({ slug: 'x', title: 'X', layout, blocks: [{ id: 'b_t', type: 'text', content: {} }] }).page, []);
    const standard = page();
    expect(standard).toContain('class="site-header"');
    expect(standard).toContain('Made by hand');
    expect(standard).toContain('data-layout="standard"');
    expect(standard).not.toContain('<aside');
    const landing = page('landing');
    expect(landing).not.toContain('class="site-header"');
    expect(landing).not.toContain('Made by hand');
    expect(landing).toContain('layout-full');
    const shop = page('shop');
    expect(shop).toContain('data-sidebar="left"');
    expect(shop).toContain('layout-wide');
    expect(shop.match(/Zece la sută/g)).toHaveLength(2);
    expect(shop).toContain('data-area="top"');
    expect(shop).toContain('data-area="bottom"');
    // A sidebar with nothing in it is still there, and empty.
    expect(page('sidebar')).toContain('<aside class="layout-aside" data-area="side"></aside>');
  });
});

describe('the store, the editor and the export', () => {
  test('keep a layout while a page or a type is drawn in it, and a section while a layout shows it', async () => {
    const store = await Store.open(join(dir, 'site.db'));
    const editor = await startEditor(store, { listen: false });
    const call = async (method: string, path: string, body?: unknown) => {
      const response = await editor.fetch(
        new Request(`http://127.0.0.1:4321${path}`, {
          method,
          headers: { host: '127.0.0.1:4321', 'x-thecms-token': editor.token, 'content-type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
      );
      return { status: response.status, data: (await response.json()) as Record<string, any> };
    };
    try {
      await store.setTheme(plain);
      await store.publishTheme();
      const types = [{ id: 'posts', name: 'Blog', singular: 'Post', path: 'blog', dated: true, layout: 'shop' }];
      const shop = { id: 'shop', name: 'Shop', sidebar: 'right', side: 'offer' };
      expect((await call('PUT', '/api/site', { site: { name: 'Atelier', types, layouts: [shop] } })).data.error).toBeUndefined();
      await store.saveSection({ slug: 'offer', title: 'Offer', blocks: [{ id: 'b_o', type: 'hero', content: { title: 'Ten percent off' } }] });
      await store.savePage({ slug: '', title: 'Home', layout: 'shop', blocks: [] });
      await store.saveEntry('posts', { slug: 'hello', title: 'Hello', blocks: [] });

      // On the canvas, from the drafts.
      const drawn = await call('POST', '/api/render', { page: { slug: '', title: 'Home', layout: 'shop', blocks: [] } });
      expect(String(drawn.data.body)).toContain('Ten percent off');
      expect(String((await call('POST', '/api/render', { kind: 'posts', page: { slug: 'hello', title: 'Hello', blocks: [] } })).data.body)).toContain('Ten percent off');
      expect(String((await call('POST', '/api/render', { kind: 'template:posts', page: { blocks: [] } })).data.body)).toContain('data-sidebar="right"');

      // Where a section is shown names the layout; it is kept while it is.
      expect((await call('GET', '/api/state')).data.sections[0].usedOn).toEqual(['the layout "Shop"']);
      expect((await call('DELETE', '/api/page?kind=_section&slug=offer')).data.error).toBe('this section is shown on the layout "Shop"; take it off there first');

      // Published: the export draws each page and entry in its layout.
      await store.publishSection('offer');
      await store.publish('');
      await store.publishEntry('posts', 'hello');
      const files = await publishedSite(store);
      expect(String(files.get('index.html'))).toContain('Ten percent off');
      expect(String(files.get('blog/hello/index.html'))).toContain('data-sidebar="right"');
      expect(String(files.get('blog/index.html'))).toContain('Ten percent off');
      expect(String(files.get('404.html'))).toContain('data-layout="standard"');

      // A layout in use stays.
      expect((await call('PUT', '/api/site', { site: { name: 'Atelier', types, layouts: [] } })).data.error).toBe('"Home" is drawn in the layout "Shop"; give it another layout before removing this one');
      await store.savePage({ slug: '', title: 'Home', blocks: [] });
      expect((await call('PUT', '/api/site', { site: { name: 'Atelier', types, layouts: [] } })).data.error).toBe('"Blog" is drawn in the layout "Shop"; give it another layout before removing this one');
      const left = await call('PUT', '/api/site', { site: { name: 'Atelier', types: [{ ...types[0], layout: undefined }], layouts: [] } });
      expect(left.data.site.layouts.map((l: { id: string }) => l.id)).toEqual([STANDARD]);
      expect((await call('GET', '/api/state')).data.sections[0].usedOn).toEqual([]);
    } finally {
      editor.stop();
      await store.close();
    }
  });
});
