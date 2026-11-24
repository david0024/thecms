import { describe, expect, test } from 'bun:test';
import { automaticMenu, holdsCurrent, isMega, menuLeadsAway, type MenuNode, normalizeMenu, normalizePage, normalizeSite, parseTheme, resolveMenu, type Theme, themeCss } from '../src/core/index.ts';
import { DEMO_SITE } from '../src/site/demo.ts';
import { menuOf, renderPage } from '../src/site/document.ts';
import { buildSite } from '../src/site/export.ts';
import plain from '../themes/plain.json';

const theme = parseTheme(plain).theme as Theme;
const pages = [
  { slug: '', title: 'Home', inMenu: true },
  { slug: 'about', title: 'About', inMenu: true },
  { slug: 'hidden', title: 'Hidden', inMenu: false },
];
const node = (label: string, target: MenuNode['target'], children: MenuNode[] = []): MenuNode => ({ id: `n-${label || 'x'}-${children.length}`, label, target, children });
const siteWith = (menu: unknown) => normalizeSite({ ...DEMO_SITE, menu });
const titles = (links: { title: string; href: string; children: unknown[] }[]): string => links.map((l) => `${l.title}→${l.href || '-'}`).join(' ');

describe('the menu as a document', () => {
  test('no menu means the site makes one; anything that is not a list is no menu', async () => {
    for (const input of [undefined, null, 'menu', { items: [] }]) expect(normalizeMenu(input)).toBeNull();
    expect(normalizeMenu([])).toEqual([]);
    expect(normalizeSite({ name: 'Old site' }).menu).toBeNull();
  });

  test('items are cleaned: labels cut, addresses checked, ids unique, three levels and twelve items at most', async () => {
    const deep = { label: 'L1', children: [{ label: 'L2', children: [{ label: 'L3', children: [{ label: 'L4' }] }] }] };
    const menu = normalizeMenu([
      { id: 'same', label: '  Two   words ', target: { kind: 'url', href: 'javascript:alert(1)' } },
      { id: 'same', label: 'x'.repeat(100), target: { kind: 'page', slug: 'About Us!' } },
      { target: { kind: 'nonsense' } },
      'not an item',
      deep,
      ...Array(20).fill({ label: 'more' }),
    ]) as MenuNode[];
    expect(menu).toHaveLength(12);
    expect(menu[0]).toMatchObject({ id: 'same', label: 'Two words', target: { kind: 'url', href: '' } });
    expect(menu[1]?.id).not.toBe('same');
    expect(menu[1]).toMatchObject({ target: { kind: 'page', slug: 'about-us' } });
    expect(menu[1]?.label).toHaveLength(60);
    expect(menu[2]?.target).toEqual({ kind: 'none' });
    expect(menu[3]?.children[0]?.children[0]).toMatchObject({ label: 'L3', children: [] });
  });
});

describe('from the menu to links', () => {
  test('the automatic menu: the pages that asked to be in it, in order, then the blog when there are posts', async () => {
    expect(titles(resolveMenu(siteWith(null), pages, false))).toBe('Home→/ About→/about/');
    expect(titles(resolveMenu(siteWith(null), pages, true))).toBe('Home→/ About→/about/ Blog→/blog/');
    expect(automaticMenu(siteWith(null), pages, true).map((n) => n.target.kind)).toEqual(['page', 'page', 'type']);
  });

  test('an arranged menu is drawn in its own order, with its own words, and may show a page the automatic one hides', async () => {
    const site = siteWith([node('', { kind: 'page', slug: 'about' }), node('Start', { kind: 'page', slug: '' }), node('', { kind: 'page', slug: 'hidden' }), node('Shop', { kind: 'url', href: 'https://shop.example' })]);
    expect(titles(resolveMenu(site, pages, false))).toBe('About→/about/ Start→/ Hidden→/hidden/ Shop→https://shop.example');
  });

  test('an item never leads to what is not there', async () => {
    const site = siteWith([
      node('Gone', { kind: 'page', slug: 'deleted' }, [node('Under gone', { kind: 'page', slug: 'about' })]),
      node('', { kind: 'type', id: 'posts' }),
      node('No address yet', { kind: 'url', href: '' }),
      node('Empty heading', { kind: 'none' }),
      node('', { kind: 'url', href: '/x/' }),
      node('Heading', { kind: 'none' }, [node('', { kind: 'page', slug: 'deleted' }), node('', { kind: 'page', slug: 'about' })]),
    ]);
    const links = resolveMenu(site, pages, false);
    expect(titles(links)).toBe('Heading→-');
    expect(titles(links[0]?.children ?? [])).toBe('About→/about/');
    // The same menu once the blog has a post.
    expect(titles(resolveMenu(site, pages, true))).toBe('Blog→/blog/ Heading→-');
  });

  test('an item is a wide menu when what is under it has links of its own', async () => {
    const small = resolveMenu(siteWith([node('Small', { kind: 'none' }, [node('', { kind: 'page', slug: 'about' })])]), pages, false)[0];
    const wide = resolveMenu(siteWith([node('Wide', { kind: 'none' }, [node('Col', { kind: 'none' }, [node('', { kind: 'page', slug: 'about' })])])]), pages, false)[0];
    expect(small && isMega(small)).toBe(false);
    expect(wide && isMega(wide)).toBe(true);
    expect(wide && holdsCurrent(wide, '/about/')).toBe(true);
    expect(wide && holdsCurrent(wide, '/')).toBe(false);
  });
});

