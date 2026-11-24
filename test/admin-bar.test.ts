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
import { adminAt, backTo, barHtml, barLinks, barWords, type EditTarget, withBar } from '../src/site/admin-bar.ts';
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
    const page = { kind: 'page', slug: 'about', main: 'about' };
    const entry = { kind: 'posts', slug: 'oak', main: 'oak', singular: 'Post' };
    const posts = { singular: 'Post' };
    const facts = (target: typeof page | null, author: string | null, me: string, withPosts = true) => ({ target, author, me, posts: withPosts ? posts : null, changed: false });
    expect(barLinks({ name: 'O', role: 'owner' }, facts(page, null, 'o'), words, 'en')).toEqual({
      edit: { href: '/admin/#at=edit/page/about', label: 'Edit page', changed: false },
      add: { href: '/admin/#at=new/page', label: 'New page' },
    });
    expect(barLinks({ name: 'E', role: 'editor' }, facts(entry, 'someone', 'e'), words, 'en').edit?.label).toBe('Edit post');
    // An author: their own entry, never a page; what they add is a post.
    expect(barLinks({ name: 'A', role: 'author' }, facts(page, null, 'a'), words, 'en')).toEqual({ add: { href: '/admin/#at=new/posts', label: 'New post' } });
    expect(barLinks({ name: 'A', role: 'author' }, facts(entry, 'a', 'a'), words, 'en').edit?.href).toBe('/admin/#at=edit/posts/oak');
    expect(barLinks({ name: 'A', role: 'author' }, facts(entry, 'b', 'a'), words, 'en').edit).toBeUndefined();
    // A contributor's published entry is an editor's now (ADR 0055).
    expect(barLinks({ name: 'C', role: 'contributor' }, facts(entry, 'c', 'c'), words, 'en').edit).toBeUndefined();
    // A site without posts gives an author nothing to add from the bar.
    expect(barLinks({ name: 'A', role: 'author' }, facts(null, null, 'a', false), words, 'en')).toEqual({});
    // Changes not published are said beside "Edit".
    expect(barLinks({ name: 'O', role: 'owner' }, { ...facts(page, null, 'o'), changed: true }, words, 'en').edit?.changed).toBe(true);
  });

  test('in the admin\'s language, with no script, names escaped, numbers only above zero', () => {
    const ro = barWords(packFor('ro'));
    const links = barLinks({ name: 'Ana', role: 'owner' }, { target: { kind: 'page', slug: '', main: '' }, author: null, me: 'a', posts: null, changed: true }, ro, 'ro');
    const bar = barHtml({ name: 'Ana <b>', role: 'owner' }, links, { comments: 3, review: 0, orders: 1 }, ro, 'ro', '/despre/?a="b"');
    expect(bar).toContain('aria-label="Bara de administrare"');
    expect(bar).toContain('Editează pagina');
    expect(bar).toContain('Nepublicat');
    expect(bar).toContain('Pagină nouă');
    expect(bar).toContain('Ana &lt;b&gt;');
    expect(bar).toContain('aria-label="3 comentarii de aprobat"');
    expect(bar).toContain('aria-label="O comandă de rezolvat"');
    expect(bar).not.toContain('data-bar="review"');
    expect(bar).toContain('<form method="post" action="/admin/sign-out"');
    expect(bar).toContain('value="/despre/?a=&quot;b&quot;"');
    expect(bar).toContain('Ieșire');
    expect(bar).not.toContain('<script');
  });

  test('signing out leads only to an address of this site', () => {
    expect(backTo('/about/?x=1')).toBe('/about/?x=1');
    for (const bad of [null, '', 'https://evil.example/', '//evil.example/', '/\\evil.example', 'about']) expect(backTo(bad)).toBe('/');
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
    expect(translated).toContainEqual({ kind: 'page', slug: (await store.published()).find((p) => p.language === 'ro' && p.of === 'about')?.slug as string, main: 'about' });
    expect(translated).toContainEqual({ kind: 'posts', slug: 'ro/pin', main: 'pine', singular: 'Post' });
    // Its author edits it from the Romanian page too, as the entry is hers.
    const path = [...targets].find(([, t]) => t.slug === 'ro/pin')?.[0] as string;
    expect(await (await visit(path, 'ana')).text()).toContain('href="/admin/#at=edit/posts/ro/pin"');
  });

  test('says what is not published, and what waits, only to whom it is for', async () => {
    expect(await (await visit('/about/', 'owner')).text()).not.toContain('data-bar-changed');
    await store.savePage({ slug: 'about', title: 'About, changed', blocks: [] });
    expect(await (await visit('/about/', 'owner')).text()).toContain('data-bar-changed');
    // A page never changed since it was published says nothing.
    expect(await (await visit('/', 'owner')).text()).not.toContain('data-bar-changed');

    await store.addComment({ type: 'posts', entry: 'oak', name: 'Ion', email: 'ion@example.org', body: 'Hello', consent: 'ok' });
    await store.askReview('posts', 'oak');
    const owner = await (await visit('/', 'owner')).text();
    expect(owner).toContain('href="/admin/#at=comments" data-bar="comments" title="1 comment to approve"');
    expect(owner).toContain('href="/admin/#at=review" data-bar="review" title="1 entry sent for review"');
    // No shop, no orders.
    expect(owner).not.toContain('data-bar="orders"');
    // An author sees neither.
    const author = await (await visit('/', 'ana')).text();
    expect(author).not.toContain('data-bar="comments"');
    expect(author).not.toContain('data-bar="review"');
  });

  test('signs out from the page and leaves the person on it, as a visitor', async () => {
    const out = (origin: string, back: string) =>
      editor.fetch(new Request(`${PUBLIC}/admin/sign-out`, { method: 'POST', headers: { host: 'cms.example.com', origin, cookie: cookies.owner as string, 'content-type': 'application/x-www-form-urlencoded' }, body: `back=${encodeURIComponent(back)}` }));
    // A form from another site is refused, and the session stays.
    expect((await out('https://evil.example', '/about/')).status).toBe(403);
    expect(await (await visit('/about/', 'owner')).text()).toContain('uhlaka-bar');
    const left = await out(PUBLIC, '/about/');
    expect(left.status).toBe(303);
    expect(left.headers.get('location')).toBe('/about/');
    expect(left.headers.get('set-cookie')).toContain('uhlaka_session=;');
    expect(left.headers.get('set-cookie')).toContain('Max-Age=0');
    // The old cookie signs nobody in now.
    expect(await (await visit('/about/', 'owner')).text()).not.toContain('uhlaka-bar');
    // Nowhere else than this site.
    cookies.owner = `uhlaka_session=${await store.startSession(((await store.users()).find((u) => u.role === 'owner') as { id: string }).id)}`;
    expect((await out(PUBLIC, 'https://evil.example/')).headers.get('location')).toBe('/');
  });

  test('is turned off and on by each person, in "Me"', async () => {
    const me = (bar: boolean) =>
      editor.fetch(
        new Request(`${PUBLIC}/api/me`, {
          method: 'PUT',
          headers: { host: 'cms.example.com', origin: PUBLIC, 'x-uhlaka-request': '1', cookie: cookies.ana as string, 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'Ana Pop', bio: '', picture: '', bar }),
        }),
      );
    const off = (await (await me(false)).json()) as { me: { bar: boolean } };
    expect(off.me.bar).toBe(false);
    const visitor = await (await visit('/about/')).text();
    expect(await (await visit('/about/', 'ana')).text()).toBe(visitor);
    // The others keep theirs.
    expect(await (await visit('/about/', 'owner')).text()).toContain('uhlaka-bar');
    expect(((await (await me(true)).json()) as { me: { bar: boolean } }).me.bar).toBe(true);
    expect(await (await visit('/about/', 'ana')).text()).toContain('uhlaka-bar');
    // A profile saved without saying leaves it as it was.
    await store.setProfile(((await store.users()).find((u) => u.email === 'ana@example.com') as { id: string }).id, 'Ana', '');
    expect((await store.users()).find((u) => u.email === 'ana@example.com')?.bar).toBe(true);
  });

  test('not on what is not a page: a stylesheet, a HEAD, the admin itself', async () => {
    const css = await visit('/style.css', 'owner');
    if (css.status === 200) expect(await css.text()).not.toContain('uhlaka-bar');
    expect(await (await visit('/about/', 'owner', 'HEAD')).text()).not.toContain('uhlaka-bar');
    expect(await (await visit('/admin/', 'owner')).text()).not.toContain('uhlaka-bar');
  });
});
