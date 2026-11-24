/**
 * Dark mode (ADR 0074): a second palette in a theme, what the site shows, the
 * switch and its one script, the check of contrast and the proposed palette.
 */
import { describe, expect, test } from 'bun:test';
import { colorsFor, contrast, contrastIssues, normalizePage, normalizeSite, parseTheme, proposePalette, shownBy, type Theme, themeCss } from '../src/core/index.ts';
import { DEMO_PAGES, DEMO_SITE } from '../src/site/demo.ts';
import { renderPage } from '../src/site/document.ts';
import { buildSite } from '../src/site/export.ts';
import { SCHEME_SCRIPT, SCHEME_SCRIPT_PATH } from '../src/site/scheme.ts';
import atelier from '../themes/atelier.json';
import plain from '../themes/plain.json';
import studio from '../themes/studio.json';

const themeOf = (input: unknown): Theme => parseTheme(input).theme as Theme;
const issuesOf = (input: unknown): string[] => parseTheme(input).issues.map((i) => `${i.path}: ${i.message}`);
const site = normalizeSite({ ...DEMO_SITE, url: 'https://example.com/' });
const page = normalizePage(DEMO_PAGES[0]).page;
const { dark: _dark, shows: _shows, ...plainLight } = plain as typeof plain & { dark?: unknown; shows?: unknown };
const SWITCH = '<script src="/assets/scheme.js"></script>';

describe('a second palette in a theme (ADR 0074 d1)', () => {
  test('is read, and a theme without one reads as it did', () => {
    const theme = themeOf(plain);
    expect(theme.dark?.color.background).toBe('#111318');
    expect(theme.shows).toBe('visitor');
    expect(colorsFor(theme, 'dark').text).toBe('#eceef2');
    // A token the palette leaves out keeps its value.
    expect(colorsFor(theme, 'dark')['on-primary']).toBe('#ffffff');
    const bare = themeOf(plainLight);
    expect(bare.dark).toBeUndefined();
    expect(shownBy(bare)).toBe('light');
  });

  test('a theme whose own colours are dark carries the light ones', () => {
    const theme = themeOf(studio);
    expect(theme.scheme).toBe('dark');
    expect(colorsFor(theme, 'light').background).toBe('#faf7f1');
    expect(colorsFor(theme, 'dark').background).toBe('#12110f');
  });

  test('refuses, whole, a palette that is not one', () => {
    expect(issuesOf({ ...plainLight, dark: { color: { glow: '#000000' } } })).toEqual(['dark.color.glow: not a colour token of this theme']);
    expect(issuesOf({ ...plainLight, dark: { color: { text: 'red;}' } } })).toEqual(['dark.color.text: not a color value']);
    expect(issuesOf({ ...plainLight, dark: { color: {}, space: {} } })).toEqual(['dark.space: a palette holds only colours']);
    expect(issuesOf({ ...plainLight, light: { color: {} } })).toEqual(["light: the theme's own colours are light: they are its tokens"]);
    expect(issuesOf({ ...plainLight, scheme: 'dim' })).toEqual(['scheme: light or dark']);
    expect(issuesOf({ ...plainLight, shows: 'visitor' })).toEqual(['shows: needs the colours for the dark ("dark")']);
    expect(issuesOf({ ...plainLight, shows: 'sometimes' })).toEqual(['shows: one of: light, dark, visitor']);
    expect(parseTheme({ ...plainLight, dark: { color: { text: '#fff' } } }).theme).not.toBeNull();
  });

  test('"Light only" is the theme as it was: not written, and nothing of the dark reaches the stylesheet', () => {
    const theme = themeOf({ ...plain, shows: 'light' });
    expect(theme.shows).toBeUndefined();
    const css = themeCss(theme);
    expect(css).not.toContain('#111318');
    expect(css).not.toContain('prefers-color-scheme');
    expect(css).not.toContain('data-scheme');
    // A theme with only one palette writes exactly what it wrote before ADR 0074.
    expect(themeCss(themeOf(plainLight))).not.toContain('color-scheme');
  });
});

describe('what the site shows (ADR 0074 d2, d3)', () => {
  test('following the visitor: the device decides, unless the switch chose', () => {
    const css = themeCss(themeOf(plain));
    expect(css).toContain(':root{--t-color-background:#ffffff;');
    expect(css).toContain('@media (prefers-color-scheme: dark){\n:root:not([data-scheme=light]){--t-color-background:#111318;');
    expect(css).toContain(':root[data-scheme=dark]{--t-color-background:#111318;');
    expect(css).not.toContain(':root[data-scheme=light]{');
    // The switch offers the scheme the page is not in.
    expect(css).toContain(':root .scheme-to-light{display:none}');
    expect(css).toContain(':root[data-scheme=dark] .scheme-to-dark{display:none}');
  });

  test('a dark theme that follows the visitor turns light on a light device', () => {
    const css = themeCss(themeOf(studio));
    expect(css).toContain(':root{--t-color-background:#12110f;');
    expect(css).toContain('color-scheme:dark}');
    expect(css).toContain('@media (prefers-color-scheme: light){\n:root:not([data-scheme=dark]){--t-color-background:#faf7f1;');
  });

  test('"Dark only" starts dark and stays dark', () => {
    const css = themeCss(themeOf({ ...plain, shows: 'dark' }));
    expect(css).toStartWith(':root{--t-color-background:#111318;');
    expect(css).toContain('color-scheme:dark');
    expect(css).not.toContain('prefers-color-scheme');
    expect(css).not.toContain('#ffffff;--t-color-surface');
  });

  test('the editor can show either scheme, whatever the site shows', () => {
    const css = themeCss(themeOf({ ...plain, shows: 'light' }), { preview: true });
    expect(css).toContain(':root[data-scheme=dark]{--t-color-background:#111318;');
    expect(css).toContain(':root[data-scheme=light]{--t-color-background:#ffffff;');
  });
});

