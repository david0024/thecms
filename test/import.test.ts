import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Block, normalizeRedirects, normalizeSite, parseTheme, type RichNode, type Theme } from '../src/core/index.ts';
import { type ContentContext, htmlToBlocks } from '../src/import/content.ts';
import { parseHtml, plainText } from '../src/import/html.ts';
import { fetchImage as realFetch, runImport } from '../src/import/run.ts';
import { planImport } from '../src/import/wxr.ts';
import { parseXml, textOf } from '../src/import/xml.ts';
import { buildSite, exportSite } from '../src/site/export.ts';
import { Store } from '../src/site/store.ts';
import plain from '../themes/plain.json';

const theme = parseTheme(plain).theme as Theme;
const WXR = await Bun.file(new URL('./fixtures/wordpress.xml', import.meta.url)).text();
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='), (c) => c.charCodeAt(0));
const plan = () => planImport(WXR, '2026-11-17');

const lost: string[] = [];
const ctx: ContentContext = { link: (href) => href, image: (src) => src, attachment: () => null, lost: (what, which) => void lost.push(which ? `${what}: ${which}` : what) };
const body = (blocks: Block[]): RichNode[] => blocks.flatMap((b) => (b.type === 'text' ? (b.content.body as RichNode[]) : []));
const words = (node: RichNode | undefined): string => (node && 'children' in node ? node.children.map((s) => s.text).join('') : '');

describe('reading XML', () => {
  test('elements, attributes, CDATA and entities', async () => {
    const root = parseXml('<?xml version="1.0"?><!-- note --><a x="1 &amp; 2"><wp:b><![CDATA[<p>raw &amp;</p>]]></wp:b><c>Tom &amp; &#8217;Jerry&#x27;</c><d/></a>');
    expect(root.attrs.x).toBe('1 & 2');
    expect(textOf(root, 'wp:b')).toBe('<p>raw &amp;</p>');
    expect(textOf(root, 'c')).toBe("Tom & ’Jerry'");
    expect(root.children.map((c) => c.name)).toEqual(['wp:b', 'c', 'd']);
  });

  test('a file that is not well formed is refused, with the line', async () => {
    expect(() => parseXml('<a>\n<b>\n</a>')).toThrow('line 3');
    expect(() => parseXml('<a><![CDATA[never')).toThrow('never closed');
    expect(() => parseXml('just words')).toThrow('no element');
  });

  test('an entity the file declares is never resolved', async () => {
    const root = parseXml('<!DOCTYPE a [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><a>&xxe;</a>');
    expect(root.text).toContain('&xxe;');
  });
});

describe('reading HTML', () => {
  test('it never throws, and unclosed or stray tags lose nothing', async () => {
    expect(plainText(parseHtml('<p>one<p>two</div> 1 < 2 <b>three'))).toBe('onetwo 1 < 2 three');
    expect(plainText(parseHtml('<script>if (a<b) alert("</p>")</script>after<!-- gone -->'))).toBe('after');
  });
});

