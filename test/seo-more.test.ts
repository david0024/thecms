import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { render } from 'svelte/server';
import { type DomNode, domToRichText } from '../src/admin/richdom.ts';
import Spans from '../src/blocks/Spans.svelte';
import {
  altFromName,
  type Block,
  blocksText,
  cleanLink,
  cleanRobots,
  cutAt,
  describeBlocks,
  normalizeBlocks,
  normalizePage,
  normalizePost,
  normalizeRichText,
  normalizeSite,
  paragraphs,
  parseTheme,
  postDescription,
  type Theme,
  verificationCode,
} from '../src/core/index.ts';
import { type ContentContext, htmlToBlocks } from '../src/import/content.ts';
import { checkSeo } from '../src/site/check.ts';
import { DEMO_PAGES, DEMO_SITE } from '../src/site/demo.ts';
import { buildSite, robotsFile } from '../src/site/export.ts';
import { Store } from '../src/site/store.ts';
import plain from '../themes/plain.json';

const theme = parseTheme(plain).theme as Theme;
const site = normalizeSite({ ...DEMO_SITE, url: 'https://example.com' });
const block = (type: string, content: Record<string, unknown>) => normalizeBlocks([{ type, content, children: [] }]).blocks[0] as Block;

describe('a description written by the site (ADR 0057 d1)', () => {
  test('whole sentences when they fill at least half of it', () => {
    const text = 'We bake bread every morning. Our cakes are made to order for weddings, birthdays and every other day worth a cake. Call us.';
    expect(cutAt(text, 50)).toBe('We bake bread every morning.');
    expect(cutAt(text, 120)).toBe('We bake bread every morning. Our cakes are made to order for weddings, birthdays and every other day worth a cake.');
    expect(cutAt('Short.', 160)).toBe('Short.');
  });

  test('whole words and "…" when the first sentence is too long or too short', () => {
    const long = 'A very long sentence that goes on and on without stopping anywhere near the end of what fits';
    expect(cutAt(long, 40)).toBe('A very long sentence that goes on and…');
    expect(cutAt('Hi. A long run of words with no stop at all inside the part that fits', 40)).toBe('Hi. A long run of words with no stop at…');
  });

  test('an entry says its own words when it has no description and no excerpt, cut at 160', () => {
    const words = 'One sentence that is long enough to matter here. '.repeat(6).trim();
    const body = block('text', { body: paragraphs(words) });
    const post = normalizePost({ slug: 'a', title: 'A', date: '2026-11-22', blocks: [body] }).post;
    expect(postDescription(post).length).toBeLessThanOrEqual(160);
    expect(postDescription(post)).toEndWith('matter here.');
    expect(postDescription({ ...post, excerpt: 'Mine.' })).toBe('Mine.');
    expect(postDescription({ ...post, description: 'Said.' })).toBe('Said.');
    expect(blocksText(normalizeBlocks([body]).blocks, 160)).toBe(postDescription(post));
  });

  test('a heading ends as a sentence, so it does not run into the words under it', () => {
    const body = block('text', { body: [{ type: 'heading', level: 2, children: [{ text: 'Three people and a workshop' }] }, ...paragraphs('We started in 2014.'), { type: 'list', ordered: false, items: [[{ text: 'Oak' }], [{ text: 'Ash!' }]] }] });
    const hero = block('hero', { title: 'Made to measure', subtitle: 'Tables: and chairs' });
    expect(describeBlocks([hero, body])).toBe('Made to measure. Tables: and chairs. Three people and a workshop. We started in 2014. Oak. Ash!');
    expect(blocksText([body])).toBe('Three people and a workshop We started in 2014. Oak Ash!');
  });
});

describe('words for a picture from its file name (ADR 0057 d2)', () => {
  test('a name made of words gives them', () => {
    expect(altFromName('sala-de-nunti_2.jpg')).toBe('Sala de nunti');
    expect(altFromName('tort-ciocolata-1024x768.webp')).toBe('Tort ciocolata');
    expect(altFromName('logo@2x.png')).toBe('Logo');
    expect(altFromName('Echipa noastră (2).jpg')).toBe('Echipa noastră');
    expect(altFromName('C:\\Pictures\\photo-of-the-team.jpg')).toBe('Photo of the team');
  });

  test('a name a camera, a phone or a program made gives nothing', () => {
    for (const name of ['IMG_1234.JPG', 'DSC0042.jpg', 'PXL_20241102_123.jpg', 'Screenshot 2024-01-01 at 10.png', 'WhatsApp Image 2024.jpeg', '12345.png', 'image-12.png', 'a8f9c0d1e2b3a4f5.jpg', ''])
      expect(`${name}: ${altFromName(name)}`).toBe(`${name}: `);
  });
});

