/**
 * Entries in more than one language (ADR 0054): field by field, as pages are;
 * a type's name, address and words in each language; lists, feeds,
 * categories and links between entries in each language, with only the
 * entries translated into it; comments and search in the language they are
 * asked in.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { COVER_ALT, entryAlternates, entryIn, entryTranslationFrom, fillEntryTranslation, missingEntryWords, normalizePost, normalizeSite, normalizeTypes, paragraphs, postsType, siteIn, slugsIn, typeIn } from '../src/core/index.ts';
import { publishedSite } from '../src/site/export.ts';
import { startRuntime } from '../src/site/runtime.ts';
import { startEditor } from '../src/site/server.ts';
import { Store } from '../src/site/store.ts';
import plain from '../themes/plain.json';

const dir = await mkdtemp(join(tmpdir(), 'uhlaka-entry-languages-'));
afterAll(() => rm(dir, { recursive: true, force: true }));
const URL_ = 'https://atelier.example';

const blog = {
  ...postsType(),
  comments: true as const,
  fields: [
    { key: 'wood', label: 'Wood', kind: 'choice' as const, options: ['Oak', 'Ash'] },
    { key: 'client', label: 'Client', kind: 'text' as const },
    { key: 'hours', label: 'Hours', kind: 'number' as const },
    { key: 'see', label: 'See also', kind: 'entries' as const, to: 'posts', many: true as const },
  ],
  translations: { ro: { name: 'Jurnal', singular: 'Articol', path: 'jurnal', words: { Restoration: 'Restaurare', Oak: 'Stejar', oak: 'stejar' } } },
};
const [type] = normalizeTypes([blog]);
const site = normalizeSite({ name: 'Atelier', language: 'en', url: URL_, languages: ['ro', 'de'], types: [blog] });
const table = normalizePost(
  {
    slug: 'oak-table',
    title: 'How we restored an oak table',
    date: '2026-11-01',
    excerpt: 'Three weeks of work',
    cover: { src: '/media/table.jpg', alt: 'The table' },
    categories: ['Restoration'],
    tags: ['oak'],
    fields: { wood: 'Oak', client: 'A family', hours: 40, see: ['chair'] },
    blocks: [{ id: 'b_text', type: 'text', content: { body: paragraphs('It was old.') } }],
    translations: { ro: { slug: 'masa-de-stejar', title: 'Cum am restaurat o masă de stejar', values: { [COVER_ALT]: 'Masa', client: 'O familie' }, fields: { 'b_text.body': paragraphs('Era veche.') } } },
  },
  undefined,
  type,
).post;
const chair = normalizePost({ slug: 'chair', title: 'A chair', date: '2026-10-01', blocks: [], translations: { ro: { title: 'Un scaun', slug: 'scaun' } } }, undefined, type).post;
const stool = normalizePost({ slug: 'stool', title: 'A stool', date: '2026-09-01', blocks: [] }, undefined, type).post;

describe('an entry in another language', () => {
  test('a type has its name, address and words there', () => {
    const ro = typeIn(site, type!, 'ro');
    expect(ro).toMatchObject({ id: 'posts', name: 'Jurnal', singular: 'Articol', path: 'ro/jurnal' });
    expect(ro.fields[0]?.options).toEqual(['Stejar', 'Ash']);
    // A language that says nothing of its own keeps the main names, under its prefix.
    expect(typeIn(site, type!, 'de')).toMatchObject({ name: 'Blog', path: 'de/blog' });
    expect(typeIn(site, type!, 'en')).toBe(type!);
    expect(siteIn(site, 'ro').types[0]?.path).toBe('ro/jurnal');
  });

  test('is its words over the main entry, with the common fields the main one\'s', () => {
    const slugs = slugsIn('ro', { posts: [table, chair, stool] });
    const ro = entryIn(site, type!, table, 'ro', slugs)!;
    expect(ro).toMatchObject({ slug: 'masa-de-stejar', of: 'oak-table', language: 'ro', title: 'Cum am restaurat o masă de stejar', excerpt: 'Three weeks of work', date: '2026-11-01' });
    expect(ro.cover).toEqual({ src: '/media/table.jpg', alt: 'Masa' });
    expect(ro.categories).toEqual(['Restaurare']);
    expect(ro.tags).toEqual(['stejar']);
    expect(ro.fields).toEqual({ wood: 'Stejar', client: 'O familie', hours: 40, see: ['scaun'] });
    expect(ro.blocks[0]?.content.body).toEqual(paragraphs('Era veche.'));
    // Not in a language until it is started there.
    expect(entryIn(site, type!, stool, 'ro')).toBeNull();
    expect(entryIn(site, type!, table, 'de')).toBeNull();
    // A link to an entry not in the language is left out there.
    expect(entryIn(site, type!, { ...table, fields: { ...table.fields, see: ['stool'] } }, 'ro', slugs)?.fields.see).toEqual([]);
  });

  test('keeps only what differs from the main entry, and only words', () => {
    const shown = entryIn(site, type!, table, 'ro')!;
    const written = { ...shown, title: 'Masa de stejar', fields: { ...shown.fields, hours: 99 }, cover: { src: '/media/other.jpg', alt: 'Masa' } };
    const { translation, problem } = entryTranslationFrom(type!, table, table.translations!.ro!, written);
    expect(problem).toBe('');
    expect(translation).toMatchObject({ slug: 'masa-de-stejar', title: 'Masa de stejar', excerpt: '', values: { [COVER_ALT]: 'Masa', client: 'O familie' } });
    // A block added is the main entry's to add.
    expect(entryTranslationFrom(type!, table, table.translations!.ro!, { ...written, blocks: [] }).problem).toContain('main page');
    // What it does not say yet: its summary.
    expect(missingEntryWords(type!, table, table.translations!.ro!)).toEqual(['excerpt']);
  });

  test('is filled in by an action only where it says nothing yet', () => {
    const answer = normalizePost({ ...table, title: 'Masă', excerpt: 'Trei săptămâni', blocks: [{ id: 'b_text', type: 'text', content: { body: paragraphs('Altceva.') } }], fields: { ...table.fields, client: 'Altcineva' } }, undefined, type).post;
    const filled = fillEntryTranslation(type!, table, table.translations!.ro!, answer);
    expect(filled).toMatchObject({ title: 'Cum am restaurat o masă de stejar', excerpt: 'Trei săptămâni', values: { client: 'O familie' } });
    expect(filled.fields['b_text.body']).toEqual(paragraphs('Era veche.'));
  });

  test('says where it is in each language, or that language\'s home', () => {
    const homes = [
      { language: 'en', name: 'English', href: '/', home: '/', translated: true, current: false },
      { language: 'ro', name: 'Română', href: '/ro/', home: '/ro/', translated: true, current: false },
      { language: 'de', name: 'Deutsch', href: '/de/', home: '/de/', translated: true, current: false },
    ];
    expect(entryAlternates(site, type!, table, homes, 'ro').map((a) => `${a.language} ${a.href}${a.translated ? '' : ' home'}${a.current ? ' here' : ''}`)).toEqual([
      'en /blog/oak-table/',
      'ro /ro/jurnal/masa-de-stejar/ here',
      'de /de/ home',
    ]);
  });
});

/** A site in English and Romanian, its blog with three posts, two of them in Romanian. */
async function open(name: string): Promise<Store> {
  const store = await Store.open(join(dir, `${name}.db`));
  await store.setTheme(plain);
  await store.publishTheme();
  await store.setSite({ name: 'Atelier', url: URL_, forms: '/_', languages: ['ro'], types: [blog] });
  await store.savePage({ slug: '', title: 'Home', blocks: [{ type: 'search', content: { title: '', placeholder: '', button: 'Go' } }, { type: 'entries', content: { title: 'Latest', source: 'posts', count: 3, more: 'All' } }] });
  await store.publish('');
  await store.translate('', 'ro');
  await store.publish('');
  for (const post of [table, chair, stool]) {
    await store.savePost(post);
    await store.publishPost(post.slug);
  }
  return store;
}