describe('content as blocks', () => {
  beforeEach(() => void (lost.length = 0));

  test('meaning is kept, appearance is not', async () => {
    const blocks = htmlToBlocks('<!-- wp:paragraph --><p style="color:red" class="has-large-font-size">A <strong>bold <em>move</em></strong> and <a href="/x/" onclick="evil()">a link</a></p>', ctx);
    expect(JSON.stringify(blocks)).not.toMatch(/red|large|onclick|evil/);
    expect(body(blocks)[0]).toEqual({
      type: 'paragraph',
      children: [{ text: 'A ' }, { text: 'bold ', marks: ['bold'] }, { text: 'move', marks: ['bold', 'italic'] }, { text: ' and ' }, { text: 'a link', href: '/x/' }],
    });
  });

  test('headings keep their order under the page title; an image splits the text around it', async () => {
    const blocks = htmlToBlocks('<!-- wp:x --><h1>One</h1><h3>Two</h3><h6>Three</h6><p>Before <img src="https://a.example/p.png" alt="P"> after</p><p>More</p>', ctx);
    expect(blocks.map((b) => b.type)).toEqual(['text', 'image', 'text']);
    expect(body(blocks).map((n) => (n.type === 'heading' ? n.level : n.type))).toEqual([2, 3, 4, 'paragraph', 'paragraph']);
  });

  test('classic content: a line break in the text is a line on the page', async () => {
    const blocks = htmlToBlocks('First line\nSecond line\n\nNew paragraph<br>after a break', ctx);
    expect(body(blocks).map(words)).toEqual(['First line', 'Second line', 'New paragraph', 'after a break']);
    // In block content a line break in the source means nothing.
    expect(body(htmlToBlocks('<!-- wp:paragraph --><p>one\ntwo</p>', ctx)).map(words)).toEqual(['one two']);
  });

  test('a script, a form and a player are left out and named; their words do not leak', async () => {
    const blocks = htmlToBlocks('<p>Hi</p><script>steal()</script><form><input name="q"><button>Go</button></form><video src="x.mp4"></video><style>p{}</style>', ctx);
    expect(JSON.stringify(blocks)).not.toMatch(/steal|Go|mp4|p\{\}/);
    expect(lost).toEqual(['scripts', 'forms', expect.stringContaining('embedded media')]);
    lost.length = 0;
    expect(body(htmlToBlocks('<p>In a line <script>steal()</script>too</p>', ctx)).map(words)).toEqual(['In a line too']);
    expect(lost).toEqual(['scripts']);
  });

  test('a shortcode is taken out and named; words in brackets are words', async () => {
    const blocks = htmlToBlocks('Hello [sic] [contact-form-7 id="1"] and [box]inside[/box] [1]', ctx);
    expect(body(blocks).map(words)).toEqual(['Hello [sic] and inside [1]']);
    expect(lost.map((l) => l.split(': ')[1])).toEqual(['contact-form-7', 'box']);
  });

  test('an address that could run script does not survive the site\'s own cleaning', async () => {
    const store = await Store.open(':memory:');
    const page = await store.savePage({ title: 'T', blocks: htmlToBlocks('<p><a href="javascript:alert(1)">x</a></p><img src="javascript:alert(2)">', { ...ctx, image: (src) => src }) });
    expect(JSON.stringify(page)).not.toContain('javascript');
    await store.close();
  });
});

