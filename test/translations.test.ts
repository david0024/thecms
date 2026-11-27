/**
 * The same site in more than one language (ADR 0024): a page's translation
 * lives under the language's prefix, is drawn in that language with its own
 * menu and footer, and every page says where it is in the other languages.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  alternates,
  baseSlug,
  languageName,
  languageOf,
  type MenuNode,
  normalizePage,
  normalizePost,
  normalizeSite,
  pageSlug,
  pagesIn,
  parseTheme,
  reservedSlugs,
  siteIn,
  slugIn,
  slugProblem,
  type Theme,
} from '../src/core/index.ts';
import { buildSite } from '../src/site/export.ts';
import { startEditor } from '../src/site/server.ts';
import { Store } from '../src/site/store.ts';
import plain from '../themes/plain.json';

const theme = parseTheme(plain).theme as Theme;
const dir = await mkdtemp(join(tmpdir(), 'uhlaka-translations-'));
afterAll(() => rm(dir, { recursive: true, force: true }));

const node = (id: string, target: MenuNode['target'], label = '', children: MenuNode[] = []): MenuNode => ({ id, label, target, children });
const site = normalizeSite({
  name: 'Atelier',
  language: 'en',
  url: 'https://atelier.example',
  languages: ['ro', 'pt-BR'],
  footer: 'Made by hand',
  footerLinks: [{ label: 'Privacy', href: '/privacy/' }],
  action: { label: 'Ask', href: '/contact/' },
  translations: { ro: { footer: 'Făcut de mână', action: { label: 'Întreabă', href: '/ro/contact/' } } },
  menu: [node('a', { kind: 'page', slug: '' }), node('b', { kind: 'page', slug: 'about' }, 'Who we are'), node('c', { kind: 'type', id: 'posts' }), node('d', { kind: 'url', href: 'https://x.example' }, 'Shop'), node('e', { kind: 'none' }, 'More', [node('f', { kind: 'page', slug: 'contact' })])],
});
const page = (slug: string, title: string) => normalizePage({ slug, title, blocks: [{ id: 'b_text', type: 'text', content: { body: [{ type: 'p', text: title }] } }] }).page;
const pages = [page('', 'Home'), page('about', 'About'), page('contact', 'Contact'), page('ro', 'Acasă'), page('ro/about', 'Despre'), page('pt-br', 'Início')];

describe('a translation', () => {
  test('lives under its language, and its address says what it translates', () => {
    expect(pageSlug('ro/Despre noi!')).toBe('ro/despre-noi');
    expect(pageSlug('pt-BR/About')).toBe('pt-br/about');
    expect(pageSlug('ro/')).toBe('ro');
    expect(pageSlug('/about')).toBe('about');
    expect(pageSlug('not a language/x')).toBe('not-a-language-x');
    expect(pageSlug(42)).toBe('');
    expect(languageOf(site, 'ro/about')).toBe('ro');
    expect(languageOf(site, 'ro')).toBe('ro');
    expect(languageOf(site, 'pt-br')).toBe('pt-BR');
    expect(languageOf(site, 'about')).toBe('en');
    expect(baseSlug(site, 'ro/about')).toBe('about');
    expect(baseSlug(site, 'ro')).toBe('');
    expect(baseSlug(site, 'about')).toBe('about');
    expect(slugIn(site, 'ro', 'about')).toBe('ro/about');
    expect(slugIn(site, 'ro', '')).toBe('ro');
    expect(slugIn(site, 'en', 'about')).toBe('about');
    expect(pagesIn(site, 'ro', pages).map((p) => p.slug)).toEqual(['ro', 'ro/about']);
    expect(pagesIn(site, 'en', pages).map((p) => p.slug)).toEqual(['', 'about', 'contact']);
  });

  test('may not take an address of the site, or of a language it does not have', () => {
    const reserved = reservedSlugs(site);
    expect(reserved).toContain('ro');
    expect(slugProblem(site, 'ro/about', reserved)).toBe('');
    expect(slugProblem(site, 'ro', reserved)).toBe('');
    expect(slugProblem(site, 'ro/blog', reserved)).toContain('used by the site itself');
    expect(slugProblem(site, 'de/about', reserved)).toBe('"de" is not one of the site\'s languages');
  });

  test("the site's languages are each once, never the main one, and each has its own words", () => {
    const cleaned = normalizeSite({ language: 'ro', languages: ['en', 'RO', 'ro', 'de', 'de', 'DE', 'not a language', 7, ...'abcdefghijkl'.split('').map((c) => `x${c}`)] });
    expect(cleaned.languages.slice(0, 2)).toEqual(['en', 'de']);
    expect(cleaned.languages).toHaveLength(9);
    expect(cleaned.translations.en).toEqual({ footer: '', action: null, footerLinks: [] });
    expect(normalizeSite({}).languages).toEqual([]);
    expect(site.translations.ro?.action).toEqual({ label: 'Întreabă', href: '/ro/contact/' });
    expect(languageName('ro')).toBe('Română');
    expect(languageName('not a language!')).toBe('not a language!');
  });

  test('in its language, the site has that language\'s footer and button, and the main menu with each page swapped', () => {
    const ro = siteIn(site, 'ro');
    expect(ro).toMatchObject({ language: 'ro', footer: 'Făcut de mână', action: { label: 'Întreabă' } });
    // Each type is there at its address in the language (ADR 0054).
    expect(ro.types.map((t) => t.path)).toEqual(site.types.map((t) => `ro/${t.path}`));
    // The links stand in from the main language until the owner gives others.
    expect(ro.footerLinks).toEqual(site.footerLinks);
    expect(ro.menu?.map((n) => (n.target.kind === 'page' ? `${n.target.slug}:${n.label}` : n.target.kind))).toEqual(['ro:', 'ro/about:', 'type', 'url', 'none']);
    expect(ro.menu?.[4]?.children[0]?.target).toEqual({ kind: 'page', slug: 'ro/contact' });
    expect(siteIn(site, 'pt-BR')).toMatchObject({ footer: '', action: null });
    expect(siteIn(site, 'en')).toBe(site);
    expect(siteIn(site, 'de')).toBe(site);
    expect(siteIn({ ...site, menu: null }, 'ro').menu).toBeNull();
  });

  test('each page knows where it is in the other languages, or their home pages', () => {
    const about = alternates(site, 'about', pages);
    expect(about.map((a) => `${a.language} ${a.href} ${a.translated ? 'own' : 'home'}${a.current ? ' here' : ''}`)).toEqual(['en /about/ own here', 'ro /ro/about/ own', 'pt-BR /pt-br/ home']);
    expect(alternates(site, 'ro/about', pages).find((a) => a.current)?.language).toBe('ro');
    expect(alternates(site, null, pages).map((a) => a.href)).toEqual(['/', '/ro/', '/pt-br/']);
    // A language without a home page has nowhere to send a visitor yet.
    expect(alternates(site, '', pages.filter((p) => p.slug !== 'pt-br')).map((a) => a.language)).toEqual(['en', 'ro']);
    expect(alternates(normalizeSite({}), 'about', pages)).toEqual([]);
  });
});

describe('the published site in more than one language', () => {
  test('draws each page in its language, with a switcher, and tells search engines', async () => {
    const posts = [normalizePost({ slug: 'hello', title: 'Hello', date: '2026-11-19', blocks: [] }).post];
    const files = await buildSite(site, theme, pages, () => null, posts);
    const roAbout = String(files.get('ro/about/index.html'));
    expect(roAbout).toContain('<html lang="ro">');
    expect(roAbout).toContain('Făcut de mână');
    expect(roAbout).toContain('>Meniu<');
    expect(roAbout).toContain('<a class="site-name" href="/ro/">');
    expect(roAbout).toContain('<link rel="alternate" hreflang="en" href="https://atelier.example/about/">');
    expect(roAbout).toContain('<link rel="alternate" hreflang="ro" href="https://atelier.example/ro/about/">');
    expect(roAbout).not.toContain('hreflang="pt-BR" href');
    expect(roAbout).toMatch(/<nav class="site-languages" aria-label="Limbi">.*href="\/about\/" hreflang="en" lang="en"><span class="lang-long">English<\/span>.*aria-current="true"><span class="lang-long">Română<\/span>.*href="\/pt-br\/"/s);
    // The Romanian menu has the Romanian pages, and no blog: posts are in the main language.
    expect(roAbout).toContain('href="/ro/about/"');
    expect(roAbout).not.toContain('href="/blog/"');
    const about = String(files.get('about/index.html'));
    expect(about).toContain('<html lang="en">');
    expect(about).toContain('Who we are');
    expect(about).not.toContain('href="/ro/about/" aria-current');
    expect(about).toContain('href="/blog/"');
    // A post leads to each language's home page.
    expect(String(files.get('blog/hello/index.html'))).toMatch(/site-languages.*href="\/ro\/"/s);
    expect(String(files.get('contact/index.html'))).not.toContain('<link rel="alternate" hreflang');
    expect(String(files.get('sitemap.xml'))).toContain('<loc>https://atelier.example/ro/about/</loc>');
    // A site in one language has no switcher.
    expect(String((await buildSite({ ...site, languages: [] }, theme, pages.slice(0, 3))).get('about/index.html'))).not.toContain('site-languages');
  });
});

describe('the store and the editor with more than one language', () => {
  test('a language keeps its address and its pages; a translation is made and drawn in its language', async () => {
    const store = await Store.open(join(dir, 'site.db'));
    const editor = await startEditor(store, { listen: false });
    const call = async (method: string, path: string, body?: unknown) => {
      const response = await editor.fetch(
        new Request(`http://127.0.0.1:4321${path}`, {
          method,
          headers: { host: '127.0.0.1:4321', 'x-uhlaka-token': editor.token, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
      );
      return { status: response.status, data: (await response.json()) as Record<string, unknown> };
    };
    try {
      await store.setTheme(plain);
      await store.setSite({ name: 'Atelier' });
      await store.savePage({ slug: '', title: 'Home', blocks: [] });
      await store.savePage({ slug: 'de', title: 'A page called de', blocks: [] });
      await expect(store.setSite({ name: 'Atelier', languages: ['de'] })).rejects.toThrow('a page already lives at "/de/"');
      await expect(store.savePage({ slug: 'ro/about', title: 'Despre', blocks: [] })).rejects.toThrow('not one of the site\'s languages');
      await store.setSite({ name: 'Atelier', languages: ['ro'] });
      expect((await call('PUT', '/api/page', { page: { slug: 'ro/blog', title: 'x', blocks: [] }, create: true })).data.error).toContain('used by the site itself');
      expect((await call('PUT', '/api/page', { page: { slug: 'ro/despre', title: 'Despre', blocks: [] }, create: true })).status).toBe(200);
      await store.savePage({ slug: 'ro', title: 'Acasă', blocks: [] });
      const drawn = await call('POST', '/api/render', { page: { slug: 'ro/despre', title: 'Despre', blocks: [] } });
      expect(String(drawn.data.body)).toContain('>Meniu<');
      expect(String(drawn.data.body)).toContain('href="/ro/"');
      await expect(store.setSite({ name: 'Atelier', languages: [] })).rejects.toThrow('is still in Română');
      await store.deletePage('ro/despre');
      await store.deletePage('ro');
      await store.setSite({ name: 'Atelier', languages: [] });
      expect((await store.site()).languages).toEqual([]);
    } finally {
      editor.stop();
      await store.close();
    }
  });
});
