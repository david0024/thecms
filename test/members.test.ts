/**
 * Member levels and "Who sees it" (ADR 0064 d3, d4, PR b): the owner names
 * levels and gives them; a page, an entry or a whole type is for everyone,
 * for visitors signed in, or for members of chosen levels; the runtime asks
 * who opens it, and nothing of it reaches the sitemap, the search, the feeds,
 * the site's data or an export.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { audienceFromWord, audienceWord, createBlock, mayView, normalizeAudience, normalizeAudiences, normalizeLevels, normalizeMenu, POSTS_TYPE, resolveMenu } from '../src/core/index.ts';
import { exportSite, membersOf, publishedSite } from '../src/site/export.ts';
import { publishedFor } from '../src/site/extensions.ts';
import { startRuntime } from '../src/site/runtime.ts';
import { startEditor } from '../src/site/server.ts';
import { Store } from '../src/site/store.ts';
import { exportContent } from '../src/site/transfer.ts';
import { VISITOR_TABLES } from '../src/site/visitor-schema.ts';
import plain from '../themes/plain.json';

const dir = await mkdtemp(join(tmpdir(), 'thecms-members-'));
afterAll(() => rm(dir, { recursive: true, force: true }));
const text = (body: string) => ({ id: `b_${Math.random().toString(36).slice(2, 10)}`, type: 'text', content: { body: [{ type: 'paragraph', children: [{ text: body }] }] } });
const LEVELS = [
  { id: 'member', name: 'Member' },
  { id: 'premium', name: 'Premium' },
];

async function site(name: string, languages: string[] = []): Promise<Store> {
  const store = await Store.open(join(dir, `${name}.db`));
  await store.setTheme(plain);
  await store.publishTheme();
  await store.setSite({ name: 'Atelier', url: 'https://example.com', forms: '/_', languages });
  await store.savePage({ slug: '', title: 'Home', blocks: [createBlock('search'), text('Welcome.')] });
  await store.publish('');
  await store.savePage({ slug: 'club', title: 'Club', blocks: [text('The secret recipe.')] });
  await store.publish('club');
  await store.saveEntry(POSTS_TYPE, { slug: 'open', title: 'Open post', date: '2026-01-02', blocks: [text('For all.')] });
  await store.publishEntry(POSTS_TYPE, 'open');
  await store.saveEntry(POSTS_TYPE, { slug: 'inside', title: 'Inside post', date: '2026-01-03', blocks: [text('The members letter.')] });
  await store.publishEntry(POSTS_TYPE, 'inside');
  return store;
}

/** A browser of one visitor: it keeps its cookie, and follows nothing by itself. */
function browser(fetch: (request: Request) => Promise<Response>) {
  let cookie = '';
  const go = async (method: string, path: string, fields?: Record<string, string>): Promise<Response> => {
    const response = await fetch(
      new Request(`https://example.com${path}`, {
        method,
        headers: { ...(cookie ? { cookie } : {}), ...(fields ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
        body: fields ? new URLSearchParams(fields).toString() : undefined,
      }),
    );
    const set = response.headers.get('set-cookie');
    if (set) cookie = /Max-Age=0/.test(set) ? '' : (set.split(';')[0] as string);
    return response;
  };
  return { go };
}

/** A confirmed visitor, made as the accounts make one; the accounts' tables are there once they were opened. */
async function visitor(store: Store, email: string, password: string): Promise<string> {
  const id = crypto.randomUUID();
  await store
    .database()
    .run('INSERT INTO visitors (id, email, name, password, language, created_at, confirmed_at, last_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)', [id, email, 'Ana', await Bun.password.hash(password, { algorithm: 'argon2id' }), 'en', new Date().toISOString(), new Date().toISOString()]);
  return id;
}

describe('levels and audiences, as data', () => {
  test('are cleaned of what they cannot be', () => {
    expect(normalizeLevels([{ name: 'Gold  Club' }, { name: 'gold club' }, { id: 'x', name: '' }, 'no', { id: 'Premium!', name: 'Premium' }])).toEqual([
      { id: 'gold-club', name: 'Gold Club' },
      { id: 'premium', name: 'Premium' },
    ]);
    expect(normalizeLevels(Array.from({ length: 30 }, (_, i) => ({ name: `L${i}` })))).toHaveLength(20);
    expect(normalizeAudience(null)).toBeNull();
    expect(normalizeAudience({ who: 'everyone' })).toBeNull();
    expect(normalizeAudience({ who: 'signed', levels: ['x'] })).toEqual({ who: 'signed' });
    // Members of no level would be nobody: that is not an audience.
    expect(normalizeAudience({ who: 'members', levels: [] })).toBeNull();
    expect(normalizeAudience({ who: 'members', levels: ['Gold', 'gold', ''] })).toEqual({ who: 'members', levels: ['gold'] });
    expect(normalizeAudiences({ pages: { club: { who: 'signed' }, bad: { who: 'x' } }, entries: 'no' })).toEqual({ pages: { club: { who: 'signed' } }, entries: {}, types: {} });
  });

  test('say who may see, and travel in a built page as one word', () => {
    expect(mayView(null, null)).toBe(true);
    expect(mayView({ who: 'signed' }, null)).toBe(false);
    expect(mayView({ who: 'signed' }, [])).toBe(true);
    expect(mayView({ who: 'members', levels: ['gold'] }, ['silver'])).toBe(false);
    expect(mayView({ who: 'members', levels: ['gold', 'silver'] }, ['silver'])).toBe(true);
    for (const audience of [{ who: 'signed' as const }, { who: 'members' as const, levels: ['a', 'b-c'] }]) expect(audienceFromWord(audienceWord(audience))).toEqual(audience);
    expect(audienceFromWord('anyone')).toBeNull();
    expect(membersOf('<meta name="thecms-members" content="members:gold">')).toEqual({ who: 'members', levels: ['gold'] });
    expect(membersOf('<p>no</p>')).toBeNull();
  });

  test('"My account" is in the menu only while accounts are on, in each language', () => {
    const base = { name: 'A', language: 'en', languages: ['ro'], menu: normalizeMenu([{ label: '', target: { kind: 'account' } }, { label: 'x', target: { kind: 'bogus' } }]) } as never;
    expect(resolveMenu(base, [], [])).toEqual([]);
    expect(resolveMenu({ ...(base as object), accounts: true } as never, [], [], 'My account')).toEqual([{ title: 'My account', href: '/_/account', children: [] }]);
    expect(resolveMenu({ ...(base as object), accounts: true, language: 'ro' } as never, [], [], 'Contul meu')).toEqual([{ title: 'Contul meu', href: '/_/account?l=ro', children: [] }]);
  });
});

describe('who sees it, in the store', () => {
  test('is set for a page by any of its addresses, follows it, and goes with it', async () => {
    const store = await site('store', ['ro']);
    try {
      await store.translate('club', 'ro');
      await store.publish('club');
      await expect(store.setAudience('page', '', { who: 'signed' })).rejects.toThrow('the home page is for everyone');
      await expect(store.setAudience('page', 'nowhere', { who: 'signed' })).rejects.toThrow('no page "nowhere"');
      await expect(store.setAudience('entry', 'posts/nowhere', { who: 'signed' })).rejects.toThrow('no entry "posts/nowhere"');
      await expect(store.setAudience('type', 'nothing', { who: 'signed' })).rejects.toThrow('no content type "nothing"');
      expect((await store.setAudience('page', 'ro/club', { who: 'members', levels: ['member'] })).pages).toEqual({ club: { who: 'members', levels: ['member'] } });
      await store.setAudience('entry', 'posts/inside', { who: 'signed' });
      await store.setAudience('type', POSTS_TYPE, { who: 'signed' });
      expect(await store.audiences()).toEqual({ pages: { club: { who: 'members', levels: ['member'] } }, entries: { 'posts/inside': { who: 'signed' } }, types: { posts: { who: 'signed' } } });
      // Everyone again: null.
      expect((await store.setAudience('type', POSTS_TYPE, null)).types).toEqual({});

      await store.movePage('club', 'circle');
      expect(Object.keys((await store.audiences()).pages)).toEqual(['circle']);
      await store.deletePage('circle');
      await store.deleteEntry(POSTS_TYPE, 'inside');
      expect(await store.audiences()).toEqual({ pages: {}, entries: {}, types: {} });
    } finally {
      await store.close();
    }
  });
});

describe('a page, an entry and a type for members, as built', () => {
  test('are marked for the runtime and left out of the sitemap, the search, the feed, the data and an export', async () => {
    const store = await site('built');
    try {
      await store.setAudience('page', 'club', { who: 'members', levels: ['premium'] });
      await store.setAudience('entry', 'posts/inside', { who: 'signed' });
      const files = await publishedSite(store);
      const club = String(files.get('club/index.html'));
      expect(club).toContain('<meta name="thecms-members" content="members:premium">');
      expect(club).toContain('<meta name="robots" content="noindex">');
      expect(String(files.get('blog/inside/index.html'))).toContain('<meta name="thecms-members" content="signed">');
      expect(String(files.get('blog/open/index.html'))).not.toContain('thecms-members');
      const sitemap = String(files.get('sitemap.xml'));
      expect(sitemap).not.toContain('/club/');
      expect(sitemap).not.toContain('/blog/inside/');
      expect(sitemap).toContain('/blog/open/');
      const feed = String(files.get('blog/feed.xml'));
      expect(feed).toContain('Open post');
      expect(feed).not.toContain('Inside post');
      // The list still names it; its page asks who opens it.
      expect(String(files.get('blog/index.html'))).toContain('Inside post');
      expect(files.has('club/index.json')).toBe(false);
      expect(files.has('blog/inside/index.json')).toBe(false);
      expect(String(files.get('blog/index.json'))).not.toContain('Inside post');
      expect(String(files.get('site.json'))).not.toContain('/club/');
      expect((await publishedFor(store)).map((p) => p.address)).not.toContain('/club/');
      expect((await publishedFor(store)).map((p) => p.address)).not.toContain('/blog/inside/');
      const content = await exportContent(store, ['pages']);
      expect(content.pages?.find((p) => p.slug === 'club')?.audience).toEqual({ who: 'members', levels: ['premium'] });

      const out = join(dir, 'out');
      await exportSite(store, out);
      const written = await readFile(join(out, 'club', 'index.html'), 'utf8');
      expect(written).toContain('This page is for members and cannot be opened here.');
      expect(written).not.toContain('secret recipe');
      expect(await readFile(join(out, 'blog', 'inside', 'index.html'), 'utf8')).not.toContain('members letter');

      // A whole type: each of its lists is for members too, and it has no feed.
      await store.setAudience('type', POSTS_TYPE, { who: 'members', levels: ['member'] });
      const typed = await publishedSite(store);
      expect(String(typed.get('blog/index.html'))).toContain('<meta name="thecms-members" content="members:member">');
      expect(String(typed.get('blog/open/index.html'))).toContain('<meta name="thecms-members" content="members:member">');
      expect(typed.has('blog/feed.xml')).toBe(false);
      expect(typed.has('blog/index.json')).toBe(false);
      expect(String(typed.get('sitemap.xml'))).not.toContain('/blog/');
      expect(await publishedFor(store)).toEqual([expect.objectContaining({ address: '/' })]);
    } finally {
      await store.close();
    }
  });
});

describe('on the runtime', () => {
  test('while the accounts are off, a page for members is closed to everyone, and nothing is loaded', async () => {
    const store = await site('off');
    await store.setAudience('page', 'club', { who: 'signed' });
    const runtime = startRuntime(store, { listen: false, log: () => {} });
    try {
      const closed = await runtime.fetch(new Request('https://example.com/club/'));
      expect(closed.status).toBe(403);
      expect(closed.headers.get('cache-control')).toBe('private, no-store');
      const page = await closed.text();
      expect(page).toContain('This page cannot be opened now.');
      expect(page).not.toContain('secret recipe');
      expect(page).not.toContain('/_/account');
      expect(runtime.visitors.loaded()).toBe(false);
      for (const table of VISITOR_TABLES) expect(await store.hasTable(table)).toBe(false);
      // An open page is as it was.
      expect((await runtime.fetch(new Request('https://example.com/'))).headers.get('cache-control')).toBe('public, max-age=0, must-revalidate');
    } finally {
      runtime.stop();
      await store.close();
    }
  });

  test('asks a visitor to sign in, opens to the levels it is for, and to no cache', async () => {
    const store = await site('on');
    await store.setVisitorSettings({ on: true, signup: 'open', levels: LEVELS });
    await store.setAudience('page', 'club', { who: 'members', levels: ['premium'] });
    await store.setAudience('entry', 'posts/inside', { who: 'signed' });
    const runtime = startRuntime(store, { listen: false, log: () => {} });
    const tab = browser((r) => runtime.fetch(r));
    try {
      const asked = await tab.go('GET', '/club/');
      expect(asked.status).toBe(403);
      expect(asked.headers.get('cache-control')).toBe('private, no-store');
      const form = await asked.text();
      expect(form).toContain('<title>This page is for members · Atelier</title>');
      expect(form).toContain('data-members-sign-in');
      expect(form).toContain('action="/_/account/signin"');
      expect(form).toContain('<input type="hidden" name="back" value="/club/">');
      expect(form).toContain('href="/_/account/signup"');
      expect(form).not.toContain('secret recipe');
      expect(await (await tab.go('GET', '/blog/inside/')).text()).toContain('This page is for those with an account on this site.');

      await visitor(store, 'ana@example.com', 'long enough pass');
      const signed = await tab.go('POST', '/_/account/signin', { email: 'ana@example.com', current: 'long enough pass', back: '/club/' });
      expect([signed.status, signed.headers.get('location')]).toEqual([303, '/club/']);
      // Signed in: what is for those signed in opens; what is for a level she does not hold says so.
      const inside = await tab.go('GET', '/blog/inside/');
      expect(inside.status).toBe(200);
      expect(inside.headers.get('cache-control')).toBe('private, no-store');
      expect(await inside.text()).toContain('The members letter.');
      const level = await tab.go('GET', '/club/');
      expect(level.status).toBe(403);
      const said = await level.text();
      expect(said).toContain('data-members-level');
      expect(said).not.toContain('action="/_/account/signin"');
      expect(said).not.toContain('secret recipe');

      // The owner gives her the level: the page opens.
      const [row] = await store.database().rows<{ id: string }>('SELECT id FROM visitors');
      const editor = await startEditor(store, { listen: false, log: () => {} });
      const call = async (method: string, path: string, body?: unknown) =>
        (await editor.fetch(new Request(`http://127.0.0.1:4321${path}`, { method, headers: { host: '127.0.0.1:4321', 'x-thecms-token': editor.token, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }))).json() as Promise<Record<string, unknown>>;
      try {
        const given = (await call('PUT', `/api/visitors/levels?id=${row?.id}`, { levels: ['premium', 'nonsense'] })) as { visitors: { levels: string[] }[] };
        expect(given.visitors[0]?.levels).toEqual(['premium']);
        const open = await tab.go('GET', '/club/');
        expect(open.status).toBe(200);
        expect(open.headers.get('cache-control')).toBe('private, no-store');
        expect(await open.text()).toContain('The secret recipe.');
        // Her account says which levels she holds.
        expect(await (await tab.go('GET', '/_/account')).text()).toContain('<ul data-account-levels><li>Premium</li></ul>');

        // A level the owner takes away is taken from everyone who held it.
        await call('PUT', '/api/visitors', { levels: [LEVELS[0]] });
        expect(await store.database().rows('SELECT * FROM visitor_levels')).toEqual([]);
        expect((await tab.go('GET', '/club/')).status).toBe(403);
        expect(await (await tab.go('GET', '/_/account')).text()).toContain('You are not a member of any level yet.');
        expect((await call('PUT', '/api/visitors/levels?id=nobody', { levels: [] })).error).toBe('nobody has that account');
      } finally {
        editor.stop();
      }
    } finally {
      runtime.stop();
      await store.close();
    }
  });

  test('a new account receives the level the owner chose for new accounts', async () => {
    const store = await site('welcome');
    const sent: { text: string }[] = [];
    await store.setVisitorSettings({ on: true, signup: 'open', levels: LEVELS, welcome: 'member' });
    await store.setAudience('page', 'club', { who: 'members', levels: ['member'] });
    const runtime = startRuntime(store, { listen: false, log: () => {}, mailer: async (mail) => void sent.push(mail), from: 'site@example.com' });
    const tab = browser((r) => runtime.fetch(r));
    try {
      await tab.go('POST', '/_/account/signup', { name: 'Ion', email: 'ion@example.com', password: 'long enough pass', consent: 'yes' });
      await runtime.visitors.chores(new Date());
      const link = /https:\/\/example\.com(\/_\/account\/link\?k=[A-Za-z0-9_-]+)/.exec(sent[0]?.text ?? '')?.[1] as string;
      expect((await tab.go('POST', '/_/account/link', { k: new URL(`https://example.com${link}`).searchParams.get('k') as string })).status).toBe(303);
      expect((await tab.go('GET', '/club/')).status).toBe(200);
    } finally {
      runtime.stop();
      await store.close();
    }
  });
});

describe('in the admin', () => {
  test('"Who sees it" is there only while the accounts are on; a type is the owner\'s', async () => {
    const store = await site('admin');
    const editor = await startEditor(store, { listen: false, log: () => {} });
    const call = async (method: string, path: string, body?: unknown) =>
      editor.fetch(new Request(`http://127.0.0.1:4321${path}`, { method, headers: { host: '127.0.0.1:4321', 'x-thecms-token': editor.token, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }));
    try {
      expect(await (await call('GET', '/api/audiences')).json()).toEqual({ on: false });
      expect((await call('PUT', '/api/audiences', { kind: 'page', key: 'club', audience: null })).status).toBe(404);
      await call('PUT', '/api/visitors', { on: true, signup: 'invite', levels: LEVELS, welcome: 'premium' });
      const shown = (await (await call('GET', '/api/visitors')).json()) as { settings: { levels: unknown; welcome: string } };
      expect(shown.settings).toMatchObject({ levels: LEVELS, welcome: 'premium' });
      expect((await call('PUT', '/api/audiences', { kind: 'nothing', key: 'club' })).status).toBe(400);
      const set = (await (await call('PUT', '/api/audiences', { kind: 'page', key: 'club', audience: { who: 'members', levels: ['member'] } })).json()) as Record<string, unknown>;
      expect(set).toEqual({ audiences: { pages: { club: { who: 'members', levels: ['member'] } }, entries: {}, types: {} }, levels: LEVELS });
      expect((await call('PUT', '/api/audiences', { kind: 'page', key: '', audience: { who: 'signed' } })).status).toBe(400);
      // The menu's "My account", while the accounts are on.
      await store.setSite({ ...(await store.site()), menu: [{ label: '', target: { kind: 'page', slug: '' } }, { label: '', target: { kind: 'account' } }] });
      expect(String((await publishedSite(store)).get('index.html'))).toContain('href="/_/account"');
      await call('PUT', '/api/visitors', { on: false });
      expect(String((await publishedSite(store)).get('index.html'))).not.toContain('href="/_/account"');
      expect(await (await call('GET', '/api/audiences')).json()).toEqual({ on: false });
      // What was chosen stays: the page is still for members.
      expect(String((await publishedSite(store)).get('club/index.html'))).toContain('thecms-members');
    } finally {
      editor.stop();
      await store.close();
    }
  });
});