describe('a WordPress export as a plan', () => {
  test('anything else is refused before a site is touched', async () => {
    expect(() => planImport('<rss><channel><title>A feed</title></channel></rss>', '2026-01-01')).toThrow('not a WordPress export');
    expect(() => planImport('not xml at all', '2026-01-01')).toThrow();
  });

  test('pages: the front page is the home page, trash stays behind, private comes as a draft', async () => {
    const { site, pages } = plan();
    expect(site).toEqual({ name: 'Atelier & Co', language: 'en-US', url: 'https://old.example' });
    expect(pages.map((p) => [p.slug, p.title, p.publish])).toEqual([
      ['', 'Home', true],
      ['about', 'About & Team', true],
      ['web', 'Web', true],
      ['secret', 'Secret', false],
    ]);
    expect(pages[1]?.description).toBe('Who we are and how we work.');
  });

  test('posts: date, excerpt, categories and cover; a post with no title or date still comes', async () => {
    const { posts } = plan();
    expect(posts[0]).toMatchObject({
      slug: 'hello-world',
      date: '2024-01-15',
      excerpt: 'A short hello.',
      categories: ['News'],
      cover: { src: 'https://old.example/wp-content/uploads/2024/01/photo.jpg', alt: 'A workbench' },
      publish: true,
    });
    expect(posts[0]?.tags).toEqual(['wood']);
    expect(posts[1]).toMatchObject({ slug: 'post-11', title: 'Untitled', date: '2026-11-17', publish: false, tags: [] });
  });

  test('links inside the old site lead to the new addresses, whatever way they were written', async () => {
    const home = JSON.stringify(plan().pages[0]);
    expect(home).toContain('"href":"/about/"');
    expect(home).toContain('"href":"/blog/hello-world/#more"');
    // An old tag's archive is the same tag's list here.
    expect(JSON.stringify(plan().pages)).toContain('"href":"/blog/tag/wood/"');
    expect(home).toContain('"href":"https://other.example/x"');
  });

  test('images: the full picture is fetched, not the resized copy; pictures elsewhere are left there', async () => {
    const p = plan();
    expect(p.images).toEqual(['https://old.example/wp-content/uploads/2024/01/photo.jpg', 'https://old.example/wp-content/uploads/2024/01/pic2.png']);
    expect(JSON.stringify(p.pages)).not.toMatch(/300x200|150x150/);
    const about = p.pages[1]?.blocks.filter((b) => b.type === 'image').map((b) => b.content) ?? [];
    expect(about[0]).toEqual({ image: { src: 'https://old.example/wp-content/uploads/2024/01/pic2.png', alt: 'Team' }, caption: 'The team in 2012' });
    expect(about).toHaveLength(4);
    // WordPress has the theme print a page's title; here the page carries it.
    expect(p.pages[1]?.blocks[0]).toMatchObject({ type: 'hero', content: { title: 'About & Team' } });
    expect(p.pages[0]?.blocks[0]).toMatchObject({ type: 'hero', content: { title: 'Atelier & Co', subtitle: 'Things made of wood' } });
  });

  test('the menu: pages by name, the posts page as the blog, a category, an outside link; a trashed page is left out', async () => {
    const menu = plan().menu ?? [];
    expect(menu.map((m) => [m.label, m.target, m.children.length])).toEqual([
      ['Start', { kind: 'page', slug: '' }, 0],
      ['', { kind: 'page', slug: 'about' }, 1],
      ['Journal', { kind: 'blog' }, 0],
      ['', { kind: 'url', href: '/blog/category/news/' }, 0],
      ['Shop', { kind: 'url', href: 'https://shop.example/' }, 0],
    ]);
    expect(menu[1]?.children[0]).toMatchObject({ label: 'Web work', target: { kind: 'page', slug: 'web' } });
  });

  test('a block theme\'s menu is read from its navigation blocks', async () => {
    const nav = `<item><title>Navigation</title><link>https://old.example/?p=50</link><content:encoded><![CDATA[<!-- wp:navigation-link {"label":"About <b>us</b>","type":"page","id":3,"url":"https://old.example/about/","kind":"post-type"} /-->
<!-- wp:navigation-submenu {"label":"More","url":"#","kind":"custom"} -->
<!-- wp:navigation-link {"label":"News","url":"https://old.example/blog/","kind":"custom"} /-->
<!-- /wp:navigation-submenu -->]]></content:encoded><wp:post_id>50</wp:post_id><wp:status>publish</wp:status><wp:post_type>wp_navigation</wp:post_type></item>`;
    const withoutClassic = WXR.replace(/<wp:post_type><!\[CDATA\[nav_menu_item\]\]>/g, '<wp:post_type><![CDATA[ignored]]>').replace('</channel>', `${nav}</channel>`);
    const menu = planImport(withoutClassic, '2026-11-17').menu ?? [];
    expect(menu.map((m) => [m.label, m.target])).toEqual([
      ['About us', { kind: 'page', slug: 'about' }],
      ['More', { kind: 'none' }],
    ]);
    expect(menu[1]?.children[0]).toMatchObject({ label: 'News', target: { kind: 'blog' } });
  });

  test('old addresses that changed are remembered; ones that did not are not', async () => {
    expect(plan().redirects).toEqual([
      { from: '/about/web/', to: '/web/' },
      { from: '/2024/01/hello-world/', to: '/blog/hello-world/' },
      { from: '/category/news/', to: '/blog/category/news/' },
      { from: '/tag/wood/', to: '/blog/tag/wood/' },
    ]);
  });

  test('the owner is told what did not come over', async () => {
    const notes = plan().notes.join('\n');
    for (const said of ['2 menus', 'latest-posts', 'column layouts', 'tables', 'contact-form-7', 'scripts', 'embedded media', '"Secret"', 'Links to files', '1 comment not', '"product"', 'sit at the top level']) {
      expect(notes).toContain(said);
    }
    expect(notes).not.toMatch(/\btags?\b[^\n]*not imported/);
    // A link to someone else's site is not a stray link of the old one.
    expect(notes).not.toMatch(/not pages or posts[^\n]*"Home"/);
  });

  test('a site that showed its posts on the front gets a home page, and is told', async () => {
    const p = planImport(WXR.replace('<link>https://old.example/</link>', '<link>https://old.example/home/</link>'), '2026-11-17');
    expect(p.pages.map((x) => x.slug)).toEqual(['', 'home', 'about', 'web', 'secret']);
    expect(p.pages[0]?.blocks.map((b) => b.type)).toEqual(['hero', 'entries']);
    expect(p.pages[0]?.blocks[0]).toMatchObject({ content: { title: 'Atelier & Co', subtitle: 'Things made of wood' } });
    // What the old front page showed.
    expect(p.pages[0]?.blocks[1]).toMatchObject({ content: { source: 'posts', count: 6 } });
    expect(p.notes[0]).toContain('no page set as its front page');
  });
});

