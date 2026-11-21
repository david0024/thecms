import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizePage, normalizePost, normalizeSite, parseTheme, postsType, type Theme } from '../src/core/index.ts';
import { DEMO_PAGES, DEMO_SITE } from '../src/site/demo.ts';
import { renderPage, renderParts, renderPost } from '../src/site/document.ts';
import { buildSite, exportSite } from '../src/site/export.ts';
import { Store } from '../src/site/store.ts';
import plain from '../themes/plain.json';
import studio from '../themes/studio.json';

const themeOf = (input: unknown): Theme => parseTheme(input).theme as Theme;
const site = normalizeSite({ ...DEMO_SITE, url: 'https://example.com/' });
const bodyOf = (html: string): string => html.slice(html.indexOf('<body>'));

let dir: string;
let store: Store;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'thecms-'));
  store = await Store.open(join(dir, 'site.db'));
  await store.setSite(site);
  await store.setTheme(plain);
  await store.publishTheme();
  for (const page of DEMO_PAGES) await store.publish((await store.savePage(page)).slug);
});
afterEach(async () => {
  await store.close();
  await rm(dir, { recursive: true, force: true });
});

describe('changing the theme (ADR 0001 d7, d8)', () => {
  test('the page body is byte for byte the same; only the stylesheet changes', async () => {
    const pages = await store.published();
    const a = await buildSite(site, themeOf(plain), pages);
    const b = await buildSite(site, themeOf(studio), pages);
    for (const path of ['index.html', 'about/index.html', 'contact/index.html']) {
      expect(a.get(path)).toBe(b.get(path) as string);
    }
    expect(a.get('assets/site.css')).not.toBe(b.get('assets/site.css') as string);
    // The home page has a block with one token-bound value and one free value.
    expect(a.get('index.html')).toContain('{background-color:var(--t-color-surface);padding-block:6rem}');
  });
});

describe('what a visitor receives', () => {
  test('text an author typed is never markup', async () => {
    const attack = '</title><script>alert(1)</script><img src=x onerror=alert(2)>';
    const { page } = normalizePage({
      slug: 'x',
      title: attack,
      description: `"><script>alert(3)</script>`,
      blocks: [
        { type: 'hero', content: { title: attack, subtitle: attack, eyebrow: attack } },
        { type: 'text', content: { body: [{ type: 'paragraph', children: [{ text: attack, href: 'javascript:alert(4)' }] }] } },
        { type: 'services', content: { title: attack, items: [{ title: attack, text: attack }] } },
        { type: 'contact', content: { title: attack, email: `x"onmouseover="alert(5)`, phone: attack, address: attack } },
        { type: 'text', content: { body: [{ type: 'paragraph', children: [{ text: '<!--[--> is a comment marker' }] }] } },
      ],
    });
    const html = renderPage(site, themeOf(plain), page, []);
    // Read it the way a browser does: which elements exist, and with which attributes.
    const tags = new Set<string>();
    const attributes: string[] = [];
    new HTMLRewriter()
      .on('*', {
        element(el) {
          tags.add(el.tagName);
          for (const [name, value] of el.attributes) attributes.push(`${name}=${value}`);
        },
      })
      .transform(html);
    expect([...tags].filter((t) => ['script', 'img', 'iframe', 'object'].includes(t))).toEqual([]);
    expect(attributes.filter((a) => /^on|javascript:/i.test(a))).toEqual([]);
    // The quote stayed inside the one attribute it was typed into.
    expect(attributes).toContain('href=mailto:x&quot;onmouseover=&quot;alert(5)');
    expect(html).toContain('&lt;script>alert(1)&lt;/script>');
    expect(html).toContain('&lt;!--[--> is a comment marker');
    expect((html.match(/<title>/g) ?? []).length).toBe(1);
  });

  test('a static page: no script, no request to another host, no framework marks', async () => {
    const files = await buildSite(site, themeOf(plain), await store.published());
    for (const [path, contents] of files) {
      // The one script element allowed is data for search engines, which no browser runs (ADR 0030).
      const ran = String(contents).replace(/<script type="application\/ld\+json">[^<]*<\/script>/g, '');
      expect(`${path}: ${/<script|<!--|@import|url\(/i.test(ran)}`).toBe(`${path}: false`);
    }
    const home = files.get('index.html') as string;
    expect(home).toStartWith('<!doctype html>\n<html lang="en">');
    expect(home).toContain('<link rel="canonical" href="https://example.com/">');
    expect(home).toContain('<a href="/" aria-current="page">Home</a>');
    expect(files.get('sitemap.xml')).toContain('<loc>https://example.com/about/</loc>');
    expect(files.get('robots.txt')).toContain('Sitemap: https://example.com/sitemap.xml');
  });
});

