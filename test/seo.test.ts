/** Search engines and sharing (ADR 0050). */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  cleanSeo,
  entryTrail,
  listTrail,
  normalizePage,
  normalizePost,
  normalizeSite,
  parseTheme,
  postsType,
  type Theme,
  translatedPage,
} from '../src/core/index.ts';
import { planImport } from '../src/import/wxr.ts';
import { checkSeo, describeCheck } from '../src/site/check.ts';
import { renderBlogList, renderPage, renderPost } from '../src/site/document.ts';
import { buildSite } from '../src/site/export.ts';
import { searchIndex } from '../src/site/search.ts';
import { Store } from '../src/site/store.ts';
import plain from '../themes/plain.json';

const theme = parseTheme(plain).theme as Theme;
const site = normalizeSite({ name: 'Atelier', language: 'en', url: 'https://example.com' });
const page = (input: Record<string, unknown>) => normalizePage({ inMenu: true, blocks: [], ...input }).page;
const post = (input: Record<string, unknown>) => normalizePost({ date: '2026-03-04', blocks: [], ...input }).post;
const head = (html: string): string => html.slice(0, html.indexOf('</head>'));
const graphOf = (html: string): Record<string, unknown>[] =>
  (JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/.exec(html)?.[1] ?? '{"@graph":[]}') as { '@graph': Record<string, unknown>[] })['@graph'];

describe('what a page or an entry says besides its title (d1)', () => {
  test('only what is set is kept, cleaned', () => {
    expect(cleanSeo({ seoTitle: '  Oak benches  ', shareImage: { src: '/media/a.jpg', alt: 'A' }, noindex: true })).toEqual({ seoTitle: 'Oak benches', shareImage: { src: '/media/a.jpg', alt: 'A' }, noindex: true });
    expect(cleanSeo({ seoTitle: ' ', shareImage: { src: 'javascript:alert(1)' }, noindex: 'yes' })).toEqual({});
    expect(cleanSeo(null)).toEqual({});
    expect(cleanSeo({ seoTitle: 'x'.repeat(200) }).seoTitle).toHaveLength(70);
    expect(page({ slug: 'about', title: 'About', seoTitle: 'Who we are', noindex: true })).toMatchObject({ seoTitle: 'Who we are', noindex: true });
    expect(page({ slug: 'about', title: 'About' })).not.toHaveProperty('seoTitle');
    expect(post({ slug: 'oak', title: 'Oak', shareImage: { src: '/media/oak.jpg', alt: '' } }).shareImage).toEqual({ src: '/media/oak.jpg', alt: '' });
  });

  test("the site keeps its picture, and the breadcrumbs only when they are turned off (d2, d4)", () => {
    expect(normalizeSite({ shareImage: { src: '/media/s.jpg', alt: '' }, breadcrumbs: false })).toMatchObject({ shareImage: { src: '/media/s.jpg', alt: '' }, breadcrumbs: false });
    const bare = normalizeSite({ breadcrumbs: true, shareImage: { src: '' } });
    expect(bare).not.toHaveProperty('breadcrumbs');
    expect(bare).not.toHaveProperty('shareImage');
  });

  test('a title for search engines is the whole title, of the tab and of the preview', () => {
    const html = head(renderPage(site, theme, page({ slug: 'about', title: 'About', seoTitle: 'Oak & ash, made to last' }), []));
    expect(html).toContain('<title>Oak &amp; ash, made to last</title>');
    expect(html).toContain('<meta property="og:title" content="Oak &amp; ash, made to last">');
    expect(head(renderPage(site, theme, page({ slug: 'about', title: 'About' }), []))).toContain('<title>About · Atelier</title>');
    const entry = head(renderPost(site, theme, post({ slug: 'oak', title: 'Oak', seoTitle: 'Why oak lasts' }), []));
    expect(entry).toContain('<title>Why oak lasts</title>');
  });

  test("the picture of a preview: the page's, then the cover, then the site's (d2)", () => {
    const shared = normalizeSite({ ...site, shareImage: { src: '/media/site.jpg', alt: '' } });
    expect(head(renderPage(shared, theme, page({ slug: 'a', title: 'A' }), []))).toContain('<meta property="og:image" content="https://example.com/media/site.jpg">');
    expect(head(renderPage(shared, theme, page({ slug: 'a', title: 'A', shareImage: { src: 'https://cdn.example/a.jpg', alt: '' } }), []))).toContain('content="https://cdn.example/a.jpg"');
    const cover = { src: '/media/cover.jpg', alt: '' };
    expect(head(renderPost(shared, theme, post({ slug: 'o', title: 'O', cover }), []))).toContain('content="https://example.com/media/cover.jpg"');
    expect(head(renderPost(shared, theme, post({ slug: 'o', title: 'O', cover, shareImage: { src: '/media/share.jpg', alt: '' } }), []))).toContain('content="https://example.com/media/share.jpg"');
    expect(head(renderPage(shared, theme, page({ slug: 'a', title: 'A' }), []))).toContain('<meta name="twitter:card" content="summary_large_image">');
    const none = head(renderPage(site, theme, page({ slug: 'a', title: 'A' }), []));
    expect(none).toContain('<meta name="twitter:card" content="summary">');
    expect(none).not.toContain('og:image');
  });

  test('a hidden page tells search engines so (d3)', () => {
    expect(head(renderPage(site, theme, page({ slug: 'a', title: 'A', noindex: true }), []))).toContain('<meta name="robots" content="noindex">');
    expect(head(renderPost(site, theme, post({ slug: 'o', title: 'O', noindex: true }), []))).toContain('<meta name="robots" content="noindex">');
    expect(head(renderPage(site, theme, page({ slug: 'a', title: 'A' }), []))).not.toContain('noindex');
  });
});

