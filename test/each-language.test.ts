/**
 * Actions on translations (ADR 0034): what an extension gives back for a
 * translation changes only its words, and an action for each language fills
 * in what each translation of a page does not say yet.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fillTranslation, newTranslation, normalizePage, paragraphs, SECTION_KIND, takeWords } from '../src/core/index.ts';
import { extensionHost } from '../src/site/extensions.ts';
import { startEditor } from '../src/site/server.ts';
import { Store } from '../src/site/store.ts';
import { packExtension } from '../tools/pack-extension.ts';

const dir = await mkdtemp(join(tmpdir(), 'thecms-each-language-'));
afterAll(() => rm(dir, { recursive: true, force: true }));

const blocks = [
  { id: 'b_hero', type: 'hero', content: { title: 'Made by hand', image: { src: 'https://img.example/a.jpg', alt: 'A table' }, action: { label: 'Ask', href: '/contact/' } } },
  { id: 'b_price', type: 'pricing', content: { title: 'Prices', plans: [{ name: 'Basic', price: '€100', period: 'a month' }] } },
  { id: 'b_contact', type: 'contact', content: { title: 'Write', email: 'shop@atelier.example' } },
  { id: 'b_text', type: 'text', content: { body: paragraphs('We build furniture.') } },
];
const about = normalizePage({ slug: 'about', title: 'About', description: 'Who we are', blocks }).page;

describe('words taken from an answer', () => {
  test('are only those a translation has: never a price, an address, a picture or a block', () => {
    const answer = normalizePage({
      slug: 'about',
      title: 'Despre',
      blocks: [
        { id: 'b_hero', type: 'hero', content: { title: 'Făcut de mână', image: { src: 'https://evil.example/b.jpg', alt: 'O masă' }, action: { label: 'Întreabă', href: '/elsewhere/' } } },
        { id: 'b_price', type: 'pricing', content: { title: 'Prețuri', plans: [{ name: 'De bază', price: '100 lei', period: 'pe lună' }, { name: 'Added', price: '1' }] } },
        { id: 'b_contact', type: 'contact', content: { title: 'Scrie', email: 'other@evil.example' } },
        { id: 'b_new', type: 'text', content: { body: paragraphs('Added') } },
      ],
    }).page;
    const taken = takeWords(about.blocks, answer.blocks);
    expect(taken.map((b) => b.id)).toEqual(['b_hero', 'b_price', 'b_contact', 'b_text']);
    expect(taken[0]!.content).toMatchObject({ title: 'Făcut de mână', image: { src: 'https://img.example/a.jpg', alt: 'O masă' }, action: { label: 'Întreabă', href: '/contact/' } });
    expect(taken[1]!.content.plans).toHaveLength(1);
    expect((taken[1]!.content.plans as unknown[])[0]).toMatchObject({ name: 'De bază', price: '€100', period: 'pe lună' });
    expect(taken[2]!.content.email).toBe('shop@atelier.example');
    // A place the answer has nothing for keeps its words.
    expect(taken[3]!.content.body).toEqual(paragraphs('We build furniture.'));
  });

  test('fill in what a translation does not say, and keep what a person wrote', () => {
    const had = { ...newTranslation(), title: 'Despre noi', fields: { 'b_hero.title': 'Lucrat manual', 'b_text.body': [] } };
    const written = normalizePage({ ...about, title: 'Despre', description: 'Cine suntem', blocks: takeWords(about.blocks, [{ ...about.blocks[0]!, content: { ...about.blocks[0]!.content, title: 'Făcut de mână', action: { label: 'Întreabă', href: '/x/' } } }, { ...about.blocks[3]!, content: { body: paragraphs('Facem mobilă.') } }]) }).page;
    const filled = fillTranslation(about, had, written);
    expect(filled.title).toBe('Despre noi');
    expect(filled.description).toBe('Cine suntem');
    expect(filled.fields).toEqual({ 'b_hero.title': 'Lucrat manual', 'b_hero.action.label': 'Întreabă', 'b_text.body': paragraphs('Facem mobilă.') });
    // Words the same as the main page's say nothing new; a page with no description gets none.
    const bare = { ...about, description: '' };
    expect(fillTranslation(bare, newTranslation(), { ...about, title: 'About', description: 'Something' })).toEqual(newTranslation());
  });
});

describe('an action for each language, in the editor', () => {
  test('starts and fills each translation, keeps written words, skips a split one, and on a translation changes only words', async () => {
    const { file } = await packExtension(join(import.meta.dir, 'fixtures', 'extension'), dir);
    const PACKAGE = await Bun.file(file).text();
    const store = await Store.open(join(dir, 'site.db'));
    const host = extensionHost(store);
    await host.install(PACKAGE, (await host.offer(PACKAGE)).sha256);
    host.close();
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
      await store.setSite({ name: 'Atelier', languages: ['ro', 'de', 'fr'] });
      await store.savePage(about);
      // Romanian has words already; French is split.
      await store.translate('about', 'ro');
      await store.saveTranslation('about', 'ro', { ...(await store.locate('ro/about'))!, title: 'Despre noi' });
      await store.translate('about', 'fr');
      await store.splitTranslation('about', 'fr');

      const ran = await call('POST', '/api/extensions/shout/each/stamp', { slug: 'about', kind: 'page' });
      expect(ran.data.done).toEqual(['ro', 'de']);
      expect(ran.data.skipped).toEqual(['fr']);
      expect(ran.data.pages.find((p: { slug: string }) => p.slug === 'de/about')).toMatchObject({ of: 'about', language: 'de' });
      const main = (await store.draft('about'))!;
      expect(main.translations?.ro?.title).toBe('Despre noi');
      expect(main.translations?.de?.title).toBe('[de] About');
      expect(main.translations?.de?.description).toBe('[de] Who we are');
      expect(main.translations?.de?.fields).toMatchObject({ 'b_hero.title': '[de] Made by hand', 'b_hero.image.alt': '[de] A table', 'b_price.plans.0.period': '[de] a month' });
      expect(Object.keys(main.translations?.de?.fields ?? {})).not.toContain('b_price.plans.0.price');
      expect(main.translations?.fr?.blocks?.[0]?.content.title).toBe('Made by hand');
      const de = (await store.locate('de/about'))!;
      expect((de.blocks[1]!.content.plans as unknown[])[0]).toMatchObject({ name: '[de] Basic', price: '€100', period: '[de] a month' });
      expect(de.blocks[0]!.content.action).toEqual({ label: '[de] Ask', href: '/contact/' });

      // Run on a translation, as a change: its words only.
      const page = { slug: 'ro/about', title: 'Despre noi', description: '', blocks: (await store.locate('ro/about'))!.blocks };
      const fixed = (await call('POST', '/api/extensions/shout/run/stamp', { page, fixed: true })).data.page;
      expect(fixed.slug).toBe('ro/about');
      expect(fixed.blocks[1].content.plans[0].price).toBe('€100');
      expect(fixed.blocks[2].content.email).toBe('shop@atelier.example');
      expect(fixed.blocks[1].content.plans[0].period).toBe('[ro] [ro] a month');
      const free = (await call('POST', '/api/extensions/shout/run/stamp', { page })).data.page;
      expect(free.blocks[1].content.plans[0].price).toBe('[ro] €100');
      const block = { id: 'b_contact', type: 'contact', content: { title: 'Write', email: 'shop@atelier.example' } };
      expect((await call('POST', '/api/extensions/shout/run/louder', { block, slug: 'ro/about', fixed: true })).data.block.content).toMatchObject({ title: 'WRITE', email: 'shop@atelier.example' });
      expect((await call('POST', '/api/extensions/shout/run/louder', { block, slug: 'ro/about' })).data.block.content.email).toBe('SHOP@ATELIER.EXAMPLE');

      // A section too; what cannot be done says why.
      await call('PUT', '/api/page', { kind: SECTION_KIND, page: { slug: 'offer', title: 'Offer', blocks: [{ id: 'b_o', type: 'hero', content: { title: 'Ten percent off' } }] }, create: true });
      expect((await call('POST', '/api/extensions/shout/each/stamp', { slug: 'offer', kind: SECTION_KIND })).data.done).toEqual(['ro', 'de', 'fr']);
      expect((await store.sectionDraft('offer'))?.translations?.fr?.fields).toEqual({ 'b_o.title': '[fr] Ten percent off' });
      expect((await call('POST', '/api/extensions/shout/each/title', { slug: 'about' })).status).toBe(404);
      expect((await call('POST', '/api/extensions/shout/each/stamp', { slug: 'nowhere' })).data.error).toBe('no page "nowhere" in the main language');
      expect((await call('POST', '/api/extensions/shout/each/stamp', { slug: 'ro/about' })).status).toBe(404);
      await store.savePage({ slug: 'empty', title: 'Nothing', blocks: [] });
      const nothing = await call('POST', '/api/extensions/shout/each/stamp', { slug: 'empty' });
      expect(nothing.data).toEqual({ error: 'Shout did not give back a page', done: [] });
      await expect(store.fillTranslation('about', 'fr', about)).rejects.toThrow('has no translation into that language to fill in');
    } finally {
      editor.stop();
      await store.close();
    }
  }, 20_000);
});