describe('the store', () => {
  test('saving a draft does not change what is published', async () => {
    const before = bodyOf(renderPage(site, themeOf(plain), (await store.published())[0]!, []));
    await store.savePage({ ...DEMO_PAGES[0], blocks: [{ type: 'hero', content: { title: 'A new draft' } }] });
    expect((await store.draft(''))!.blocks).toHaveLength(1);
    expect(await store.published()).toHaveLength(3);
    // Ids are assigned on save, so compare the words, not the bytes.
    expect(bodyOf(renderPage(site, themeOf(plain), (await store.published())[0]!, []))).toBe(before);
    await store.publish('');
    expect((await store.published())[0]!.blocks).toHaveLength(1);
  });

  test('an invalid theme is refused and the old one stays', async () => {
    await expect(store.setTheme({ ...plain, tokens: { ...plain.tokens, color: { primary: 'red' } } })).rejects.toThrow(/tokens\.color/);
    expect((await store.theme())!.name).toBe('Plain');
  });

  test('a stored row is cleaned again when read', async () => {
    await store.rawForTests('UPDATE pages SET published = ? WHERE slug = ?', [JSON.stringify({ slug: 'about', title: 'About', blocks: [{ type: 'carousel' }, { type: 'text', style: { color: { value: 'red;}' } } }] }), 'about']);
    const about = (await store.published()).find((p) => p.slug === 'about')!;
    expect(about.blocks).toHaveLength(1);
    expect(about.blocks[0]!.style).toBeUndefined();
  });
});

describe('export', () => {
  test('writes the site, and replaces its own earlier export', async () => {
    const out = join(dir, 'out');
    const first = await exportSite(store, out);
    expect(first).toEqual(['.thecms-export', '404.html', 'about/index.html', 'assets/site.css', 'contact/index.html', 'index.html', 'robots.txt', 'sitemap.xml']);
    expect(await Bun.file(join(out, 'about/index.html')).text()).toContain('Three people and a workshop');

    // Unpublished, the page leaves links to it on the others: nothing is written, the last export stays.
    await store.rawForTests('UPDATE pages SET published = NULL WHERE slug = ?', ['about']);
    await expect(exportSite(store, out)).rejects.toThrow('Nothing was exported. A link leads to an address the site does not have:\n  /about/ does not exist; linked from /, /404.html, /contact/');
    expect(await readdir(out)).toContain('about');
    // With the links gone, it goes.
    for (const slug of ['', 'contact']) await store.savePage({ ...(await store.draft(slug))!, blocks: [] });
    for (const slug of ['', 'contact']) await store.publish(slug);
    await store.setSite({ ...(await store.site()), footerLinks: [] });
    const notes: string[] = [];
    await exportSite(store, out, (line) => notes.push(line));
    expect(await readdir(out)).not.toContain('about');
  });

  test('refuses a folder it did not make', async () => {
    const out = join(dir, 'mine');
    await Bun.write(join(out, 'thesis.txt'), 'three years of work');
    expect(exportSite(store, out)).rejects.toThrow(/not empty/);
    expect(await Bun.file(join(out, 'thesis.txt')).text()).toBe('three years of work');
  });

  test('refuses to publish a site with no home page', async () => {
    await store.rawForTests('UPDATE pages SET published = NULL WHERE slug = ?', ['']);
    expect(exportSite(store, join(dir, 'out'))).rejects.toThrow(/home page/);
  });
});

test('a button with words but no address is not drawn for visitors', async () => {
  const { page } = normalizePage({ slug: 'x', title: 'X', blocks: [{ type: 'hero', content: { title: 't', action: { label: 'Soon', href: 'javascript:1' } } }] });
  const html = renderPage({ ...site, action: null }, themeOf(plain), page, []);
  expect(html).not.toContain('Soon');
  expect(html).not.toContain('class="button"');
});