describe('proving the site is the owner\'s, and robots.txt (ADR 0057 d4, d5)', () => {
  test('a code is taken from the tag it comes in, and nothing else is kept', () => {
    expect(verificationCode('<meta name="google-site-verification" content="abc_DEF-123" />')).toBe('abc_DEF-123');
    expect(verificationCode(' 0123ABCD ')).toBe('0123ABCD');
    expect(verificationCode('"><script>')).toBe('');
    expect(normalizeSite({ verify: { google: 'g1', bing: '<x>' } }).verify).toEqual({ google: 'g1' });
    expect(normalizeSite({ verify: { google: '' } }).verify).toBeUndefined();
  });

  test('the codes are on the home page only', async () => {
    const files = await buildSite({ ...site, verify: { google: 'g1', bing: 'b2' } }, theme, DEMO_PAGES.map((p) => normalizePage(p).page));
    const home = String(files.get('index.html'));
    expect(home).toContain('<meta name="google-site-verification" content="g1">');
    expect(home).toContain('<meta name="msvalidate.01" content="b2">');
    expect(String(files.get('about/index.html'))).not.toContain('site-verification');
  });

  test('only rules of robots.txt are kept, after the program\'s', () => {
    expect(cleanRobots('Disallow: /drafts/\nhello\n<script>\n  User-agent: Googlebot  \nAllow: /x')).toBe('Disallow: /drafts/\nUser-agent: Googlebot\nAllow: /x');
    expect(normalizeSite({ robots: 'nothing here' }).robots).toBeUndefined();
    expect(robotsFile(normalizeSite({ url: 'https://a.example', robots: 'Disallow: /drafts/' }))).toBe('User-agent: *\nAllow: /\nDisallow: /drafts/\n\nSitemap: https://a.example/sitemap.xml\n');
    expect(robotsFile(normalizeSite({}))).toBe('User-agent: *\nAllow: /\n');
  });

  test('the site check says when robots.txt shuts the whole site', () => {
    const shut = (robots: string) => checkSeo(new Map([['robots.txt', robotsFile(normalizeSite({ robots }))]])).some((p) => p.problem === 'blocked');
    expect(shut('Disallow: /')).toBe(true);
    expect(shut('User-agent: Googlebot\nDisallow: /')).toBe(true);
    expect(shut('User-agent: SomeBot\nDisallow: /')).toBe(false);
    expect(shut('Disallow: /drafts/')).toBe(false);
    expect(shut('')).toBe(false);
  });
});

