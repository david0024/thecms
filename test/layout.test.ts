import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_LAYOUT, normalizePage, normalizeSite, parseTheme, type Theme, themeCss } from '../src/core/index.ts';
import { DEMO_PAGES, DEMO_SITE } from '../src/site/demo.ts';
import { renderParts } from '../src/site/document.ts';
import { buildSite, exportSite } from '../src/site/export.ts';
import { Store } from '../src/site/store.ts';
import plain from '../themes/plain.json';
import studio from '../themes/studio.json';

const themeOf = (input: unknown): Theme => parseTheme(input).theme as Theme;
const withLayout = (layout: unknown): ReturnType<typeof parseTheme> => parseTheme({ ...plain, layout });
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='), (c) => c.charCodeAt(0));

describe('the layout of the header and footer is part of the theme', () => {
  test('a theme file written before there was a layout still loads, with the default', () => {
    expect('layout' in plain).toBe(false);
    expect(themeOf(plain).layout).toEqual(DEFAULT_LAYOUT);
  });

  test('a layout is checked like the rest of a theme: one bad value refuses the whole document', () => {
    const bad: [unknown, string][] = [
      [{ header: { arrangement: 'sideways' } }, 'layout.header.arrangement'],
      [{ footer: { arrangement: 'stacked' } }, 'layout.footer.arrangement'],
      [{ header: { sticky: 'yes' } }, 'layout.header.sticky'],
      [{ header: { style: { background: { value: 'url(https://evil.example)' } } } }, 'layout.header.style.background'],
      [{ header: { style: { background: { token: 'no-such-colour' } } } }, 'layout.header.style.background'],
      [{ sidebar: {} }, 'layout.sidebar'],
      ['centered', 'layout'],
    ];
    for (const [layout, path] of bad) {
      const { theme, issues } = withLayout(layout);
      expect(theme).toBeNull();
      expect(issues.map((i) => i.path)).toContain(path);
    }
  });

  test('the stylesheet carries the arrangement, the pinning and the style', () => {
    const { theme } = withLayout({
      header: { arrangement: 'centered', sticky: true, style: { background: { token: 'surface' }, paddingBlock: { value: '2rem' } } },
      footer: { arrangement: 'centered' },
    });
    const css = themeCss(theme as Theme);
    expect(css).toContain('.site-header{--l-direction:column;--l-align:center;--l-justify:center;text-align:center;position:sticky;top:0;z-index:5;background-color:var(--t-color-surface);padding-block:2rem}');
    expect(css).toContain('.site-footer{--l-direction:column;');
    // The default layout writes no rule at all.
    expect(themeCss(themeOf(plain))).not.toContain('.site-header');
  });

  test('two themes that lay the header out differently draw the same markup', () => {
    const site = normalizeSite(DEMO_SITE);
    const page = normalizePage(DEMO_PAGES[0]).page;
    const menu = DEMO_PAGES.map((p) => ({ title: p.title, slug: p.slug }));
    expect(themeOf(studio).layout).not.toEqual(themeOf(plain).layout);
    expect(renderParts(site, themeOf(studio), page, menu).body).toBe(renderParts(site, themeOf(plain), page, menu).body);
  });

  test('the theme comes after the structure in the stylesheet, so its choices win', async () => {
    const site = normalizeSite(DEMO_SITE);
    const css = (await buildSite(site, themeOf(studio), [normalizePage(DEMO_PAGES[0]).page])).get('assets/site.css') as string;
    expect(css.indexOf('.site-header{position:sticky')).toBeGreaterThan(css.lastIndexOf('.site-header,.site-footer{'));
    expect(css.indexOf(':root{')).toBeGreaterThan(css.indexOf('.group{'));
  });
});

describe('what the header and footer say is the site\'s', () => {
  test('a logo, a button and footer links are cleaned like a block\'s', () => {
    const site = normalizeSite({
      name: 'S',
      logo: { src: 'javascript:alert(1)', alt: 'x' },
      action: { label: 'Go', href: 'javascript:alert(1)' },
      footerLinks: [{ label: 'Privacy', href: '/privacy/' }, { label: '', href: '' }, 'nope', { label: 'Bad', href: 'data:text/html,x' }, ...Array(20).fill({ label: 'x', href: '/x/' })],
    });
    expect(site.logo).toBeNull();
    expect(site.action).toEqual({ label: 'Go', href: '' });
    expect(site.footerLinks).toHaveLength(10);
    expect(site.footerLinks[0]).toEqual({ label: 'Privacy', href: '/privacy/' });
    expect(site.footerLinks[1]).toEqual({ label: 'Bad', href: '' });
    // A site saved before these existed reads as having none.
    expect(normalizeSite({ name: 'Old', footer: 'f' })).toMatchObject({ logo: null, action: null, footerLinks: [] });
  });

  test('only what a visitor can follow is drawn; the logo is read out as the site\'s name', () => {
    const site = normalizeSite({ name: 'Nord <b>', logo: { src: '/logo.png', alt: '' }, action: { label: 'Soon', href: '' }, footerLinks: [{ label: 'Privacy', href: '/privacy/' }, { label: 'Later', href: '' }] });
    const { body } = renderParts(site, themeOf(plain), normalizePage({ title: 'T', blocks: [] }).page, []);
    expect(body).toContain('<img class="site-logo" src="/logo.png" alt="Nord &lt;b>"');
    expect(body).not.toContain('Soon');
    expect(body).not.toContain('Later');
    expect(body).toContain('<nav aria-label="Footer"><a href="/privacy/">Privacy</a></nav>');
    expect(body).not.toContain('data-site');
    expect(renderParts(site, themeOf(plain), normalizePage({ title: 'T', blocks: [] }).page, [], true).body).toContain('data-site="header"');
  });
});

describe('the logo is an image of the site', () => {
  let dir: string;
  let store: Store;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'thecms-'));
    store = new Store(join(dir, 'site.db'));
    store.setSite(DEMO_SITE);
    store.setTheme(plain);
    store.publishTheme();
    for (const page of DEMO_PAGES) store.publish(store.savePage(page).slug);
  });
  afterEach(async () => {
    store.close();
    await rm(dir, { recursive: true, force: true });
  });

  test('it cannot be deleted while it is the logo, and it is exported', async () => {
    const item = store.addMedia(PNG);
    store.setSite({ ...store.site(), logo: { src: item.path, alt: '' } });
    expect(() => store.deleteMedia(item.name)).toThrow('the header (logo)');
    const files = await exportSite(store, join(dir, 'out'));
    expect(files).toContain(item.path.slice(1));
    store.setSite({ ...store.site(), logo: null });
    store.deleteMedia(item.name);
    expect(store.media()).toHaveLength(0);
  });

  test('a logo the site does not have stops the export', async () => {
    store.setSite({ ...store.site(), logo: { src: `/media/${'0'.repeat(32)}.png`, alt: '' } });
    await expect(exportSite(store, join(dir, 'out'))).rejects.toThrow('the header shows an image this site does not have');
  });
});
