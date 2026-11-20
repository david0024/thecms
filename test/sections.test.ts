/**
 * Sections (ADR 0033): blocks written once and shown on many pages, in each
 * page's language, written out as HTML by the export, and kept while a page
 * shows them.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Block, fillSections, normalizeBlocks, normalizePage, paragraphs, SECTION_KIND, sectionBlocks, sectionsIn } from '../src/core/index.ts';
import { publishedSite } from '../src/site/export.ts';
import { startEditor } from '../src/site/server.ts';
import { Store } from '../src/site/store.ts';
import plain from '../themes/plain.json';

const dir = await mkdtemp(join(tmpdir(), 'thecms-sections-'));
afterAll(() => rm(dir, { recursive: true, force: true }));

const touch = normalizePage({
  slug: 'touch',
  title: 'Get in touch',
  blocks: [
    { id: 'b_call', type: 'hero', content: { title: 'Call us', action: { label: 'Write', href: '/contact/' } } },
    { id: 'b_inner', type: 'section', content: { section: 'touch' } },
  ],
  translations: { ro: { fields: { 'b_call.title': 'Sunați-ne' }, slug: '', title: '', description: '', blocks: null }, de: { blocks: [{ id: 'b_de', type: 'text', content: { body: paragraphs('Rufen Sie an') } }] } },
}).page;
const page: Block[] = normalizeBlocks([
  { id: 'b_top', type: 'text', content: { body: paragraphs('Hello') } },
  { id: 'b_group', type: 'group', children: [{ id: 'b_s', type: 'section', content: { section: 'touch' } }] },
  { id: 'b_gone', type: 'section', content: { section: 'gone' } },
  { id: 'b_none', type: 'section', content: {} },
]).blocks;

describe('a section', () => {
  test('is named by the blocks that show it, and holds its blocks in the page\'s language', () => {
    expect(sectionsIn(page)).toEqual(['touch', 'gone']);
    expect(sectionsIn(touch.blocks)).toEqual(['touch']);
    expect(page[3]!.content.section).toBe('');
    expect(sectionBlocks(touch, 'ro')[0]!.content.title).toBe('Sunați-ne');
    expect(sectionBlocks(touch, 'de')[0]!.type).toBe('text');
    expect(sectionBlocks(touch, 'fr')).toBe(touch.blocks);
    const filled = fillSections(page, [touch], 'ro');
    const shown = filled[1]!.children![0]!;
    // Its own section block draws nothing inside it: a section never holds itself.
    expect(shown.children!.map((b) => `${b.type}:${String(b.content.title ?? '')}`)).toEqual(['hero:Sunați-ne']);
    expect(filled[2]!.children).toEqual([]);
    expect(fillSections(page, [], 'en')).toBe(page);
    const none = page.slice(0, 1);
    expect(fillSections(none, [touch], 'en')).toBe(none);
  });
});

describe('the store, the editor and the export', () => {
  test('write, translate, show, publish and keep a section while a page shows it', async () => {
    const store = await Store.open(join(dir, 'site.db'));
    const editor = await startEditor(store, { listen: false });
    const call = async (method: string, path: string, body?: unknown) => {
      const response = await editor.fetch(
        new Request(`http://127.0.0.1:4321${path}`, {
          method,
          headers: { host: '127.0.0.1:4321', 'x-thecms-token': editor.token, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
      );
      return { status: response.status, data: (await response.json()) as Record<string, any> };
    };
    const kind = SECTION_KIND;
    try {
      await store.setTheme(plain);
      await store.publishTheme();
      await store.setSite({ name: 'Atelier', languages: ['ro'], types: [{ id: 'posts', name: 'Blog', singular: 'Post', path: 'blog' }, { id: 'projects', name: 'Projects', singular: 'Project', path: 'projects' }] });

      // Written like a page, with a name and a title; it holds no other section.
      const offer = { slug: 'offer', title: 'Offer', description: '', inMenu: false, blocks: [{ id: 'b_offer', type: 'hero', content: { title: 'Ten percent off', action: { label: 'See', href: '/contact/' } } }] };
      const first = await call('PUT', '/api/page', { kind, page: offer, create: true });
      expect(first.data.page?.slug, JSON.stringify(first.data).slice(0, 300)).toBe('offer');
      expect((await call('PUT', '/api/page', { kind, page: offer, create: true })).status).toBe(409);
      expect((await call('PUT', '/api/page', { kind, page: { ...offer, title: '' } })).data.error).toBe('a section has a title');
      expect((await call('PUT', '/api/page', { kind, page: { ...offer, slug: '' } })).data.error).toBe('a section has a name');
      expect((await call('PUT', '/api/page', { kind, page: { ...offer, blocks: [{ type: 'section', content: { section: 'offer' } }] } })).data.error).toBe('a section holds no other section');
      expect((await call('GET', `/api/page?kind=${kind}&slug=offer`)).data.page.title).toBe('Offer');
      expect((await call('GET', `/api/page?kind=${kind}&slug=nothing`)).status).toBe(404);

      // Shown on a page, an entry and a type's page; the list says where.
      await store.savePage({ slug: '', title: 'Home', blocks: [{ type: 'section', content: { section: 'offer' } }] });
      await store.savePage({ slug: 'contact', title: 'Contact', blocks: [] });
      await store.saveEntry('projects', { slug: 'table', title: 'Table', blocks: [{ type: 'section', content: { section: 'offer' } }] });
      await store.setTemplate('projects', [{ id: 'b_t', type: 'entry', content: { part: 'body' } }, { type: 'section', content: { section: 'offer' } }]);
      const listed = (await call('GET', '/api/state')).data.sections;
      expect(listed).toEqual([{ slug: 'offer', title: 'Offer', published: false, changed: true, usedOn: ['/', '/projects/', '/projects/table/'], languages: [] }]);

      // Drawn on the canvas, from the drafts.
      const drawn = await call('POST', '/api/render', { page: { slug: '', title: 'Home', blocks: [{ type: 'section', content: { section: 'offer' } }] } });
      expect(String(drawn.data.body)).toContain('Ten percent off');
      expect(String(drawn.data.body)).toContain('data-frozen');
      expect(String((await call('POST', '/api/render', { kind, page: offer })).data.body)).toContain('Ten percent off');
      expect(String((await call('POST', '/api/render', { kind: 'projects', page: { slug: 'table', title: 'Table', blocks: [{ type: 'section', content: { section: 'offer' } }] } })).data.body)).toContain('Ten percent off');
      expect(String((await call('POST', '/api/render', { kind: 'template:projects', page: { blocks: [{ type: 'section', content: { section: 'offer' } }] } })).data.body)).toContain('Ten percent off');

      // Translated as a page is: words over its blocks, at its name under the language.
      const started = await call('POST', '/api/translate', { kind, slug: 'offer', language: 'ro' });
      expect(started.data.page.slug).toBe('ro/offer');
      expect((await call('GET', `/api/page?kind=${kind}&slug=ro/offer`)).data.translation).toEqual({ of: 'offer', language: 'ro', split: false });
      const ro = { ...started.data.page, blocks: [{ ...offer.blocks[0], content: { ...offer.blocks[0]!.content, title: 'Zece la sută reducere' } }] };
      expect((await call('PUT', '/api/page', { kind, page: ro, translation: { of: 'offer', language: 'ro' } })).data.page.blocks[0].content.title).toBe('Zece la sută reducere');
      expect((await store.sectionDraft('offer'))?.translations?.ro?.fields).toEqual({ 'b_offer.title': 'Zece la sută reducere' });

      // Published, the export writes it out on every page that shows it, in that page's language.
      await call('POST', '/api/publish', { kind, slug: 'ro/offer' });
      await call('POST', '/api/publish', { slug: '' });
      await call('POST', '/api/publish', { slug: 'contact' });
      await store.translate('', 'ro');
      await store.publish('');
      await store.publishEntry('projects', 'table');
      await store.publishTemplate('projects');
      const files = await publishedSite(store);
      expect(String(files.get('index.html'))).toContain('Ten percent off');
      expect(String(files.get('ro/index.html'))).toContain('Zece la sută reducere');
      expect(String(files.get('projects/table/index.html'))).toContain('Ten percent off');
      expect(String(files.get('index.html'))).not.toContain('data-frozen');

      // Its versions are kept, and shown in a language.
      const [kept] = (await call('GET', `/api/versions?kind=${kind}&slug=ro/offer`)).data.versions;
      expect(kept.title).toBe('Offer');
      expect((await call('GET', `/api/version?kind=${kind}&slug=ro/offer&at=${encodeURIComponent(kept.at)}`)).data.page.blocks[0].content.title).toBe('Zece la sută reducere');
      expect((await call('GET', `/api/version?kind=${kind}&slug=offer&at=${encodeURIComponent(kept.at)}`)).data.page.blocks[0].content.title).toBe('Ten percent off');
      expect((await call('GET', `/api/version?kind=${kind}&slug=offer&at=never`)).status).toBe(404);

      // Split for Romanian, then taken out of it.
      expect((await call('POST', '/api/split', { kind, of: 'offer', language: 'ro' })).data.translation.split).toBe(true);
      expect((await call('DELETE', `/api/page?kind=${kind}&slug=ro/offer`)).status).toBe(200);
      expect((await store.sectionDraft('offer'))?.translations).toEqual({});

      // Kept while something shows it; deleted once nothing does.
      expect((await call('DELETE', `/api/page?kind=${kind}&slug=offer`)).data.error).toBe('this section is shown on /, /projects/, /projects/table/; take it off there first');
      await store.savePage({ slug: '', title: 'Home', blocks: [] });
      await store.publish('');
      await store.saveEntry('projects', { slug: 'table', title: 'Table', blocks: [] });
      await store.publishEntry('projects', 'table');
      await store.setTemplate('projects', null);
      await store.publishTemplate('projects');
      expect((await call('DELETE', `/api/page?kind=${kind}&slug=offer`)).data.sections).toEqual([]);
      expect(await store.versions('section', 'offer')).toEqual([]);
      await expect(store.publishSection('offer')).rejects.toThrow('no section "offer"');
    } finally {
      editor.stop();
      await store.close();
    }
  });
});