describe('the sitemap says when a page changed and what it shows (ADR 0057 d3)', () => {
  let dir: string;
  let store: Store;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'thecms-'));
    store = await Store.open(join(dir, 'site.db'));
  });
  afterEach(async () => {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  });

  test('the day each page and entry was last published, and the site\'s own pictures', async () => {
    const picture = block('image', { image: { src: '/media/cake.jpg', alt: 'Cake' } });
    const elsewhere = block('image', { image: { src: 'https://cdn.example/x.jpg', alt: 'X' } });
    const pages = [
      { slug: '', title: 'Home', description: '', inMenu: true, blocks: [picture, elsewhere] },
      { slug: 'about', title: 'About', description: '', inMenu: true, blocks: [] },
    ];
    const post = normalizePost({ slug: 'news', title: 'News', date: '2026-11-01', cover: { src: '/media/cover.jpg', alt: '' }, blocks: [] }).post;
    const media = async (name: string) => (name === 'cake.jpg' || name === 'cover.jpg' ? new Uint8Array([1]) : null);
    const files = await buildSite(site, theme, pages, media, [post], [], {}, [], {}, {}, {}, {}, {
      pages: { '': '2026-11-20T10:00:00.000Z' },
      entries: { 'posts/news': '2026-11-21T08:00:00.000Z' },
    });
    const sitemap = String(files.get('sitemap.xml'));
    expect(sitemap).toContain('xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"');
    expect(sitemap).toContain('<url><loc>https://example.com/</loc><lastmod>2026-11-20</lastmod><image:image><image:loc>https://example.com/media/cake.jpg</image:loc></image:image></url>');
    expect(sitemap).toContain('<url><loc>https://example.com/about/</loc></url>');
    expect(sitemap).toContain('<loc>https://example.com/blog/news/</loc><lastmod>2026-11-21</lastmod><image:image><image:loc>https://example.com/media/cover.jpg</image:loc></image:image>');
    expect(sitemap).not.toContain('cdn.example');
  });

  test('without pictures the sitemap names no picture namespace', async () => {
    const files = await buildSite(site, theme, [{ slug: '', title: 'Home', description: '', inMenu: true, blocks: [] }]);
    expect(String(files.get('sitemap.xml'))).toBe('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>https://example.com/</loc></url>\n</urlset>\n');
  });

  test('the store says when each was published', async () => {
    await store.setSite(site);
    await store.publish((await store.savePage({ slug: '', title: 'Home', description: '', inMenu: true, blocks: [] })).slug);
    await store.savePost({ slug: 'news', title: 'News', date: '2026-11-01', blocks: [] });
    await store.publishPost('news');
    const times = await store.publishedTimes();
    expect(times.pages['']).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(times.entries['posts/news']).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('links search engines do not follow (ADR 0057 d6)', () => {
  test('a link field and a span keep the choice, only with an address', () => {
    expect(cleanLink({ label: 'Shop', href: 'https://shop.example', nofollow: true })).toEqual({ label: 'Shop', href: 'https://shop.example', nofollow: true });
    expect(cleanLink({ label: 'Shop', href: '', nofollow: true })).toEqual({ label: 'Shop', href: '' });
    expect(cleanLink({ label: 'Shop', href: '/x/', nofollow: 'yes' })).toEqual({ label: 'Shop', href: '/x/' });
    expect(normalizeRichText([{ type: 'paragraph', children: [{ text: 'a', href: '/x/', nofollow: true }, { text: 'b', nofollow: true }] }])).toEqual([
      { type: 'paragraph', children: [{ text: 'a', href: '/x/', nofollow: true }, { text: 'b' }] },
    ]);
  });

  test('drawn with rel="nofollow"', async () => {
    const html = render(Spans, { props: { spans: [{ text: 'paid', href: 'https://ad.example', nofollow: true }, { text: 'ours', href: '/x/' }] } }).body.replace(/<!--[^>]*-->/g, '');
    expect(html).toContain('<a href="https://ad.example" rel="nofollow">paid</a>');
    expect(html).toContain('<a href="/x/">ours</a>');
    const button = block('buttons', { items: [{ action: { label: 'Buy', href: 'https://ad.example', nofollow: true } }] });
    const files = await buildSite(site, theme, [{ slug: '', title: 'Home', description: '', inMenu: true, blocks: [button] }]);
    expect(String(files.get('index.html'))).toMatch(/<a class="button" href="https:\/\/ad.example" rel="nofollow">/);
  });

  test('the editor reads and writes it', () => {
    const text = (value: string): DomNode => ({ nodeType: 3, nodeName: '#text', textContent: value, childNodes: [] });
    const a = (kids: DomNode[], attrs: Record<string, string>): DomNode => ({ nodeType: 1, nodeName: 'A', textContent: null, childNodes: kids, getAttribute: (n) => attrs[n] ?? null });
    const p: DomNode = { nodeType: 1, nodeName: 'P', textContent: null, childNodes: [a([text('one')], { href: '/x/', rel: 'nofollow' }), a([text('two')], { href: '/x/' })], getAttribute: () => null };
    expect(domToRichText({ nodeType: 1, nodeName: 'DIV', textContent: null, childNodes: [p], getAttribute: () => null })).toEqual([
      { type: 'paragraph', children: [{ text: 'one', href: '/x/', nofollow: true }, { text: 'two', href: '/x/' }] },
    ]);
  });

  test('a WordPress link marked nofollow, sponsored or ugc stays one', () => {
    const ctx: ContentContext = { link: (href) => href, image: (src) => src, attachment: () => null, lost: () => {} };
    const [block] = htmlToBlocks('<p><a href="/a/" rel="sponsored noopener">ad</a> and <a href="/b/">ours</a></p>', ctx);
    expect(JSON.stringify(block?.content)).toContain('{"text":"ad","href":"/a/","nofollow":true}');
    expect(JSON.stringify(block?.content)).toContain('{"text":"ours","href":"/b/"}');
  });
});
