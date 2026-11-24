/**
 * The visitor's language (ADR 0071): the address stays the language, the
 * switcher keeps a choice, and the home page opens once in the browser's
 * language.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { choicePath, normalizeSite, preferredLanguage } from '../src/core/index.ts';
import { fullCheck, publishedSite } from '../src/site/export.ts';
import { startRuntime } from '../src/site/runtime.ts';
import { Store } from '../src/site/store.ts';
import plain from '../themes/plain.json';

const dir = await mkdtemp(join(tmpdir(), 'uhlaka-visitor-language-'));
afterAll(() => rm(dir, { recursive: true, force: true }));

async function open(name: string, settings: Record<string, unknown> = {}): Promise<Store> {
  const store = await Store.open(join(dir, `${name}.db`));
  await store.setTheme(plain);
  await store.publishTheme();
  await store.setSite({ name: 'Atelier', url: 'https://atelier.example', languages: ['ro', 'pt-BR'], ...settings });
  for (const slug of ['', 'about']) {
    await store.savePage({ slug, title: slug || 'Home', inMenu: true, blocks: [] });
    await store.publish(slug);
    await store.translate(slug, 'ro');
    await store.publish(slug);
  }
  return store;
}

const ask = (path: string, headers: Record<string, string> = {}) => new Request(`http://site.local${path}`, { headers });

describe('the language a browser asks for', () => {
  test('is the first the site has, by weight, by its whole tag or its first part', () => {
    const site = ['en', 'ro', 'pt-BR'];
    expect(preferredLanguage('ro-RO,ro;q=0.9,en;q=0.8', site)).toBe('ro');
    expect(preferredLanguage('de-DE,de;q=0.9,en;q=0.5', site)).toBe('en');
    expect(preferredLanguage('en;q=0.4, ro;q=0.8', site)).toBe('ro');
    expect(preferredLanguage('pt', site)).toBe('pt-BR');
    expect(preferredLanguage('PT-br', site)).toBe('pt-BR');
    expect(preferredLanguage('de, fr', site)).toBeNull();
    expect(preferredLanguage('', site)).toBeNull();
    expect(preferredLanguage('*', site)).toBeNull();
    expect(preferredLanguage('ro;q=0', site)).toBeNull();
  });

  test('the owner can turn the following off; it is on by default', () => {
    expect(normalizeSite({ name: 'A' }).visitorLanguage).toBeUndefined();
    expect(normalizeSite({ name: 'A', visitorLanguage: false }).visitorLanguage).toBe(false);
    expect(normalizeSite({ name: 'A', visitorLanguage: 'no' }).visitorLanguage).toBeUndefined();
  });
});

describe('the served site', () => {
  test('opens the home page in the browser\'s language once, never another page, never for robots', async () => {
    const store = await open('served');
    const runtime = startRuntime(store, { listen: false, log: () => {} });
    try {
      const greeted = await runtime.fetch(ask('/', { 'accept-language': 'ro-RO,ro;q=0.9,en;q=0.8' }));
      expect(greeted.status).toBe(302);
      expect(greeted.headers.get('location')).toBe('/ro/');
      expect(greeted.headers.get('vary')).toBe('Accept-Language, Cookie');
      expect(greeted.headers.get('cache-control')).toBe('private, no-store');

      // The main language, a language the site does not have, or none said: the home page as it is, kept apart by a cache.
      for (const accept of ['en-GB,en', 'de-DE', '']) {
        const home = await runtime.fetch(ask('/', accept ? { 'accept-language': accept } : {}));
        expect(home.status).toBe(200);
        expect(home.headers.get('vary')).toBe('Accept-Language, Cookie');
      }
      // A language with no home page published: no one is sent to nowhere.
      expect((await runtime.fetch(ask('/', { 'accept-language': 'pt-BR' }))).status).toBe(200);
      // Any other address opens as it was asked for.
      expect((await runtime.fetch(ask('/about/', { 'accept-language': 'ro' }))).status).toBe(200);
      // A visitor who chose a language with the switcher keeps it.
      const chose = await runtime.fetch(ask('/', { 'accept-language': 'ro', cookie: 'uhlaka-lang=en' }));
      expect(chose.status).toBe(200);
    } finally {
      runtime.stop();
      await store.close();
    }
  });

  test('the switcher keeps the choice, then goes on to the page; only to the site, only a language it has', async () => {
    const store = await open('switcher');
    const runtime = startRuntime(store, { listen: false, log: () => {} });
    try {
      const chosen = await runtime.fetch(ask(choicePath('en', '/about/')));
      expect(chosen.status).toBe(303);
      expect(chosen.headers.get('location')).toBe('/about/');
      expect(chosen.headers.get('set-cookie')).toBe('uhlaka-lang=en; Path=/; SameSite=Lax; Max-Age=31536000');
      expect((await runtime.fetch(ask(choicePath('ro', 'https://elsewhere.example/'))))).toMatchObject({ status: 303 });
      expect((await runtime.fetch(ask(choicePath('ro', '//elsewhere.example/')))).headers.get('location')).toBe('/');
      const unknown = await runtime.fetch(ask(choicePath('xx', '/ro/')));
      expect(unknown.headers.get('location')).toBe('/ro/');
      expect(unknown.headers.get('set-cookie')).toBeNull();

      // On the served site the switcher leads through the choice; the head tells search engines where the main page is.
      const page = await (await runtime.fetch(ask('/about/'))).text();
      expect(page).toContain(`href="${choicePath('ro', '/ro/about/').replaceAll('&', '&amp;')}"`);
      expect(page).toContain('<span class="lang-long">Română</span><span class="lang-short" aria-hidden="true">RO</span>');
      const home = await (await runtime.fetch(ask('/'))).text();
      expect(home).toContain('<link rel="alternate" hreflang="x-default" href="https://atelier.example/">');
      expect(page).not.toContain('x-default');
    } finally {
      runtime.stop();
      await store.close();
    }
  });

  test('turned off, the home page stays in the main language and says nothing to caches', async () => {
    const store = await open('off', { visitorLanguage: false });
    const runtime = startRuntime(store, { listen: false, log: () => {} });
    try {
      const home = await runtime.fetch(ask('/', { 'accept-language': 'ro' }));
      expect(home.status).toBe(200);
      expect(home.headers.get('vary')).toBeNull();
    } finally {
      runtime.stop();
      await store.close();
    }
  });
});

describe('an exported site', () => {
  test('has plain links in its switcher, and the check says the home page will not follow the browser', async () => {
    const store = await open('exported');
    try {
      const files = await publishedSite(store);
      expect(String(files.get('about/index.html'))).toMatch(/<a href="\/ro\/about\/" hreflang="ro"/);
      expect(String(files.get('about/index.html'))).not.toContain('/_/language');
      expect((await fullCheck(store, files)).server).toContain('language');
      await store.setSite({ ...(await store.site()), visitorLanguage: false });
      expect((await fullCheck(store, files)).server).not.toContain('language');
    } finally {
      await store.close();
    }
  });
});
