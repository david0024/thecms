import { describe, expect, test } from 'bun:test';
import { blocksText, type ContentType, createBlock, normalizeBlocks, normalizePost, normalizeSite, parseTheme, type Post, postsType, type Theme } from '../src/core/index.ts';
import { renderParts } from '../src/site/document.ts';
import { buildSite } from '../src/site/export.ts';
import plain from '../themes/plain.json';

const theme = parseTheme(plain).theme as Theme;
const site = normalizeSite({ name: 'S', types: [{ name: 'Projects' }, postsType()] });
const projects = site.types[0] as ContentType;
const post = (title: string, date: string, over: Record<string, unknown> = {}): Post => normalizePost({ title, date, blocks: [], ...over }).post;
const list = (content: Record<string, unknown>) => normalizeBlocks([{ type: 'entries', content }]).blocks;
const page = (content: Record<string, unknown>, slug = '') => ({ slug, title: 'Home', description: '', inMenu: true, blocks: list(content) });
const posts = [post('First', '2026-01-01'), post('Second', '2026-02-01', { excerpt: 'About <i>the</i> second.' }), post('Third', '2026-03-01'), post('Fourth', '2026-04-01')];

describe('a block that lists entries', () => {
  test('holds which type and how many, never the entries themselves', async () => {
    expect(createBlock('entries').content).toEqual({ title: 'Latest posts', source: 'posts', count: 3, more: 'See all', related: false });
    expect(list({ source: 'Projects!', count: 400, entries: [{ title: 'smuggled' }] })[0]?.content).toEqual({ title: '', source: 'projects', count: 24, more: '', related: false });
    expect(list({ count: 'many' })[0]?.content).toMatchObject({ source: 'posts', count: 1 });
    expect(list({ count: -5 })[0]?.content.count).toBe(1);
    expect(blocksText(list({ title: 'News', source: 'posts', count: 3 }))).toBe('News');
  });

  test('shows the newest published entries, as many as asked, with a link to the whole list', async () => {
    const files = await buildSite(site, theme, [page({ title: 'News', source: 'posts', count: 2, more: 'All news' })], () => null, posts);
    const home = files.get('index.html') as string;
    const block = home.slice(home.indexOf('b-entries'), home.indexOf('</section>', home.indexOf('b-entries')));
    expect([...block.matchAll(/<h3><a href="([^"]+)">([^<]+)/g)].map((m) => [m[1], m[2]])).toEqual([
      ['/blog/fourth/', 'Fourth'],
      ['/blog/third/', 'Third'],
    ]);
    expect(block).toContain('<a href="/blog/">All news</a>');
    expect(block).toContain('<time datetime="2026-04-01">');
  });

  test('what an author typed is text', async () => {
    const files = await buildSite(site, theme, [page({ source: 'posts', count: 4 })], () => null, posts);
    expect(files.get('index.html') as string).toContain('About &lt;i>the&lt;/i> second.');
  });

  test('another type is listed in its own order, at its own addresses, without dates', async () => {
    const entries = { projects: [post('Zebra', '2026-01-01'), post('Apple', '2025-01-01')] };
    const home = (await buildSite(site, theme, [page({ source: 'projects', count: 5, more: 'All' })], () => null, entries)).get('index.html') as string;
    const block = home.slice(home.indexOf('b-entries'));
    expect(block.indexOf('/projects/apple/')).toBeLessThan(block.indexOf('/projects/zebra/'));
    expect(block.slice(0, block.indexOf('</section>'))).not.toContain('<time');
    expect(block).toContain('<a href="/projects/">All</a>');
  });

  test('with nothing to list, a visitor sees no empty list and no dead link; a type the site does not have is the same', async () => {
    for (const content of [{ title: 'News', source: 'posts', count: 3, more: 'All' }, { title: 'News', source: 'recipes', count: 3, more: 'All' }]) {
      const home = (await buildSite(site, theme, [page(content)], () => null, [])).get('index.html') as string;
      const block = home.slice(home.indexOf('b-entries'), home.indexOf('</section>', home.indexOf('b-entries')));
      expect(block).toContain('<h2>News</h2>');
      expect(block).not.toMatch(/<ul|<a |Nothing has been posted/);
    }
  });

  test('in the editor the author is told why it is empty, and sees drafts once there are some', async () => {
    const empty = renderParts(site, theme, page({ source: 'projects', count: 3 }), [], true, {}).body;
    expect(empty).toContain('Nothing has been posted yet.');
    const filled = renderParts(site, theme, page({ source: 'projects', count: 3 }), [], true, { projects: { type: projects, entries: [post('A draft', '2026-01-01')] } }).body;
    expect(filled).toContain('href="/projects/a-draft/"');
    expect(filled).not.toContain('Nothing has been posted');
  });

  test('a list on an entry\'s own page works the same', async () => {
    const withList = post('Fifth', '2026-05-01', { blocks: [{ type: 'entries', content: { source: 'posts', count: 1 } }] });
    const files = await buildSite(site, theme, [page({})], () => null, [...posts, withList]);
    expect(files.get('blog/first/index.html') as string).not.toContain('b-entries');
    expect(files.get('blog/fifth/index.html') as string).toContain('<h3><a href="/blog/fifth/">Fifth</a></h3>');
    expect(postsType().id).toBe('posts');
  });
});