describe('the site', () => {
  test('has each language\'s lists, categories, feed and entries, with only what is translated', async () => {
    const store = await open('built');
    try {
      const files = await publishedSite(store);
      const ro = String(files.get('ro/jurnal/masa-de-stejar/index.html'));
      expect(ro).toContain('<html lang="ro">');
      expect(ro).toContain('Cum am restaurat o masă de stejar');
      expect(ro).toContain('Era veche.');
      expect(ro).toContain('href="/ro/jurnal/category/restaurare/"');
      expect(ro).toContain(`hreflang="en" href="${URL_}/blog/oak-table/"`);
      expect(ro).toContain(`hreflang="ro" href="${URL_}/ro/jurnal/masa-de-stejar/"`);
      // The comment form says which entry, and in which language.
      expect(ro).toContain('name="entry" value="oak-table"');
      expect(ro).toContain('name="language" value="ro"');
      const list = String(files.get('ro/jurnal/index.html'));
      expect(list).toContain('Jurnal');
      expect(list).toContain('/ro/jurnal/scaun/');
      // Only what is translated is listed in Romanian (owner, 2026-11-21).
      expect(list).not.toContain('A stool');
      expect(files.has('ro/jurnal/stool/index.html')).toBe(false);
      expect(files.has('ro/jurnal/category/restaurare/index.html')).toBe(true);
      expect(files.has('ro/jurnal/tag/stejar/index.html')).toBe(true);
      expect(String(files.get('ro/jurnal/feed.xml'))).toContain('xml:lang="ro"');
      expect(String(files.get('ro/jurnal/feed.xml'))).not.toContain('stool');
      // The main language is as it was.
      expect(String(files.get('blog/index.html'))).toContain('A stool');
      expect(String(files.get('blog/oak-table/index.html'))).toContain(`hreflang="ro" href="${URL_}/ro/jurnal/masa-de-stejar/"`);
      // The Romanian home page lists the Romanian entries, and its menu leads to the Romanian list.
      const home = String(files.get('ro/index.html'));
      expect(home).toContain('/ro/jurnal/masa-de-stejar/');
      expect(home).not.toContain('/blog/oak-table/');
      expect(home).toContain('href="/ro/jurnal/"');
      expect(String(files.get('sitemap.xml'))).toContain(`${URL_}/ro/jurnal/masa-de-stejar/`);
      // The check counts what the published translations do not say yet.
      expect(await store.untranslated()).toContainEqual({ slug: 'ro/jurnal/masa-de-stejar', language: 'ro', missing: 1 });
    } finally {
      await store.close();
    }
  });

  test('takes a comment in the language it was written in, and searches in the language asked', async () => {
    const store = await open('runtime');
    const runtime = startRuntime(store, { listen: false, log: () => {}, now: () => 0 });
    try {
      const form = { back: '/ro/jurnal/masa-de-stejar/', type: 'posts', entry: 'oak-table', language: 'ro', name: 'Ana', email: 'ana@example.org', comment: 'Frumos!', consent: 'yes', website: '' };
      const sent = await runtime.fetch(new Request('http://site.local/_/comment', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: URL_ }, body: new URLSearchParams(form).toString() }), '4.4.4.4');
      expect(sent.headers.get('location')).toBe(`${URL_}/ro/jurnal/masa-de-stejar/#comment-sent`);
      const [comment] = await store.comments();
      expect(comment).toMatchObject({ entry: 'oak-table', language: 'ro' });
      await store.approveComment(comment!.id);
      const files = await publishedSite(store);
      expect(String(files.get('ro/jurnal/masa-de-stejar/index.html'))).toContain('Frumos!');
      expect(String(files.get('blog/oak-table/index.html'))).not.toContain('Frumos!');

      const ro = await (await runtime.fetch(new Request('http://site.local/_/search?q=masa&l=ro'), '4.4.4.4')).text();
      expect(ro).toContain('<html lang="ro">');
      expect(ro).toContain('/ro/jurnal/masa-de-stejar/');
      const en = await (await runtime.fetch(new Request('http://site.local/_/search?q=oak'), '4.4.4.4')).text();
      expect(en).toContain('/blog/oak-table/');
      expect(en).not.toContain('/ro/jurnal/');
      // The search field on a Romanian page asks in Romanian.
      expect(String(files.get('ro/index.html'))).toContain('name="l" value="ro"');
    } finally {
      runtime.stop();
      await store.close();
    }
  });

  test('keeps a language, and a type\'s address there, while they are in use', async () => {
    const store = await open('rules');
    try {
      await expect(store.setSite({ ...(await store.site()), languages: [] })).rejects.toThrow('is still in');
      const types = (await store.site()).types;
      await expect(store.setSite({ ...(await store.site()), types: [...types, { name: 'Work', path: 'work', translations: { ro: { path: 'jurnal' } } }] })).rejects.toThrow('already taken in');
    } finally {
      await store.close();
    }
  });
});