test('editor marks exist only in the editor', async () => {
  const page = normalizePage(DEMO_PAGES[0]).page;
  const editing = renderParts(site, themeOf(plain), page, [], true).body;
  const visitor = renderParts(site, themeOf(plain), page, []).body;
  expect(editing).toContain('data-edit="title"');
  expect(editing).toContain('data-edit="items.0.title"');
  expect(editing).toContain('data-type="hero"');
  expect(visitor).not.toMatch(/data-edit|data-type|data-multiline|cms-empty/);
});

test('a theme being worked on does not reach the export until it is published', async () => {
  const css = async (): Promise<string> => (await buildSite(site, await store.publishedTheme() as Theme, await store.published())).get('assets/site.css') as string;
  await store.setTheme(studio);
  expect(await store.themeChanged()).toBe(true);
  expect((await store.theme())!.name).toBe('Studio');
  expect(await css()).toContain('--t-color-background:#ffffff');
  await store.publishTheme();
  expect(await store.themeChanged()).toBe(false);
  expect(await css()).toContain('--t-color-background:#12110f');
});

describe('data for search engines (ADR 0030)', () => {
  const data = (html: string): unknown => {
    const found = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)?.[1];
    return found ? JSON.parse(found) : null;
  };
  const home = normalizePage(DEMO_PAGES[0]).page;

  test('the home page says what the site is and whose; no script in a name can close it', () => {
    const named = { ...site, name: 'Oak </script><b>&', logo: { src: '/media/logo.png', alt: 'Logo' } };
    const html = renderPage(named, themeOf(plain), home, []);
    expect(html).not.toContain('</script><b>');
    expect(data(html)).toEqual({
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'WebSite', '@id': 'https://example.com/#website', name: 'Oak </script><b>&', url: 'https://example.com/', inLanguage: site.language, publisher: { '@id': 'https://example.com/#organization' } },
        { '@type': 'Organization', '@id': 'https://example.com/#organization', name: 'Oak </script><b>&', url: 'https://example.com/', logo: 'https://example.com/media/logo.png' },
      ],
    });
    expect(data(renderPage(site, themeOf(plain), { ...home, slug: 'about' }, []))).toBeNull();
    expect(data(renderPage({ ...site, url: '' }, themeOf(plain), home, []))).toBeNull();
  });

  test('a dated entry is an article; an entry of an undated type says only where it is', () => {
    const post = normalizePost({ slug: 'oak', title: 'Why oak', date: '2026-03-04', description: 'Wood that lasts', categories: ['Wood'], tags: ['oak', 'ash'], cover: { src: 'https://cdn.example/oak.jpg', alt: 'Oak' } }).post;
    const graph = (data(renderPost(site, themeOf(plain), post, [], postsType())) as { '@graph': Record<string, unknown>[] })['@graph'];
    expect(graph[0]).toEqual({
      '@type': 'BlogPosting',
      headline: 'Why oak',
      datePublished: '2026-03-04',
      url: 'https://example.com/blog/oak/',
      inLanguage: site.language,
      description: 'Wood that lasts',
      image: 'https://cdn.example/oak.jpg',
      articleSection: 'Wood',
      keywords: 'oak, ash',
      publisher: { '@id': 'https://example.com/#organization' },
      author: { '@id': 'https://example.com/#organization' },
    });
    expect(graph[1]).toMatchObject({ '@type': 'Organization' });
    expect(graph[1]).not.toHaveProperty('logo');
    const bare = normalizePost({ slug: 'x', title: 'X', date: '2026-03-04' }).post;
    const plainGraph = (data(renderPost(site, themeOf(plain), bare, [], postsType())) as { '@graph': Record<string, unknown>[] })['@graph'];
    expect(Object.keys(plainGraph[0] ?? {})).not.toContain('image');
    expect((data(renderPost(site, themeOf(plain), bare, [], { ...postsType(), dated: false })) as { '@graph': Record<string, unknown>[] })['@graph'].map((d) => d['@type'])).toEqual(['BreadcrumbList']);
  });
});