describe('the menu on the page', () => {
  const page = normalizePage({ slug: 'about', title: 'About', blocks: [] }).page;
  const site = siteWith([
    node('', { kind: 'page', slug: '' }),
    node('More', { kind: 'page', slug: 'about' }, [node('Elsewhere', { kind: 'url', href: 'https://example.org/' })]),
    node('Wide <b>', { kind: 'none' }, [node('Column', { kind: 'none' }, [node('', { kind: 'page', slug: 'about' })]), node('', { kind: 'page', slug: 'hidden' })]),
  ]);
  // Compared without the spaces between tags, which mean nothing here.
  const flat = (markup: string): string => markup.replace(/>\s+</g, '><');
  const html = flat(renderPage(site, theme, page, menuOf(site, pages, false)));

  test('a plain item is a link; the page being shown is marked', async () => {
    expect(html).toContain('<li><a href="/">Home</a></li>');
    expect(html).toContain('<a href="/about/" aria-current="page">');
  });

  test('an item that holds others opens without script, and its own page is the first link inside', async () => {
    expect(html).toContain('<li><details name="site-menu"><summary class="current">More</summary><div class="sub"><ul><li><a href="/about/" aria-current="page">More</a></li><li><a href="https://example.org/">Elsewhere</a></li></ul></div></details></li>');
    expect(html).not.toContain('<script');
  });

  test('a wide menu has a column for each sub-item; what the owner typed is text', async () => {
    expect(html).toContain('<li class="mega"><details name="site-menu"><summary class="current">Wide &lt;b></summary>');
    expect(html).toContain('<div class="col"><p class="col-title">Column</p><ul><li><a href="/about/" aria-current="page">About</a></li></ul></div>');
    expect(html).toContain('<div class="col"><p class="col-title"><a href="/hidden/">Hidden</a></p></div>');
  });

  test('a menu button for narrow screens is there whenever there is a menu, and it is a labelled checkbox', async () => {
    expect(html).toContain('<input class="menu-check" type="checkbox" id="site-menu" aria-label="Menu"/><label class="menu-button" for="site-menu">Menu</label>');
    const lone = flat(renderPage(normalizeSite({ name: 'One page', menu: null }), theme, page, []));
    expect(lone).not.toContain('menu-check');
  });

  test('a menu of one page besides the home page is drawn; a menu of the home page alone is not', async () => {
    const one = normalizeSite({ name: 'Docs only', menu: null });
    const drawn = flat(renderPage(one, theme, page, [{ title: 'Documentation', href: '/docs/', children: [] }]));
    expect(drawn).toContain('<ul class="menu"><li><a href="/docs/">Documentation</a></li></ul>');
    const homeOnly = flat(renderPage(one, theme, page, [{ title: 'Home', href: '/', children: [] }]));
    expect(homeOnly).not.toContain('class="menu"');
    expect(menuLeadsAway([{ title: 'Acasă', href: '/ro/', children: [] }], '/ro/')).toBe(false);
    expect(menuLeadsAway([{ title: 'Documentație', href: '/ro/documentatie/', children: [] }], '/ro/')).toBe(true);
  });

  test('in the export an item for a page that is not published is left out', async () => {
    const published = [normalizePage({ slug: '', title: 'Home' }).page];
    const files = await buildSite(siteWith([node('', { kind: 'page', slug: '' }), node('', { kind: 'page', slug: 'about' }), node('Out', { kind: 'url', href: 'https://example.org/' })]), theme, published);
    const home = (files.get('index.html') as string).split('</header>')[0] as string;
    expect(home).toContain('<a href="https://example.org/">Out</a>');
    expect(home).not.toContain('href="/about/"');
  });

  test('the theme styles the panel, and only through the stylesheet', async () => {
    const styled = parseTheme({ ...plain, layout: { menu: { style: { background: { token: 'primary' }, radius: { value: '0' } } } } }).theme as Theme;
    expect(themeCss(styled)).toContain('.site-header .sub{background-color:var(--t-color-primary);border-radius:0}');
    expect(flat(renderPage(site, styled, page, menuOf(site, pages, false)))).toBe(html);
    expect(parseTheme({ ...plain, layout: { menu: { arrangement: 'inline' } } }).theme).toBeNull();
  });
});
