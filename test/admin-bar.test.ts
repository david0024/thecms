/**
 * The admin bar over the site (ADR 0075): a person signed in sees it on the
 * site's pages, with what they may do there; a visitor gets the page as it
 * was made, byte for byte, with its headers and no script.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { postsType } from '../src/core/index.ts';
import { adminAt, barHtml, barLinks, barWords, type EditTarget, withBar } from '../src/site/admin-bar.ts';
import { publishedSite } from '../src/site/export.ts';
import { packFor } from '../src/site/languages.ts';
import { type EditorServer, startEditor } from '../src/site/server.ts';
import { Store } from '../src/site/store.ts';
import plain from '../themes/plain.json';

const PASSWORD = 'a long enough password';
const PUBLIC = 'https://cms.example.com';

describe('the bar, as markup', () => {
  const words = barWords(null);

  test('the editor is opened at the screen the bar names, as the admin writes it', () => {
    expect(adminAt('edit/page/about')).toBe('/admin/#at=edit/page/about');
    expect(adminAt('edit/posts/ro/stejar')).toBe('/admin/#at=edit/posts/ro/stejar');
    expect(adminAt('new/page')).toBe('/admin/#at=new/page');
  });

  test('a page is the owner\'s and the editors\' to change; an entry also its author\'s, unless a contributor', () => {
    const page = { kind: 'page', slug: 'about' };
    const entry = { kind: 'posts', slug: 'oak', entry: 'oak', singular: 'Post' };
    const posts = { singular: 'Post' };
    expect(barLinks({ name: 'O', role: 'owner' }, page, words, 'en', null, 'o', posts)).toEqual({
      edit: { href: '/admin/#at=edit/page/about', label: 'Edit page' },
      add: { href: '/admin/#at=new/page', label: 'New page' },
    });
    expect(barLinks({ name: 'E', role: 'editor' }, entry, words, 'en', 'someone', 'e', posts).edit?.label).toBe('Edit post');
    // An author: their own entry, never a page; what they add is a post.
    expect(barLinks({ name: 'A', role: 'author' }, page, words, 'en', null, 'a', posts)).toEqual({ add: { href: '/admin/#at=new/posts', label: 'New post' } });
    expect(barLinks({ name: 'A', role: 'author' }, entry, words, 'en', 'a', 'a', posts).edit?.href).toBe('/admin/#at=edit/posts/oak');
    expect(barLinks({ name: 'A', role: 'author' }, entry, words, 'en', 'b', 'a', posts).edit).toBeUndefined();
    // A contributor's published entry is an editor's now (ADR 0055).
    expect(barLinks({ name: 'C', role: 'contributor' }, entry, words, 'en', 'c', 'c', posts).edit).toBeUndefined();
    // A site without posts gives an author nothing to add from the bar.
    expect(barLinks({ name: 'A', role: 'author' }, null, words, 'en', null, 'a', null)).toEqual({});
  });

  test('in the admin\'s language, with no script, and names escaped', () => {
    const ro = barWords(packFor('ro'));
    const bar = barHtml({ name: 'Ana <b>', role: 'owner' }, barLinks({ name: 'Ana', role: 'owner' }, { kind: 'page', slug: '' }, ro, 'ro', null, 'a', null), ro, 'ro');
    expect(bar).toContain('aria-label="Bara de administrare"');
    expect(bar).toContain('Editează pagina');
    expect(bar).toContain('Pagină nouă');
    expect(bar).toContain('Ana &lt;b&gt;');
    expect(bar).not.toContain('<script');
  });

  test('goes first in the body, its style at the end of the head', () => {
    const page = '<!doctype html>\n<html lang="en">\n<head>\n<title>x</title>\n</head>\n<body>\n<main>Hi</main>\n</body>\n</html>\n';
    const shown = withBar(page, '<nav id="uhlaka-bar"></nav>');
    expect(shown).toContain('<style id="uhlaka-bar-style">');
    expect(shown.indexOf('uhlaka-bar-style')).toBeLessThan(shown.indexOf('</head>'));
    expect(shown).toContain('<body>\n<nav id="uhlaka-bar"></nav>\n<main>');
    expect(withBar('not a page', '<nav></nav>')).toBe('not a page');
  });
});

describe('the bar on a served site', () => {
  let store: Store;
  let editor: EditorServer;
  let siteDir: string;
  const cookies: Record<string, string> = {};

  const visit = (path: string, who = '', method = 'GET') =>
    editor.fetch(new Request(`${PUBLIC}${path}`, { method, headers: { host: 'cms.example.com', ...(who ? { cookie: `${cookies[who] ?? ''}; uhlaka-lang=en` } : {}) } }));

  beforeEach(async () => {
    siteDir = await mkdtemp(join(tmpdir(), 'uhlaka-admin-bar-'));
    store = await Store.open(join(siteDir, 'site.db'));
    await store.setSite({ name: 'S', url: 'https://example.com', types: [postsType()] });
    await store.setTheme(plain);
    await store.publishTheme();
    for (const slug of ['', 'about']) {
      await store.savePage({ slug, title: slug || 'Home', blocks: [] });
      await store.publish(slug);
    }
    for (const [who, role] of [
      ['owner', 'owner'],
      ['ana', 'author'],
      ['dan', 'author'],
    ] as const) {
      const user = await store.addUser({ email: `${who}@example.com`, name: who === 'ana' ? 'Ana Pop' : '', role, password: PASSWORD });
      cookies[who] = `uhlaka_session=${await store.startSession(user.id)}`;
      if (who === 'ana') {
        await store.saveEntry('posts', { slug: 'oak', title: 'Oak', blocks: [] }, user.id);
        await store.publishEntry('posts', 'oak');
      }
    }
    editor = await startEditor(store, { listen: false, public: PUBLIC });
  });
  afterEach(async () => {
    editor.stop();
    await store.close();
    await rm(siteDir, { recursive: true, force: true });
  });

  test('a visitor gets the page the cache keeps, untouched', async () => {
    const before = await visit('/about/');
    const html = await before.text();
    expect(html).not.toContain('uhlaka-bar');
    // The one script a page may carry is the switch of colours (ADR 0074 d4); the bar adds none.
    expect(html.match(/<script/g)).toEqual(['<script']);
    expect(before.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate');
    // A cookie that signs nobody in is a visitor's too.
    cookies.nobody = 'uhlaka_session=not-a-session';
    const stranger = await visit('/about/', 'nobody');
    expect(await stranger.text()).toBe(html);
    expect(stranger.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate');
  });

  test('the owner sees the bar on a page, an entry and a missing address, kept by no cache', async () => {
    const page = await visit('/about/', 'owner');
    const html = await page.text();
    expect(page.headers.get('cache-control')).toBe('private, no-store');
    expect(html).toContain('<nav id="uhlaka-bar"');
    expect(html).toContain('href="/admin/#at=edit/page/about"');
    expect(html).toContain('href="/admin/#at=new/page"');
    expect(html).toContain('owner@example.com');
    // The page under it is the visitor's, byte for byte, and the site's rules hold.
    const visitor = await (await visit('/about/')).text();
    expect(html.replace(/<style id="uhlaka-bar-style">[^<]*<\/style>\n/, '').replace(/<nav id="uhlaka-bar"[\s\S]*?<\/nav>\n/, '')).toBe(visitor);
    expect(html.match(/<script/g)).toEqual(['<script']);
    expect(page.headers.get('content-security-policy')).toContain("script-src 'self'");
    expect(await (await visit('/', 'owner')).text()).toContain('href="/admin/#at=edit/page/"');
    expect(await (await visit('/blog/oak/', 'owner')).text()).toContain('href="/admin/#at=edit/posts/oak"');
    const missing = await visit('/nowhere/', 'owner');
    expect(missing.status).toBe(404);
    const lost = await missing.text();
    expect(lost).toContain('<nav id="uhlaka-bar"');
    expect(lost).not.toContain('#at=edit/');
  });

  test('an author edits their own entry from it, and no one else\'s, nor a page', async () => {
    const own = await (await visit('/blog/oak/', 'ana')).text();
    expect(own).toContain('href="/admin/#at=edit/posts/oak"');
    expect(own).toContain('Ana Pop');
    expect(own).toContain('href="/admin/#at=new/posts"');
    expect(await (await visit('/blog/oak/', 'dan')).text()).not.toContain('#at=edit/');
    expect(await (await visit('/about/', 'ana')).text()).not.toContain('#at=edit/');
  });

  test('a page and an entry in another language are opened in the editor where it keeps them', async () => {
    await store.setSite({ ...(await store.site()), languages: ['ro'] });
    await store.translate('about', 'ro');
    await store.publish('about');
    const ana = (await store.users()).find((u) => u.email === 'ana@example.com')?.id as string;
    await store.saveEntry('posts', { slug: 'pine', title: 'Pine', blocks: [], translations: { ro: { title: 'Pin', slug: 'pin' } } }, ana);
    await store.publishEntry('posts', 'pine');
    const targets = new Map<string, EditTarget>();
    await publishedSite(store, true, targets);
    const translated = [...targets.values()].filter((t) => t.slug.startsWith('ro/'));
    expect(translated).toContainEqual({ kind: 'page', slug: (await store.published()).find((p) => p.language === 'ro' && p.of === 'about')?.slug as string });
    expect(translated).toContainEqual({ kind: 'posts', slug: 'ro/pin', entry: 'pine', singular: 'Post' });
    // Its author edits it from the Romanian page too, as the entry is hers.
    const path = [...targets].find(([, t]) => t.slug === 'ro/pin')?.[0] as string;
    expect(await (await visit(path, 'ana')).text()).toContain('href="/admin/#at=edit/posts/ro/pin"');
  });

  test('not on what is not a page: a stylesheet, a HEAD, the admin itself', async () => {
    const css = await visit('/style.css', 'owner');
    if (css.status === 200) expect(await css.text()).not.toContain('uhlaka-bar');
    expect(await (await visit('/about/', 'owner', 'HEAD')).text()).not.toContain('uhlaka-bar');
    expect(await (await visit('/admin/', 'owner')).text()).not.toContain('uhlaka-bar');
  });
});
