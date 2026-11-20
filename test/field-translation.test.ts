/**
 * A page translated field by field (ADR 0032): its words over the main page's
 * blocks, its own address, the page split for a language, what the check
 * says is still untranslated, and translations made as copies moved in.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SQL } from 'bun';
import { alternates, keepWords, localizeBlocks, missingWords, normalizePage, normalizeSite, normalizeTranslations, type Page, paragraphs, placePages, siteIn, type MenuNode, wordsFrom } from '../src/core/index.ts';
import { describeCheck } from '../src/site/check.ts';
import { exportSite, publishedSite } from '../src/site/export.ts';
import { startEditor } from '../src/site/server.ts';
import { Store } from '../src/site/store.ts';
import plain from '../themes/plain.json';

const dir = await mkdtemp(join(tmpdir(), 'thecms-field-translation-'));
afterAll(() => rm(dir, { recursive: true, force: true }));

const blocks = [
  {
    id: 'b_hero',
    type: 'hero',
    content: { title: 'Made by hand', subtitle: 'Tables and chairs', image: { src: 'https://img.example/a.jpg', alt: 'A table' }, action: { label: 'Ask', href: '/contact/' } },
  },
  { id: 'b_text', type: 'text', content: { body: paragraphs('We build furniture.') } },
  { id: 'b_price', type: 'pricing', content: { title: 'Prices', plans: [{ name: 'Basic', price: '€100', period: 'a month', features: 'One table' }] } },
  { id: 'b_contact', type: 'contact', content: { title: 'Write', email: 'shop@atelier.example', phone: '+40 700' } },
  { id: 'b_group', type: 'group', children: [{ id: 'b_inner', type: 'text', content: { body: paragraphs('Inside') } }] },
];
const about = normalizePage({ slug: 'about', title: 'About', description: 'Who we are', blocks }).page;
const site = normalizeSite({
  name: 'Atelier',
  language: 'en',
  url: 'https://atelier.example',
  languages: ['ro', 'de'],
  menu: [{ id: 'a', label: '', target: { kind: 'page', slug: 'about' }, children: [] }] satisfies MenuNode[],
});
const roWords = { 'b_hero.title': 'Făcut de mână', 'b_hero.image.alt': 'O masă', 'b_hero.action.label': 'Întreabă', 'b_price.plans.0.period': 'pe lună', 'b_inner.body': paragraphs('Înăuntru') };
const translated: Page = { ...about, translations: { ro: { slug: 'despre', title: 'Despre', description: '', fields: roWords, blocks: null } } };

describe('a field', () => {
  test('is translated, or the same in every language', () => {
    const ro = localizeBlocks(about.blocks, roWords);
    const hero = ro[0]!.content;
    expect(hero).toMatchObject({ title: 'Făcut de mână', subtitle: 'Tables and chairs', image: { src: 'https://img.example/a.jpg', alt: 'O masă' }, action: { label: 'Întreabă', href: '/contact/' } });
    expect(ro[2]!.content.plans).toMatchObject([{ name: 'Basic', price: '€100', period: 'pe lună' }]);
    expect(ro[4]!.children![0]!.content.body).toEqual(paragraphs('Înăuntru'));
    // A word left empty, or a key that is no field, changes nothing.
    expect(localizeBlocks(about.blocks, { 'b_hero.title': ' ', 'b_hero.price': 'x' })).toEqual(about.blocks);
  });

  test('is read back from the page as it was written, and only the words', () => {
    const written = localizeBlocks(about.blocks, { ...roWords, 'b_hero.subtitle': 'Tables and chairs' });
    expect(wordsFrom(about.blocks, written)).toEqual({ fields: roWords, problem: '' });
    const moved = [...written.slice(1), written[0]!];
    expect(wordsFrom(about.blocks, moved).problem).toContain('split the page');
    const repriced = structuredClone(written);
    (repriced[2]!.content.plans as { price: string }[])[0]!.price = '500 lei';
    expect(wordsFrom(about.blocks, repriced).problem).toContain('a translation has the blocks of the main page');
    const reimaged = structuredClone(written);
    (reimaged[0]!.content.image as { src: string }).src = 'https://img.example/b.jpg';
    expect(wordsFrom(about.blocks, reimaged).problem).not.toBe('');
  });

  test('missing in a language is said, and a block removed takes its words with it', () => {
    const t = translated.translations!.ro!;
    expect(missingWords(about, t)).toEqual(['description', 'b_hero.subtitle', 'b_text.body', 'b_price.title', 'b_price.plans.0.name', 'b_price.plans.0.features', 'b_contact.title']);
    expect(missingWords(about, { ...t, blocks: [] })).toEqual([]);
    expect(Object.keys(keepWords(about.blocks.slice(1), roWords))).toEqual(['b_price.plans.0.period', 'b_inner.body']);
  });

  test('translations are cleaned: languages by their tag, keys by where they are, values as words', () => {
    expect(
      normalizeTranslations({ ro: { slug: 'Despre Noi', title: ' T ', fields: { 'b_hero.title': 'x', 'not a key': 'y', 'b_text.body': paragraphs('z'), 'b_hero.subtitle': 7 }, blocks: [{ type: 'text' }] }, 'Not A Tag': {}, de: 'x' }),
    ).toEqual({ ro: { slug: 'despre-noi', title: 'T', description: '', fields: { 'b_hero.title': 'x', 'b_text.body': paragraphs('z') }, blocks: [expect.objectContaining({ type: 'text' })] } });
    expect(normalizeTranslations(null)).toEqual({});
  });
});

describe('a translated page', () => {
  test('is placed at its own address, of its page, and the menu and switcher find it', () => {
    const home = normalizePage({ slug: '', title: 'Home', blocks: [], translations: { ro: { slug: 'ignored' } } }).page;
    const placed = placePages(site, [home, translated, normalizePage({ slug: 'ro/despre', title: 'Kept here', blocks: [] }).page, normalizePage({ slug: 'de/nur', title: 'Nur hier', blocks: [] }).page]);
    expect(placed.map((p) => `${p.slug} of ${p.of} in ${p.language}${p.translated ? ' translated' : ''}`)).toEqual([
      ' of  in en',
      'ro of  in ro translated',
      'about of about in en',
      'ro/despre of despre in ro',
      'de/nur of nur in de',
    ]);
    // Its address taken by a page kept there, the translation of "about" is not placed over it.
    const only = placePages(site, [translated]);
    expect(only.map((p) => p.slug)).toEqual(['about', 'ro/despre']);
    expect(only[1]).toMatchObject({ title: 'Despre', description: 'Who we are', split: false });
    expect(alternates(site, 'ro/despre', only).map((a) => `${a.language} ${a.href}`)).toEqual(['en /about/']);
    const withHomes = placePages(site, [home, translated]);
    expect(alternates(site, 'about', withHomes).map((a) => `${a.language} ${a.href} ${a.translated}`)).toEqual(['en /about/ true', 'ro /ro/despre/ true']);
    expect(alternates(site, 'ro/despre', withHomes).find((a) => a.current)?.language).toBe('ro');
    expect(siteIn(site, 'ro', withHomes).menu?.[0]?.target).toEqual({ kind: 'page', slug: 'ro/despre' });
    expect(siteIn(site, 'de', withHomes).menu?.[0]?.target).toEqual({ kind: 'page', slug: 'de/about' });
    // A language the site does not have is not placed.
    expect(placePages(normalizeSite({ ...site, languages: [] }), [translated]).map((p) => p.slug)).toEqual(['about']);
  });
});

describe('the store and the editor', () => {
  test('start, write, address, split, publish and remove a translation', async () => {
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
    try {
      await store.setTheme(plain);
      await store.publishTheme();
      await store.setSite({ name: 'Atelier', url: 'https://atelier.example', languages: ['ro'] });
      await store.savePage({ slug: '', title: 'Home', blocks: [] });
      await store.savePage(about);
      await store.savePage({ slug: 'contact', title: 'Contact', blocks: [] });

      // Started from the list: the page in Romanian, all in English words until written.
      const started = await call('POST', '/api/translate', { slug: 'about', language: 'ro' });
      expect(started.data.page).toMatchObject({ slug: 'ro/about', title: 'About' });
      expect(started.data.translation).toEqual({ of: 'about', language: 'ro', split: false });
      expect(started.data.pages.find((p: { slug: string }) => p.slug === 'ro/about')).toMatchObject({ of: 'about', language: 'ro', translated: true, missing: 13 });
      expect((await call('POST', '/api/translate', { slug: 'about', language: 'ro' })).data.error).toBe('this page is already in that language');
      expect((await call('POST', '/api/translate', { slug: 'about', language: 'fr' })).data.error).toContain('not one of the site');
      expect((await call('POST', '/api/translate', { slug: 'nothing', language: 'ro' })).data.error).toBe('no page "nothing"');
      expect((await call('GET', '/api/page?slug=ro/about')).data.translation).toEqual({ of: 'about', language: 'ro', split: false });

      // Written in the builder: the words are kept, the blocks stay the main page's.
      const written = { ...started.data.page, slug: 'ro/despre', title: 'Despre', blocks: localizeBlocks(about.blocks, roWords) };
      const saved = await call('PUT', '/api/page', { page: written, translation: { of: 'about', language: 'ro' } });
      expect(saved.data.page.slug).toBe('ro/despre');
      expect((await store.draft('about'))?.translations?.ro).toEqual({ slug: 'despre', title: 'Despre', description: '', fields: roWords, blocks: null });
      const added = { ...written, blocks: [...written.blocks, { id: 'b_new', type: 'text', content: {} }] };
      expect((await call('PUT', '/api/page', { page: added, translation: { of: 'about', language: 'ro' } })).data.error).toContain('split the page for this language');
      expect((await call('PUT', '/api/page', { page: { ...written, slug: 'contact' }, translation: { of: 'about', language: 'ro' } })).data.error).toBe('a page in Română stays under /ro/');
      expect((await call('PUT', '/api/page', { page: { ...written, title: '' }, translation: { of: 'about', language: 'ro' } })).data.error).toBe('a page has a title');
      await call('POST', '/api/translate', { slug: 'contact', language: 'ro' });
      expect((await call('PUT', '/api/page', { page: { slug: 'ro/despre', title: 'C', blocks: [] }, translation: { of: 'contact', language: 'ro' } })).data.error).toBe('"/ro/despre/" is already the address of "Despre"');
      expect((await call('PUT', '/api/page', { page: { slug: 'ro/blog', title: 'C', blocks: [] }, translation: { of: 'contact', language: 'ro' } })).data.error).toContain('used by the site itself');
      await store.deletePage('ro/contact');
      expect((await store.draft('contact'))?.translations).toEqual({});
      expect((await call('PUT', '/api/page', { page: written, translation: { of: 'contact', language: 'ro' } })).data.error).toBe('this page is not in that language yet');

      // Drawn in Romanian, at its own address, with the main page's prices.
      const drawn = await call('POST', '/api/render', { page: written });
      expect(String(drawn.data.body)).toContain('Făcut de mână');
      expect(String(drawn.data.body)).toContain('€100');

      // The home page in Romanian too: a language is reached through its home page (ADR 0024).
      await call('POST', '/api/translate', { slug: '', language: 'ro' });
      expect((await call('PUT', '/api/page', { page: { slug: 'ro/acasa', title: 'Acasă', blocks: [] }, translation: { of: '', language: 'ro' } })).data.page.slug).toBe('ro');

      // Published with its page; the check says what is still in English.
      await call('POST', '/api/publish', { slug: '' });
      await call('POST', '/api/publish', { slug: 'contact' });
      await call('POST', '/api/publish', { slug: 'ro/despre' });
      expect((await store.pages()).find((p) => p.slug === 'ro/despre')).toMatchObject({ published: true, changed: false });
      const files = await publishedSite(store);
      expect(String(files.get('ro/despre/index.html'))).toContain('Făcut de mână');
      expect(String(files.get('about/index.html'))).toContain('href="https://atelier.example/ro/despre/"');
      const check = (await call('GET', '/api/check')).data.check;
      expect(check.untranslated).toEqual([{ slug: 'ro/despre', language: 'ro', missing: 7 }]);
      expect(describeCheck(check).warnings).toContain('/ro/despre/ shows 7 texts in the main language, not translated into ro');
      const said: string[] = [];
      await exportSite(store, join(dir, 'out'), (line) => said.push(line));
      expect(said.some((line) => line.startsWith('/ro/despre/ shows 7 texts'))).toBe(true);

      // Its versions are its page's, shown in its language.
      const [kept] = (await call('GET', '/api/versions?slug=ro/despre')).data.versions;
      expect(kept.title).toBe('About');
      expect((await call('GET', `/api/version?slug=ro/despre&at=${encodeURIComponent(kept.at)}`)).data.page).toMatchObject({ slug: 'ro/despre', title: 'Despre' });
      expect((await call('GET', `/api/version?slug=about&at=${encodeURIComponent(kept.at)}`)).data.page).toMatchObject({ slug: 'about', title: 'About' });

      // A language a page is still in is kept.
      await expect(store.setSite({ name: 'Atelier', languages: [] })).rejects.toThrow('"Home" is still in Română; remove its translation');

      // Split for Romanian: its blocks are its own now.
      const split = await call('POST', '/api/split', { of: 'about', language: 'ro' });
      expect(split.data.translation).toEqual({ of: 'about', language: 'ro', split: true });
      expect((await store.draft('about'))?.translations?.ro?.fields).toEqual({});
      expect((await call('PUT', '/api/page', { page: added, translation: { of: 'about', language: 'ro' } })).data.page.blocks).toHaveLength(6);
      expect((await call('POST', '/api/split', { of: 'about', language: 'ro' })).data.translation.split).toBe(true);
      expect((await call('POST', '/api/split', { of: 'contact', language: 'ro' })).data.error).toBe('this page is not in that language yet');
      expect((await store.pages()).find((p) => p.slug === 'ro/despre')).toMatchObject({ split: true, missing: 0 });

      // Removed from Romanian; the language can go then.
      expect((await call('DELETE', '/api/page?slug=ro/despre')).status).toBe(200);
      expect(await store.locate('ro/despre')).toBeNull();
      expect((await call('GET', '/api/page?slug=ro/despre')).status).toBe(404);
      await store.deletePage('ro');
      await store.setSite({ name: 'Atelier', languages: [] });
    } finally {
      editor.stop();
      await store.close();
    }
  });

  test('translations made as copies move into their pages when the site is opened', async () => {
    const file = join(dir, 'old.db');
    const old = await Store.open(file);
    await old.setSite({ name: 'Atelier', languages: ['ro'] });
    const copy = (slug: string, title: string, from: Page['blocks']) => JSON.stringify(normalizePage({ slug, title, blocks: from }).page);
    await old.savePage(about);
    await old.savePage({ slug: 'contact', title: 'Contact', blocks: [{ id: 'b_c', type: 'text', content: { body: paragraphs('Write') } }] });
    await old.savePage({ slug: 'ro/solo', title: 'Doar aici', blocks: [] });
    await old.publish('about');
    await old.close();
    // Written as ADR 0024 kept them, straight into the table: one copy with the same blocks, one with others.
    const sql = new SQL({ adapter: 'sqlite', filename: file } as unknown as ConstructorParameters<typeof SQL>[0]);
    const same = copy('ro/about', 'Despre', localizeBlocks(about.blocks, roWords));
    await sql.unsafe('INSERT INTO pages (slug, position, draft, published, updated_at) VALUES (?, 9, ?, ?, ?)', ['ro/about', same, same, 'now']);
    await sql.unsafe('INSERT INTO pages (slug, position, draft, updated_at) VALUES (?, 9, ?, ?)', ['ro/contact', copy('ro/contact', 'Contact', [{ id: 'b_other', type: 'text', content: {} }]), 'now']);
    await sql.unsafe("INSERT INTO versions (kind, slug, at, doc) VALUES ('page', 'ro/about', 'then', '{}')");
    await sql.close();

    const store = await Store.open(file);
    try {
      expect((await store.draft('about'))?.translations?.ro).toEqual({ slug: '', title: 'Despre', description: '', fields: roWords, blocks: null });
      const published = await store.published();
      expect(published.find((p) => p.slug === 'ro/about')?.title).toBe('Despre');
      expect((await store.draft('contact'))?.translations?.ro).toMatchObject({ title: '', blocks: [{ id: 'b_other', type: 'text' }] });
      expect(await store.draft('ro/about')).toBeNull();
      expect(await store.draft('ro/solo')).not.toBeNull();
      expect(await store.versions('page', 'ro/about')).toHaveLength(1);
      expect((await store.pages()).map((p) => p.slug)).toEqual(['about', 'ro/about', 'contact', 'ro/contact', 'ro/solo']);
    } finally {
      await store.close();
    }
  });
});