describe('translations (d1)', () => {
  const two = normalizeSite({ ...site, languages: ['ro'] });
  test("a translation has its own title for search engines, or the main page's only while it has the main title", () => {
    const main = page({ slug: 'about', title: 'About', seoTitle: 'About the workshop', noindex: true, shareImage: { src: '/media/a.jpg', alt: '' }, translations: { ro: { title: '', fields: {} } } });
    expect(translatedPage(two, main, 'ro')).toMatchObject({ seoTitle: 'About the workshop', noindex: true, shareImage: { src: '/media/a.jpg', alt: '' } });
    const titled = page({ ...main, translations: { ro: { title: 'Despre', fields: {} } } });
    expect(translatedPage(two, titled, 'ro')).not.toHaveProperty('seoTitle');
    const own = page({ ...main, translations: { ro: { title: 'Despre', seoTitle: 'Despre atelier', fields: {} } } });
    expect(translatedPage(two, own, 'ro')?.seoTitle).toBe('Despre atelier');
  });
});

describe('breadcrumbs (d4)', () => {
  const type = postsType();
  test('an entry: home, its list, its first category, itself; a list: home, the list, the category', () => {
    expect(entryTrail('Home', type, post({ slug: 'oak', title: 'Oak', categories: ['Wood', 'Trees'] })).map((c) => c.href)).toEqual(['/', '/blog/', '/blog/category/wood/', '/blog/oak/']);
    expect(entryTrail('Home', { ...type, categories: false }, post({ slug: 'oak', title: 'Oak', categories: ['Wood'] })).map((c) => c.name)).toEqual(['Home', 'Blog', 'Oak']);
    expect(listTrail('Home', type, 'Blog', '/blog/page/2/').map((c) => c.name)).toEqual(['Home', 'Blog']);
    expect(listTrail('Home', type, '#oak', '/blog/tag/oak/').map((c) => c.name)).toEqual(['Home', 'Blog', '#oak']);
    expect(listTrail('Home', type, 'Wood', '/blog/category/wood/').map((c) => c.href)).toEqual(['/', '/blog/', '/blog/category/wood/']);
  });

  test('shown above the entry and said to search engines; turned off, only said', () => {
    const entry = post({ slug: 'oak', title: 'Oak', categories: ['Wood'] });
    const shown = renderPost(site, theme, entry, []);
    expect(shown).toContain('<nav class="b crumbs" aria-label="Where you are">');
    expect(shown).toContain('<a href="/blog/category/wood/">Wood</a>');
    expect(shown).toContain('<span aria-current="page">Oak</span>');
    const crumbs = graphOf(shown).find((d) => d['@type'] === 'BreadcrumbList') as { itemListElement: { item: string }[] };
    expect(crumbs.itemListElement.map((i) => i.item)).toEqual(['https://example.com/', 'https://example.com/blog/', 'https://example.com/blog/category/wood/', 'https://example.com/blog/oak/']);
    const off = renderPost(normalizeSite({ ...site, breadcrumbs: false }), theme, entry, []);
    expect(off).not.toContain('class="b crumbs"');
    expect(graphOf(off).some((d) => d['@type'] === 'BreadcrumbList')).toBe(true);
    const list = renderBlogList(site, { heading: 'Wood', path: '/blog/category/wood/', posts: [entry] }, []);
    expect(list).toContain('<a href="/blog/">Blog</a>');
    expect(graphOf(list)[0]).toMatchObject({ '@type': 'BreadcrumbList' });
    expect(renderBlogList(normalizeSite({ ...site, breadcrumbs: false }), { heading: 'Blog', path: '/blog/', posts: [] }, [])).not.toContain('class="b crumbs"');
  });

  test('a page has none', () => {
    expect(renderPage(site, theme, page({ slug: 'about', title: 'About' }), [])).not.toContain('crumbs');
  });
});