describe('the editor', () => {
  test('starts, writes, splits, publishes and removes an entry\'s translation', async () => {
    const store = await open('editor');
    const editor = await startEditor(store, { listen: false });
    const call = async (method: string, path: string, body?: unknown) => {
      const response = await editor.fetch(
        new Request(`http://127.0.0.1:4321${path}`, {
          method,
          headers: { host: '127.0.0.1:4321', 'x-uhlaka-token': editor.token, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
      );
      return { status: response.status, data: (await response.json()) as Record<string, any> };
    };
    try {
      const started = await call('POST', '/api/translate', { slug: 'stool', language: 'ro', kind: 'posts' });
      expect(started.data.page).toMatchObject({ slug: 'ro/stool', title: 'A stool' });
      expect(started.data.translation).toEqual({ of: 'stool', language: 'ro', split: false });
      expect(started.data.entries.posts.find((e: { slug: string }) => e.slug === 'stool').translations).toEqual([{ language: 'ro', slug: 'ro/stool', missing: 1, split: false }]);
      expect((await call('POST', '/api/translate', { slug: 'stool', language: 'ro', kind: 'posts' })).data.error).toBe('this entry is already in that language');

      // Written at its own address, which may not be another entry's there.
      const taken = await call('PUT', '/api/page', { kind: 'posts', page: { ...started.data.page, slug: 'ro/scaun' }, translation: started.data.translation });
      expect(taken.data.error).toContain('is already the address of "A chair"');
      const saved = await call('PUT', '/api/page', { kind: 'posts', page: { ...started.data.page, slug: 'ro/taburet', title: 'Un taburet' }, translation: started.data.translation });
      expect(saved.data.page).toMatchObject({ slug: 'ro/taburet', title: 'Un taburet' });
      expect((await call('GET', '/api/page?kind=posts&slug=ro/taburet')).data.translation).toEqual({ of: 'stool', language: 'ro', split: false });

      // Drawn in its language, with its type's address there.
      const drawn = await call('POST', '/api/render', { kind: 'posts', page: saved.data.page });
      expect(drawn.data.body).toContain('Un taburet');
      expect(drawn.data.body).toContain('href="/ro/"');

      // Published with its entry.
      await call('POST', '/api/publish', { kind: 'posts', slug: 'ro/taburet' });
      expect((await publishedSite(store)).has('ro/jurnal/taburet/index.html')).toBe(true);

      const split = await call('POST', '/api/split', { kind: 'posts', of: 'stool', language: 'ro' });
      expect(split.data.translation.split).toBe(true);

      await call('DELETE', '/api/page?kind=posts&slug=ro/taburet');
      expect(await store.postDraft('stool')).not.toHaveProperty('translations');
      expect(await store.postDraft('stool')).toMatchObject({ title: 'A stool' });
    } finally {
      editor.stop();
      await store.close();
    }
  });
});
