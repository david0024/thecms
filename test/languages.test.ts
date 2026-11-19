/**
 * Language packs (ADR 0021): one JSON file a language, checked against the
 * English words before any of it is used, with English for what it leaves out.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyPack, type Catalog, flattenCatalog, format, packCoverage, parsePack, placeholders } from '../src/core/index.ts';
import { en as adminEnglish, say, t, useLanguage } from '../src/admin/messages.ts';
import { dateText, wordsFor } from '../src/blocks/words.ts';
import { ENGLISH, languages, packFor, readLanguages } from '../src/site/languages.ts';
import { startEditor } from '../src/site/server.ts';
import { Store } from '../src/site/store.ts';
import plain from '../themes/plain.json';

const base: Catalog = { admin: { hello: 'Hello', named: 'Hello, {name}', posts: { one: '1 post', other: '{count} posts' } }, site: { menu: 'Menu' } };

describe('a language pack', () => {
  test('keeps what fits English, and names what does not', () => {
    const { pack, issues } = parsePack(
      {
        $language: 'ro',
        $name: 'Română',
        'admin.hello': 'Salut',
        'admin.named': 'Salut, {nume}',
        'admin.posts': 'articole',
        'site.menu': { one: 'Meniu', other: 'Meniuri' },
        'admin.nowhere': 'x',
        'admin.empty': '',
      },
      base,
    );
    expect(pack).toEqual({ language: 'ro', name: 'Română', messages: { 'admin.hello': 'Salut' } });
    expect(issues.map((i) => i.key)).toEqual(['admin.named', 'admin.posts', 'site.menu', 'admin.nowhere', 'admin.empty']);
    expect(issues[0]?.message).toBe('fills in {nume}, where English fills in {name}');
  });

  test('gives the forms its language needs for a number, with "other" always', () => {
    const { pack, issues } = parsePack({ $language: 'ro', 'admin.posts': { one: '1 articol', few: '{count} articole', other: '{count} de articole' } }, base);
    expect(issues).toEqual([]);
    const posts = pack?.messages['admin.posts'] as never;
    expect([1, 2, 19, 20, 101].map((count) => format(posts, { count }, 'ro'))).toEqual(['1 articol', '2 articole', '19 articole', '20 de articole', '101 articole']);
    expect(parsePack({ $language: 'ro', 'admin.posts': { one: '1 articol' } }, base).issues[0]?.message).toContain('"other" always');
    expect(parsePack({ $language: 'ro', 'admin.posts': { other: '{count}', several: 'x' } }, base).issues).toHaveLength(1);
  });

  test('names its language, or it is not a pack', () => {
    for (const raw of [null, [], 'ro', {}, { $language: 'Romanian' }]) expect(parsePack(raw, base).pack).toBeNull();
    expect(parsePack({ $language: 'pt-BR' }, base).pack?.name).toBe('pt-BR');
  });

  test('is text: a control character is taken out, and a message is cut to length', () => {
    const { pack } = parsePack({ $language: 'ro', 'admin.hello': `Sa\u0007lut${'!'.repeat(3000)}` }, base);
    expect((pack?.messages['admin.hello'] as string).startsWith('Salut')).toBe(true);
    expect((pack?.messages['admin.hello'] as string).length).toBe(2000);
  });

  test('what it leaves out is said in English', () => {
    const { pack } = parsePack({ $language: 'ro', 'admin.hello': 'Salut' }, base);
    expect(applyPack(base, pack)).toEqual({ ...base, admin: { ...(base.admin as Catalog), hello: 'Salut' } });
    expect(packCoverage(pack!, base)).toBe(0.25);
    expect(applyPack(base, null)).toBe(base);
  });
});

describe('a message', () => {
  test('fills its places, and leaves a place it is not given', () => {
    expect(placeholders('{a} and {b}, {a}')).toEqual(['a', 'b']);
    expect(format('Hello, {name}, {other}', { name: 'Ana' })).toBe('Hello, Ana, {other}');
    expect(format({ zero: 'none', one: 'one', other: '{count}' }, { count: 0 })).toBe('none');
    expect(format({ other: '{count} x' }, { count: 3 }, 'not a language!')).toBe('3 x');
  });
});

describe('the packs that ship', () => {
  test('each fits English, and says all of it', () => {
    const { packs, problems } = readLanguages([]);
    expect(problems).toEqual([]);
    expect(packs.map((p) => p.language)).toContain('ro');
    for (const pack of packs) expect(Object.keys(flattenCatalog(ENGLISH)).filter((key) => !(key in pack.messages))).toEqual([]);
  });

  test('Romanian is a pack like any other: the site says its words, and English is the fallback', () => {
    expect(wordsFor('ro').formMessage).toBe('Mesaj');
    expect(wordsFor('ro-MD').menu).toBe('Meniu');
    expect(wordsFor('xx').menu).toBe('Menu');
    expect(dateText('2026-11-19', 'ro')).toBe('19 noiembrie 2026');
    expect(dateText('2026-11-19', 'not a language!')).toBe('2026-11-19');
    expect(packFor('ro')?.name).toBe('Română');
    expect(packFor('en')).toBeNull();
    expect(languages()[0]).toEqual({ language: 'en', name: 'English', coverage: 1 });
  });

  test('a folder of packs is read; what does not fit is named, and a later folder wins', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'thecms-languages-'));
    try {
      await writeFile(join(dir, 'ro.json'), JSON.stringify({ $language: 'ro', $name: 'Mine', 'site.menu': 'Meniul meu', 'site.nope': 'x' }));
      await writeFile(join(dir, 'broken.json'), '{');
      await writeFile(join(dir, 'notes.txt'), 'not a pack');
      const { packs, problems } = readLanguages([dir, join(dir, 'missing')]);
      expect(packs.find((p) => p.language === 'ro')?.name).toBe('Mine');
      expect(problems).toHaveLength(2);
      expect(problems[0]).toStartWith('broken.json: not JSON');
      expect(problems[1]).toBe('ro.json: site.nope: English has no such message');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('the admin in a language', () => {
  afterEach(() => useLanguage(null));

  test('takes a pack over its English words, and goes back', () => {
    useLanguage(packFor('ro'));
    expect(t.nav.pages).toBe('Pagini');
    expect(t.imp.other).toBe('Alege alt fișier');
    expect(say(t.ctypes.entries, { count: 20 })).toBe('20 de intrări');
    useLanguage(null);
    expect(t.nav.pages).toBe('Pages');
    expect(say(t.ctypes.entries, { count: 1 })).toBe('1 entry');
    expect(adminEnglish.nav.pages).toBe('Pages');
  });

  test("is sent the words of the admin's language, or the site's", async () => {
    const dir = await mkdtemp(join(tmpdir(), 'thecms-admin-language-'));
    const store = await Store.open(join(dir, 'site.db'));
    const editor = await startEditor(store, { listen: false });
    const page = async () => (await editor.fetch(new Request('http://127.0.0.1:4321/admin/', { headers: { host: '127.0.0.1:4321' } }))).text();
    try {
      await store.setSite({ name: 'S' });
      await store.setTheme(plain);
      expect(await page()).toContain('<html lang="en">');
      expect(await page()).toContain('<script type="application/json" id="cms-language">null</script>');
      await store.setSite({ name: 'S', language: 'ro' });
      expect(await page()).toContain('<html lang="ro">');
      expect(await page()).toContain('"admin.nav.pages":"Pagini"');
      await store.setSite({ name: 'S', language: 'ro', adminLanguage: 'en' });
      expect(await page()).toContain('<html lang="en">');
      const state = (await (await editor.fetch(new Request('http://127.0.0.1:4321/api/state', { headers: { host: '127.0.0.1:4321', 'x-thecms-token': editor.token } }))).json()) as { languages: { language: string }[] };
      expect(state.languages.map((l) => l.language)).toEqual(['en', 'ro']);
    } finally {
      editor.stop();
      await store.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

});