describe('kinds of entry a plugin added', () => {
  test('are left out and named, with the way to bring them', async () => {
    const p = plan();
    expect(p.types).toEqual([]);
    expect(p.notes.join('\n')).toContain('run the import again with --types=product');
  });

  test('the ones the owner names come as content types, with their entries, links and old addresses', async () => {
    const p = planImport(WXR, '2026-11-17', { types: ['product', 'revision', 'page', 'nothing-like-this'] });
    expect(p.types.map((t) => [t.id, t.name, t.path])).toEqual([['product', 'Product', 'product']]);
    expect(p.entries.product).toEqual([expect.objectContaining({ slug: 'chair', title: 'Chair', publish: true, categories: [] })]);
    expect(p.notes.join('\n')).not.toContain('"product"');
    // The address did not change, so nothing needs to lead to it.
    expect(p.redirects.some((r) => r.to.startsWith('/product/'))).toBe(false);
  });

  test('carried out, the site has the type and its entries; a second run adds nothing', async () => {
    const store = await Store.open(':memory:');
    await store.setTheme(plain);
    const p = planImport(WXR, '2026-11-17', { types: ['product'] });
    const first = await runImport(store, p, { fetchImage: null, fresh: true });
    expect(first.entries).toBe(1);
    expect((await store.site()).types.map((t) => t.id)).toEqual(['product']);
    expect((await store.publishedEntries('product')).map((e) => e.title)).toEqual(['Chair']);
    const again = await runImport(store, p, { fetchImage: null, fresh: false });
    expect(again).toMatchObject({ entries: 0 });
    expect((await store.site()).types).toHaveLength(1);
    await store.close();
  });
});