describe('the switch, and the one script (ADR 0074 d4)', () => {
  test('is on the page only while the theme follows the visitor', () => {
    const following = renderPage(site, themeOf(plain), page, []);
    expect(following).toContain(SWITCH);
    expect(following).toContain('<button class="scheme-switch" type="button" hidden="">');
    expect(following).toContain('<span class="scheme-label">Dark colours</span>');
    // The script is in the head, before the stylesheet, so the choice is there at the first paint.
    expect(following.indexOf(SWITCH)).toBeLessThan(following.indexOf('<link rel="stylesheet"'));
    for (const shows of ['light', 'dark']) {
      const html = renderPage(site, themeOf({ ...plain, shows }), page, []);
      expect(html).not.toContain('<script src');
      expect(html).not.toContain('scheme-switch');
    }
    // Light only and dark only are the same page: only the stylesheet differs.
    expect(renderPage(site, themeOf({ ...plain, shows: 'light' }), page, [])).toBe(renderPage(site, themeOf({ ...plain, shows: 'dark' }), page, []));
  });

  test('in the site\'s language', () => {
    const html = renderPage({ ...site, language: 'ro' }, themeOf(plain), page, []);
    expect(html).toContain('<span class="scheme-label">Culori întunecate</span>');
    expect(html).toContain('<span class="scheme-label">Culori luminoase</span>');
  });

  test('its file is written beside the site only when a page links it', async () => {
    expect((await buildSite(site, themeOf(plain), [page])).get(SCHEME_SCRIPT_PATH.slice(1))).toBe(SCHEME_SCRIPT);
    expect((await buildSite(site, themeOf(plainLight), [page])).has(SCHEME_SCRIPT_PATH.slice(1))).toBe(false);
  });

  test('the script is small, keeps only the choice, and reaches nothing outside the page', () => {
    expect(SCHEME_SCRIPT.length).toBeLessThan(1024);
    expect(SCHEME_SCRIPT).toContain('localStorage.setItem(k,next)');
    expect(SCHEME_SCRIPT).not.toMatch(/fetch|XMLHttpRequest|document\.cookie|sendBeacon|import\(|eval|innerHTML/);
  });

  test('turns the page, remembers, and forgets when the visitor goes back to their device', () => {
    const storage = new Map<string, string>();
    const listeners: Record<string, () => void> = {};
    const button = { hidden: true, addEventListener: (_: string, f: () => void) => (listeners.click = f) };
    const root = { dataset: {} as Record<string, string> };
    const run = (deviceDark: boolean): void => {
      root.dataset = {};
      const scope = {
        document: { documentElement: root, querySelectorAll: () => [button] },
        matchMedia: () => ({ matches: deviceDark }),
        localStorage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v), removeItem: (k: string) => storage.delete(k) },
        addEventListener: (_: string, f: () => void) => f(),
      };
      new Function(...Object.keys(scope), SCHEME_SCRIPT)(...Object.values(scope));
    };
    run(false);
    expect(button.hidden).toBe(false);
    expect(root.dataset.scheme).toBeUndefined();
    listeners.click?.();
    expect(root.dataset.scheme).toBe('dark');
    expect(storage.get('uhlaka-scheme')).toBe('dark');
    // The next page starts in the choice.
    run(false);
    expect(root.dataset.scheme).toBe('dark');
    // Back to what the device says: the choice is forgotten.
    listeners.click?.();
    expect(root.dataset.scheme).toBeUndefined();
    expect(storage.has('uhlaka-scheme')).toBe(false);
    // On a dark device, the switch offers the light.
    run(true);
    listeners.click?.();
    expect(root.dataset.scheme).toBe('light');
  });
});

describe('readable in both schemes (ADR 0074 d5, d6)', () => {
  test('contrast is measured as WCAG measures it', () => {
    expect(contrast('#000000', '#ffffff')).toBe(21);
    expect(contrast('#fff', '#ffffff')).toBe(1);
    expect(contrast('red', '#ffffff')).toBeNull();
  });

  test('the themes Uhlaka ships have both palettes, follow the visitor, and read at 4.5 : 1 or more', () => {
    for (const input of [atelier, plain, studio]) {
      const theme = themeOf(input);
      expect(`${theme.name}: ${shownBy(theme)}`).toBe(`${theme.name}: visitor`);
      expect(contrastIssues(theme)).toEqual([]);
    }
  });

  test('a pair that reads badly is named, with its scheme', () => {
    const theme = themeOf({ ...plain, dark: { color: { ...plain.dark.color, muted: '#2a2d33' } } });
    expect(contrastIssues(theme)).toEqual([
      { text: 'muted', on: 'background', scheme: 'dark', ratio: 1.3 },
      { text: 'muted', on: 'surface', scheme: 'dark', ratio: 1.2 },
    ]);
  });

  test('a proposed palette is a valid one, and reads well for the shipped themes', () => {
    for (const input of [atelier, plain, studio]) {
      const { dark: _d, light: _l, shows: _s, ...bare } = input as Record<string, unknown>;
      const own = themeOf(bare);
      const { palette, link } = proposePalette(own);
      const tokens = { ...own.tokens, color: { ...own.tokens.color, ...(link ? { link } : {}) } };
      const other = own.scheme === 'dark' ? 'light' : 'dark';
      const theme = parseTheme({ ...own, tokens, [other]: { color: palette }, shows: 'visitor' }).theme;
      expect(theme).not.toBeNull();
      expect(contrastIssues(theme as Theme)).toEqual([]);
    }
  });
});