describe('hidden everywhere (d3)', () => {
  test('not in the sitemap, not found by search; still published', async () => {
    const pages = [page({ slug: '', title: 'Home' }), page({ slug: 'thanks', title: 'Thanks for your order', noindex: true, blocks: [{ id: 'b_1', type: 'text', content: { body: [{ type: 'paragraph', children: [{ text: 'thanks' }] }] } }] })];
    const files = await buildSite(site, theme, pages, () => null, [post({ slug: 'draftish', title: 'Draftish', noindex: true }), post({ slug: 'oak', title: 'Oak' })]);
    const sitemap = files.get('sitemap.xml') as string;
    expect(sitemap).not.toContain('/thanks/');
    expect(sitemap).not.toContain('/draftish/');
    expect(sitemap).toContain('https://example.com/blog/oak/');
    expect(files.has('thanks/index.html')).toBe(true);
    expect(searchIndex(files).map((d) => d.path)).not.toContain('/thanks/');
    expect(searchIndex(files).map((d) => d.path)).toContain('/blog/oak/');
  });
});

describe('the site check (d5)', () => {
  const html = (title: string, extra = '', lang = 'en') => `<!doctype html>\n<html lang="${lang}">\n<head>\n<title>${title}</title>${extra}\n</head><body></body></html>`;
  test('a long title, a title shared, a hidden home page', () => {
    const files = new Map<string, string>([
      ['index.html', html('Atelier', '<meta name="robots" content="noindex">')],
      ['ro/index.html', html('Atelier', '', 'ro')],
      ['about/index.html', html('About · Atelier')],
      ['team/index.html', html('About · Atelier')],
      ['blog/index.html', html('Blog · Atelier')],
      ['blog/page/2/index.html', html('Blog · Atelier')],
      ['long/index.html', html(`${'Very long words '.repeat(5)}&amp; more`)],
      ['old/index.html', html('About · Atelier', '<meta http-equiv="refresh" content="0; url=/about/">')],
      ['secret/index.html', html('About · Atelier', '<meta name="uhlaka-locked" content="secret">')],
      ['hidden/index.html', html('About · Atelier', '<meta name="robots" content="noindex">')],
    ]);
    const found = checkSeo(files);
    expect(found).toEqual([
      { problem: 'hidden', pages: ['/'] },
      { problem: 'duplicate', pages: ['/about/', '/team/'], title: 'About · Atelier' },
      { problem: 'long', pages: ['/long/'], title: `${'Very long words '.repeat(5)}& more` },
    ]);
    const { warnings } = describeCheck({ broken: [], unnamed: [], seo: found });
    expect(warnings).toEqual([
      '/: the home page is hidden from search engines',
      '/about/, /team/: share the title "About · Atelier"; give each its own',
      `/long/: the title "${'Very long words '.repeat(5)}& more" is longer than 60 letters; search engines cut it`,
    ]);
  });
});