describe('carrying the plan out', () => {
  let dir: string;
  let store: Store;
  const fetched: string[] = [];
  const fetchImage = async (url: string): Promise<Uint8Array> => {
    fetched.push(url);
    if (url.endsWith('pic2.png')) throw new Error('the old site answered 404');
    return PNG;
  };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'thecms-import-'));
    store = await Store.open(join(dir, 'site.db'));
    await store.setTheme(plain);
    await store.publishTheme();
    fetched.length = 0;
  });
  afterEach(async () => {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  });

  test('images are copied into the site and the pages point at the copies; one that fails stays where it was and is named', async () => {
    const report = await runImport(store, plan(), { fetchImage, fresh: true });
    expect(report).toMatchObject({ pages: 4, posts: 2, drafts: 2, images: 1, redirects: 4, menu: true });
    expect(fetched.sort()).toHaveLength(2);
    const [stored] = await store.media();
    expect(stored?.label).toBe('photo.jpg');
    expect(JSON.stringify(await store.draft(''))).toContain(stored?.path as string);
    expect((await store.publishedPosts())[0]?.cover?.src).toBe(stored?.path as string);
    expect(JSON.stringify(await store.draft('about'))).toContain('https://old.example/wp-content/uploads/2024/01/pic2.png');
    expect(report.notes.join('\n')).toContain('pic2.png (the old site answered 404)');
    expect(await store.mediaUsedBy(stored?.name as string)).toEqual(['Home', 'About & Team', 'Hello world']);
  });

  test('over a real connection: an image is fetched, a missing one and one too large are refused', async () => {
    const server = Bun.serve({
      port: 0,
      fetch: (request) => {
        const path = new URL(request.url).pathname;
        if (path === '/ok.png') return new Response(PNG);
        if (path === '/huge.png') return new Response(new Uint8Array(11 * 1024 * 1024));
        return new Response('no', { status: 404 });
      },
    });
    try {
      expect(await realFetch(`${server.url}ok.png`)).toEqual(PNG);
      await expect(realFetch(`${server.url}gone.png`)).rejects.toThrow('answered 404');
      await expect(realFetch(`${server.url}huge.png`)).rejects.toThrow('larger than 10 MB');
    } finally {
      await server.stop(true);
    }
  });

  test('a page that is not an image is not stored as one', async () => {
    const report = await runImport(store, plan(), { fetchImage: async () => new TextEncoder().encode('<html>Not found, but 200</html>'), fresh: true });
    expect(report.images).toBe(0);
    expect(await store.media()).toEqual([]);
    expect(report.notes.join('\n')).toContain('not an image this site can show');
  });

  test('what was published is published, what was not is a draft; the site takes the old name, address and menu', async () => {
    await runImport(store, plan(), { fetchImage, fresh: true });
    expect((await store.published()).map((p) => p.slug)).toEqual(['', 'about', 'web']);
    expect((await store.publishedPosts()).map((p) => p.slug)).toEqual(['hello-world']);
    expect(await store.site()).toMatchObject({ name: 'Atelier & Co', language: 'en-US', url: 'https://old.example' });
    expect((await store.site()).menu).toHaveLength(5);
  });

  test('importing again, or into a site already begun, replaces nothing', async () => {
    await store.setSite({ name: 'Mine' });
    await store.savePage({ slug: 'about', title: 'My own about page', blocks: [] });
    const first = await runImport(store, plan(), { fetchImage: null, fresh: false });
    expect(first).toMatchObject({ pages: 3, images: 0, menu: false });
    expect((await store.draft('about'))?.title).toBe('My own about page');
    expect(await store.site()).toMatchObject({ name: 'Mine', menu: null });
    expect(first.notes.join('\n')).toMatch(/2 images were not copied[\s\S]*the page "About & Team"/);
    const again = await runImport(store, plan(), { fetchImage: null, fresh: false });
    expect(again).toMatchObject({ pages: 0, posts: 0, redirects: 0 });
  });

  test('the exported site answers at the old addresses and sends the visitor on', async () => {
    await runImport(store, plan(), { fetchImage, fresh: true });
    const out = join(dir, 'out');
    const files = await exportSite(store, out);
    expect(files).toContain('2024/01/hello-world/index.html');
    expect(files).toContain('about/web/index.html');
    const old = await Bun.file(join(out, '2024/01/hello-world/index.html')).text();
    expect(old).toContain('<meta http-equiv="refresh" content="0; url=/blog/hello-world/">');
    expect(old).toContain('<link rel="canonical" href="https://old.example/blog/hello-world/">');
    expect(await Bun.file(join(out, 'sitemap.xml')).text()).not.toContain('2024/01');
    expect(await Bun.file(join(out, 'blog/hello-world/index.html')).text()).toContain('First <strong>post</strong>.');
    expect(await Bun.file(join(out, 'index.html')).text()).toContain('href="/about/"');
  });
});