describe('the picture for sharing is a picture the site uses', () => {
  let dir: string;
  let store: Store;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'uhlaka-seo-'));
    store = await Store.open(join(dir, 'site.db'));
  });
  afterEach(async () => {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  });

  test("a translation keeps the title for search engines it was given, and only a title of its own", async () => {
    await store.setSite(normalizeSite({ ...site, languages: ['ro'] }));
    await store.savePage({ slug: 'about', title: 'About', description: '', inMenu: true, blocks: [], seoTitle: 'About the workshop' });
    await store.translate('about', 'ro');
    await store.saveTranslation('about', 'ro', { ...(await store.locate('ro/about'))! });
    expect((await store.draft('about'))?.translations?.ro).not.toHaveProperty('seoTitle');
    await store.saveTranslation('about', 'ro', { ...(await store.locate('ro/about'))!, title: 'Despre', seoTitle: 'Despre atelier' });
    expect((await store.draft('about'))?.translations?.ro?.seoTitle).toBe('Despre atelier');
    expect((await store.locate('ro/about'))?.seoTitle).toBe('Despre atelier');
  });

  test('it is exported with the site, and not deleted while used', async () => {
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='), (c) => c.charCodeAt(0));
    const one = await store.addMedia(png, 'one.png', true);
    const two = await store.addMedia(Uint8Array.from([...png, 0]), 'two.png', true);
    await store.setSite({ ...site, shareImage: { src: two.path, alt: '' } });
    await store.savePage({ slug: '', title: 'Home', description: '', inMenu: true, blocks: [], shareImage: { src: one.path, alt: '' } });
    expect(await store.mediaUsedBy(one.name)).toEqual(['Home']);
    expect(await store.mediaUsedBy(two.name)).toEqual(['the picture for sharing, in Settings']);
    const pages = [page({ slug: '', title: 'Home', shareImage: { src: one.path, alt: '' } })];
    const files = await buildSite(await store.site(), theme, pages, async (name) => (await store.mediaFile(name))?.bytes ?? null);
    expect(files.has(one.path.slice(1))).toBe(true);
    expect(files.has(two.path.slice(1))).toBe(true);
  });
});

describe('an imported WordPress site keeps its SEO (d6)', () => {
  const item = (id: number, type: string, slug: string, meta: Record<string, string>) => `
  <item>
    <title><![CDATA[Item ${id}]]></title>
    <content:encoded><![CDATA[<p>Words</p>]]></content:encoded>
    <wp:post_id>${id}</wp:post_id>
    <wp:post_date><![CDATA[2024-01-15 10:30:00]]></wp:post_date>
    <wp:post_name><![CDATA[${slug}]]></wp:post_name>
    <wp:status><![CDATA[publish]]></wp:status>
    <wp:post_parent>0</wp:post_parent>
    <wp:post_type><![CDATA[${type}]]></wp:post_type>
    ${Object.entries(meta).map(([k, v]) => `<wp:postmeta><wp:meta_key><![CDATA[${k}]]></wp:meta_key><wp:meta_value><![CDATA[${v}]]></wp:meta_value></wp:postmeta>`).join('')}
  </item>`;
  test("the title for search engines and the choice to hide, from Yoast, Rank Math, All in One SEO and SEOPress", () => {
    const wxr = `<?xml version="1.0"?><rss xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:wp="http://wordpress.org/export/1.2/" xmlns:excerpt="http://wordpress.org/export/1.2/excerpt/"><channel><title>Old</title><link>https://old.example</link><wp:wxr_version>1.2</wp:wxr_version>
      ${item(1, 'page', 'yoast', { _yoast_wpseo_title: 'Oak &amp; ash', '_yoast_wpseo_meta-robots-noindex': '1' })}
      ${item(2, 'page', 'formula', { _yoast_wpseo_title: '%%title%% %%sep%% %%sitename%%' })}
      ${item(3, 'post', 'rank', { rank_math_title: 'Rank title', rank_math_robots: 'a:1:{i:0;s:7:"noindex";}' })}
      ${item(4, 'post', 'aio', { _aioseop_noindex: 'on' })}
      ${item(5, 'post', 'press', { _seopress_robots_index: 'yes', _seopress_titles_title: 'Press' })}
      </channel></rss>`;
    const plan = planImport(wxr, '2026-11-21');
    const bySlug = Object.fromEntries([...plan.pages, ...plan.posts].map((p) => [{ 'Item 1': 'yoast', 'Item 2': 'formula', 'Item 3': 'rank', 'Item 4': 'aio', 'Item 5': 'press' }[p.title], p]));
    expect(bySlug.yoast).toMatchObject({ seoTitle: 'Oak & ash', noindex: true });
    expect(bySlug.formula).not.toHaveProperty('seoTitle');
    expect(bySlug.formula).not.toHaveProperty('noindex');
    expect(bySlug.rank).toMatchObject({ seoTitle: 'Rank title', noindex: true });
    expect(bySlug.aio).toMatchObject({ noindex: true });
    expect(bySlug.press).toMatchObject({ seoTitle: 'Press', noindex: true });
  });
});