describe('old addresses', () => {
  test('only a path a file can safely be written at is kept', async () => {
    const cleaned = normalizeRedirects([
      { from: '/old', to: '/new/' },
      { from: '/old/', to: '/other/' },
      { from: '/a/../../etc/', to: '/x/' },
      { from: '/.git/', to: '/x/' },
      { from: '/q/?p=1', to: '/x/' },
      { from: 'https://evil.example/', to: '/x/' },
      { from: '/out/', to: 'https://evil.example/' },
      { from: '/out/', to: '//evil.example/' },
      { from: '/same/', to: '/same/' },
      { from: '/', to: '/x/' },
      { from: '/page.html', to: '/page/#part' },
      'nonsense',
    ]);
    expect(cleaned).toEqual([
      { from: '/old/', to: '/new/' },
      { from: '/page.html', to: '/page/#part' },
    ]);
  });

  test('an old address never replaces a page that lives there, and never leads to one that is not published', async () => {
    const site = normalizeSite({ name: 'S', url: 'https://example.com' });
    const pages = [
      { slug: '', title: 'Home', description: '', inMenu: true, blocks: [] },
      { slug: 'about', title: 'About', description: '', inMenu: true, blocks: [] },
    ];
    const files = await buildSite(site, theme, pages, () => null, [], normalizeRedirects([
      { from: '/about/', to: '/' },
      { from: '/gone/', to: '/nowhere/' },
      { from: '/was/', to: '/about/' },
    ]));
    expect(files.get('about/index.html') as string).toContain('aria-current="page"');
    expect(files.has('gone/index.html')).toBe(false);
    expect(files.get('was/index.html') as string).toContain('url=/about/');
  });
});

describe('a category that is a section of its own (ADR 0016)', () => {
  const chosen = (categories: string[], xml = WXR) => planImport(xml, '2026-11-17', { categories });

  test('the categories posts were filed under are offered, with how many posts each holds', () => {
    expect(plan().categories).toEqual([{ nicename: 'news', name: 'News', count: 1 }]);
  });

  test('a chosen category becomes a dated type; its posts leave the blog and become its entries', () => {
    const p = chosen(['news', 'uncategorized', 'nothing-like-this']);
    expect(p.types.map((t) => [t.id, t.name, t.path, t.dated, t.feed, t.categories])).toEqual([['news', 'News', 'news', true, true, false]]);
    expect(p.entries.news).toEqual([expect.objectContaining({ slug: 'hello-world', date: '2024-01-15', categories: [] })]);
    expect(p.posts.map((post) => post.slug)).toEqual(['post-11']);
    // The list of categories stays the same, so a screen can offer to undo the choice.
    expect(p.categories).toEqual(plan().categories);
  });

  test('links, the menu and old addresses lead to the new section', () => {
    const p = chosen(['news']);
    expect(JSON.stringify(p.pages[0])).toContain('"href":"/news/hello-world/#more"');
    expect((p.menu ?? []).map((m) => m.target)).toContainEqual({ kind: 'url', href: '/news/' });
    expect(p.redirects).toContainEqual({ from: '/2024/01/hello-world/', to: '/news/hello-world/' });
    expect(p.redirects).toContainEqual({ from: '/category/news/', to: '/news/' });
    expect(p.redirects.some((r) => r.to.startsWith('/blog/category/'))).toBe(false);
    const linked = chosen(['news'], WXR.replace('href="https://old.example/about/"', 'href="https://old.example/category/news/"'));
    expect(JSON.stringify(linked.pages[0])).toContain('"href":"/news/"');
  });

  test("a post's other categories are named as lost", () => {
    const twice = WXR.replace('<category domain="category" nicename="news"><![CDATA[News]]></category>', '<category domain="category" nicename="news"><![CDATA[News]]></category><category domain="category" nicename="events"><![CDATA[Events]]></category>');
    expect(chosen(['news'], twice).notes.join('\n')).toContain('lost their other categories');
    const alone = WXR.replace('<category domain="post_tag" nicename="wood"><![CDATA[wood]]></category>', '');
    expect(chosen(['news'], alone).notes.join('\n')).not.toContain('lost their other categories');
    expect(chosen(['news']).notes.join('\n')).toContain('lost their other categories and their tags');
  });

  test('carried out, the site has the section and its entries', async () => {
    const store = await Store.open(':memory:');
    await store.setTheme(plain);
    const report = await runImport(store, chosen(['news']), { fetchImage: null, fresh: true });
    expect(report).toMatchObject({ posts: 1, entries: 1 });
    expect((await store.site()).types.map((t) => [t.id, t.dated])).toEqual([['news', true]]);
    expect((await store.publishedEntries('news')).map((e) => e.title)).toEqual(['Hello world']);
    await store.close();
  });
});
