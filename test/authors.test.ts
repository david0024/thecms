/**
 * Authors and contributors (ADR 0055): the store keeps who wrote each entry
 * and where it is in its review, on every database; the served editor keeps an
 * author and a contributor to their own entries; the site names who wrote a
 * post.
 */
import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { postsType } from '../src/core/index.ts';
import { publishedSite } from '../src/site/export.ts';
import { type EditorServer, startEditor } from '../src/site/server.ts';
import { cleanRole, Store, writesAll } from '../src/site/store.ts';
import plain from '../themes/plain.json';

const dir = await mkdtemp(join(tmpdir(), 'thecms-authors-'));
afterAll(() => rm(dir, { recursive: true, force: true }));

const PASSWORD = 'a long enough password';

test('the four roles, and what an unknown one is', () => {
  expect(['owner', 'editor', 'author', 'contributor'].map(cleanRole)).toEqual(['owner', 'editor', 'author', 'contributor']);
  expect(cleanRole('admin')).toBe('contributor');
  expect(cleanRole(undefined)).toBe('contributor');
  expect(['owner', 'editor', 'author', 'contributor'].map((r) => writesAll(cleanRole(r)))).toEqual([true, true, false, false]);
});

const databases: [string, string][] = [['SQLite', join(dir, 'store.db')]];
if (process.env.THECMS_TEST_POSTGRES) databases.push(['Postgres', process.env.THECMS_TEST_POSTGRES]);
if (process.env.THECMS_TEST_MYSQL) databases.push(['MySQL', process.env.THECMS_TEST_MYSQL]);

for (const [name, address] of databases) {
  describe(`authors on ${name}`, () => {
    let store: Store;
    beforeEach(async () => {
      const old = await Store.open(address);
      for (const table of ['users', 'sessions', 'links', 'entries', 'entry_authors', 'entry_reviews', 'user_bios']) await old.rawForTests(`DROP TABLE IF EXISTS ${table}`);
      await old.close();
      store = await Store.open(address);
    });
    afterEach(() => store.close());

    test('whoever creates an entry is its author; saving it again, or by someone else, changes nothing', async () => {
      const ana = await store.addUser({ email: 'ana@example.com', name: 'Ana Pop', role: 'author', password: PASSWORD });
      const ion = await store.addUser({ email: 'ion@example.com', role: 'editor', password: PASSWORD });
      await store.saveEntry('posts', { slug: 'oak', title: 'Oak' }, ana.id);
      await store.saveEntry('posts', { slug: 'oak', title: 'Oak, again' }, ion.id);
      await store.saveEntry('posts', { slug: 'old', title: 'Made before' });
      expect(await store.entryAuthor('posts', 'oak')).toBe(ana.id);
      expect(await store.entryAuthor('posts', 'old')).toBe('');
      expect([...(await store.entryAuthors())]).toEqual([['posts/oak', ana.id]]);
      expect(await store.bylines()).toEqual({ 'posts/oak': { name: 'Ana Pop', bio: '' } });

      // An editor gives an entry to someone, or to nobody; never to someone without an account.
      await store.setEntryAuthor('posts', 'old', ion.id);
      expect(await store.entryAuthor('posts', 'old')).toBe(ion.id);
      // Ion has no name: no byline for him.
      expect(Object.keys(await store.bylines())).toEqual(['posts/oak']);
      await expect(store.setEntryAuthor('posts', 'old', 'nobody')).rejects.toThrow('nobody has that account');
      await expect(store.setEntryAuthor('posts', 'none', ion.id)).rejects.toThrow('no entry "none"');
      await store.setEntryAuthor('posts', 'old', '');
      expect(await store.entryAuthor('posts', 'old')).toBe('');

      // A name and a few words, set by themselves.
      await store.setProfile(ion.id, '  Ion Popa ', 'Writes about wood. '.repeat(30));
      expect((await store.user(ion.id))?.name).toBe('Ion Popa');
      expect((await store.user(ion.id))?.bio).toHaveLength(300);
      await expect(store.setProfile('nobody', 'x', '')).rejects.toThrow('nobody has that account');

      // Someone removed leaves what they wrote to someone who stays (d5).
      await expect(store.removeUser(ana.id, ana.id)).rejects.toThrow('someone who stays');
      await expect(store.removeUser(ana.id, 'nobody')).rejects.toThrow('someone who stays');
      await store.removeUser(ana.id, ion.id);
      expect(await store.entryAuthor('posts', 'oak')).toBe(ion.id);
      await store.removeUser(ion.id);
      expect(await store.entryAuthor('posts', 'oak')).toBe('');

      // A deleted entry takes its author with it.
      const eva = await store.addUser({ email: 'eva@example.com', role: 'author', password: PASSWORD });
      await store.saveEntry('posts', { slug: 'gone', title: 'Gone' }, eva.id);
      await store.deleteEntry('posts', 'gone');
      expect(await store.saveEntry('posts', { slug: 'gone', title: 'Gone' }).then(() => store.entryAuthor('posts', 'gone'))).toBe('');
    });

    test('an entry is sent for review, sent back with a note, and its review ends when it is published', async () => {
      await store.saveEntry('posts', { slug: 'recipe', title: 'Recipe' }, 'mihai');
      expect(await store.reviews()).toEqual([]);
      await expect(store.returnReview('posts', 'recipe', 'no')).rejects.toThrow('not waiting for review');
      await expect(store.askReview('posts', 'none')).rejects.toThrow('no entry "none"');
      await store.askReview('posts', 'recipe', new Date('2026-11-21T10:00:00Z'));
      expect(await store.reviews()).toEqual([{ type: 'posts', slug: 'recipe', state: 'waiting', note: '', at: '2026-11-21T10:00:00.000Z' }]);
      await store.returnReview('posts', 'recipe', ` ${'Less salt. '.repeat(60)}`);
      const [back] = await store.reviews();
      expect(back?.state).toBe('returned');
      expect(back?.note).toStartWith('Less salt.');
      expect(back?.note.length).toBeLessThanOrEqual(500);
      await store.askReview('posts', 'recipe');
      expect((await store.reviews())[0]).toMatchObject({ state: 'waiting', note: '' });
      expect(await store.entryPublished('posts', 'recipe')).toBe(false);
      await store.publishEntry('posts', 'recipe');
      expect(await store.entryPublished('posts', 'recipe')).toBe(true);
      expect(await store.reviews()).toEqual([]);
      await store.askReview('posts', 'recipe');
      await store.deleteEntry('posts', 'recipe');
      expect(await store.reviews()).toEqual([]);
    });
  });
}

describe('the served editor, for an author and a contributor', () => {
  const PUBLIC = 'https://cms.example.com';
  let store: Store;
  let editor: EditorServer;
  let siteDir: string;
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};

  const call = async (who: string, method: string, path: string, body?: unknown) => {
    const response = await editor.fetch(
      new Request(`${PUBLIC}${path}`, {
        method,
        headers: { host: 'cms.example.com', origin: PUBLIC, 'x-thecms-request': '1', cookie: cookies[who] ?? '', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
    return { status: response.status, data: (await response.json()) as Record<string, unknown> };
  };
  const error = async (who: string, method: string, path: string, body?: unknown): Promise<unknown> => (await call(who, method, path, body)).data.error;
  const entry = (slug: string, title = slug) => ({ slug, title, blocks: [] });

  beforeEach(async () => {
    siteDir = await mkdtemp(join(tmpdir(), 'thecms-authors-served-'));
    store = await Store.open(join(siteDir, 'site.db'));
    await store.setSite({ name: 'S', url: 'https://example.com', types: [postsType(), { id: 'projects', name: 'Projects', singular: 'Project' }] });
    await store.setTheme(plain);
    editor = await startEditor(store, { listen: false, public: PUBLIC });
    for (const [who, role] of [
      ['owner', 'owner'],
      ['editor', 'editor'],
      ['ana', 'author'],
      ['dan', 'author'],
      ['mihai', 'contributor'],
    ] as const) {
      const user = await store.addUser({ email: `${who}@example.com`, name: who === 'ana' ? 'Ana Pop' : '', role, password: PASSWORD });
      ids[who] = user.id;
      cookies[who] = `thecms_session=${await store.startSession(user.id)}`;
    }
  });
  afterEach(async () => {
    editor.stop();
    await store.close();
    await rm(siteDir, { recursive: true, force: true });
  });

  test('an author writes, publishes, sets for later and deletes their own entries, and nothing else', async () => {
    await store.savePage({ slug: 'about', title: 'About', blocks: [] });
    // A new entry is theirs.
    expect((await call('ana', 'PUT', '/api/page', { page: entry('oak', 'Oak'), kind: 'post', create: true })).status).toBe(200);
    expect(await store.entryAuthor('posts', 'oak')).toBe(ids.ana as string);
    expect((await call('ana', 'PUT', '/api/page', { page: entry('oak', 'Oak door'), kind: 'post' })).status).toBe(200);
    expect((await call('ana', 'POST', '/api/publish', { slug: 'oak', kind: 'post' })).status).toBe(200);
    expect((await call('ana', 'POST', '/api/schedule', { kind: 'posts', slug: 'oak', at: new Date(Date.now() + 86_400_000).toISOString() })).status).toBe(200);
    expect((await call('ana', 'DELETE', '/api/schedule?kind=posts&slug=oak')).status).toBe(200);
    expect((await call('ana', 'PUT', '/api/page', { page: entry('bridge'), kind: 'projects', create: true })).status).toBe(200);

    // Dan's entries, an entry with no author, the pages and the sections are not hers.
    await call('dan', 'PUT', '/api/page', { page: entry('pine'), kind: 'post', create: true });
    await store.saveEntry('posts', entry('old'));
    for (const slug of ['pine', 'old']) {
      expect(await error('ana', 'PUT', '/api/page', { page: entry(slug, 'Mine now'), kind: 'post' })).toBe("this entry is someone else's");
      expect(await error('ana', 'POST', '/api/publish', { slug, kind: 'post' })).toBe("this entry is someone else's");
      expect(await error('ana', 'DELETE', `/api/page?slug=${slug}&kind=post`)).toBe("this entry is someone else's");
    }
    expect(await error('ana', 'POST', '/api/schedule', { kind: 'posts', slug: 'pine', at: new Date(Date.now() + 86_400_000).toISOString() })).toBe("this entry is someone else's");
    expect(await error('ana', 'PUT', '/api/page', { page: entry('about', 'Mine'), kind: 'page' })).toContain('the pages and the sections');
    expect(await error('ana', 'PUT', '/api/page', { page: entry('home', 'New'), kind: 'page', create: true })).toContain('the pages and the sections');
    expect(await error('ana', 'POST', '/api/publish', { slug: 'about' })).toContain('the pages and the sections');
    expect(await error('ana', 'PUT', '/api/page', { page: entry('footer'), kind: '_section', create: true })).toContain('the pages and the sections');
    expect(await error('ana', 'PUT', '/api/page', { page: { blocks: [] }, kind: 'template:posts' })).toContain('the pages and the sections');
    for (const [method, path] of [
      ['GET', '/api/stats'],
      ['GET', '/api/comments'],
      ['POST', '/api/move'],
      ['DELETE', '/api/media?name=x.png'],
      ['POST', '/api/locks'],
      ['PUT', '/api/author'],
      ['POST', '/api/review/return'],
      ['POST', '/api/extensions/x/each/y'],
    ]) {
      expect((await call('ana', method as string, path as string, method === 'GET' || method === 'DELETE' ? undefined : {})).status).toBe(403);
    }
    // What only the owner does stays the owner's.
    expect(await error('ana', 'GET', '/api/users')).toBe('only the owner may do this');

    // She reads the site, the pages and the others' entries, draws them, and uploads to the library.
    expect((await call('ana', 'GET', '/api/state')).status).toBe(200);
    expect((await call('ana', 'GET', '/api/page?slug=about')).status).toBe(200);
    expect((await call('ana', 'GET', '/api/page?slug=pine&kind=post')).status).toBe(200);
    expect((await call('ana', 'GET', '/api/schedule')).status).toBe(200);
    expect((await call('ana', 'GET', '/api/media')).status).toBe(200);

    // And deletes her own.
    expect((await call('ana', 'DELETE', '/api/page?slug=oak&kind=post')).status).toBe(200);
    expect(await store.entryDraft('posts', 'oak')).toBeNull();
  });

  test('a contributor sends for review; an editor sends it back, then publishes it; then it is no longer the contributor’s', async () => {
    expect((await call('mihai', 'PUT', '/api/page', { page: entry('soup', 'Soup'), kind: 'post', create: true })).status).toBe(200);
    expect(await error('mihai', 'POST', '/api/publish', { slug: 'soup', kind: 'post' })).toContain('sends an entry for review');
    expect(await error('mihai', 'POST', '/api/schedule', { kind: 'posts', slug: 'soup', at: new Date(Date.now() + 86_400_000).toISOString() })).toContain('sends an entry for review');
    expect(await error('mihai', 'POST', '/api/review', { kind: 'post', slug: 'other' })).toBe("this entry is someone else's");
    const sent = await call('mihai', 'POST', '/api/review', { kind: 'post', slug: 'soup' });
    expect(sent.status).toBe(200);
    const listed = (sent.data.entries as Record<string, { slug: string; author?: string; review?: { state: string } }[]>).posts?.find((e) => e.slug === 'soup');
    expect(listed).toMatchObject({ author: ids.mihai, review: { state: 'waiting' } });

    // The editor sends it back, with a note the contributor reads.
    const back = await call('editor', 'POST', '/api/review/return', { kind: 'post', slug: 'soup', note: 'Less salt.' });
    expect((back.data.entries as Record<string, { review?: unknown }[]>).posts?.[0]?.review).toMatchObject({ state: 'returned', note: 'Less salt.' });
    expect((await call('mihai', 'PUT', '/api/page', { page: entry('soup', 'Soup, less salty'), kind: 'post' })).status).toBe(200);
    await call('mihai', 'POST', '/api/review', { kind: 'post', slug: 'soup' });

    // The editor publishes it: the review is over, and the entry is the editors' now.
    expect((await call('editor', 'POST', '/api/publish', { slug: 'soup', kind: 'post' })).status).toBe(200);
    expect(await store.reviews()).toEqual([]);
    expect(await error('mihai', 'PUT', '/api/page', { page: entry('soup', 'Changed'), kind: 'post' })).toContain('this entry is published');
    expect(await error('mihai', 'DELETE', '/api/page?slug=soup&kind=post')).toContain('this entry is published');
    expect(await error('mihai', 'POST', '/api/review', { kind: 'post', slug: 'soup' })).toContain('this entry is published');
  });

  test('an editor names an entry’s author; each person sets their own name and words; the site shows them', async () => {
    await store.publishTheme();
    await store.publish((await store.savePage({ slug: '', title: 'Home', blocks: [] })).slug);
    await call('ana', 'PUT', '/api/page', { page: { ...entry('oak', 'Oak'), date: '2026-11-20' }, kind: 'post', create: true });
    await call('ana', 'POST', '/api/publish', { slug: 'oak', kind: 'post' });
    await store.saveEntry('posts', { ...entry('old', 'Old'), date: '2026-01-01' });
    await store.publishEntry('posts', 'old');

    // Ana's name is shown under her post, and is the author for search engines.
    let files = await publishedSite(store);
    const oak = String(files.get('blog/oak/index.html'));
    expect(oak).toContain('by Ana Pop');
    expect(oak).toContain('"author":{"@type":"Person","name":"Ana Pop"}');
    expect(oak).not.toContain('data-author');
    expect(String(files.get('blog/old/index.html'))).not.toContain('by ');

    // She writes a few words about herself: they are at the end of her post, without publishing it again.
    const me = await call('ana', 'PUT', '/api/me', { name: 'Ana Pop', bio: 'Ana restores old doors.' });
    expect(me.data.me).toMatchObject({ name: 'Ana Pop', bio: 'Ana restores old doors.' });
    files = await publishedSite(store);
    expect(String(files.get('blog/oak/index.html'))).toContain('Ana restores old doors.');

    // The editor's canvas shows the byline too.
    const drawn = await call('editor', 'POST', '/api/render', { page: { ...entry('oak', 'Oak'), date: '2026-11-20' }, kind: 'post' });
    expect(String(drawn.data.body)).toContain('by Ana Pop');

    // The editor gives the old post to Ana; an author cannot give hers away.
    expect(await error('ana', 'PUT', '/api/author', { kind: 'post', slug: 'oak', id: ids.dan })).toBe('an author writes their own entries only');
    expect((await call('editor', 'PUT', '/api/author', { kind: 'post', slug: 'old', id: ids.ana })).status).toBe(200);
    expect(String((await publishedSite(store)).get('blog/old/index.html'))).toContain('by Ana Pop');
    expect((await call('editor', 'GET', '/api/state')).data.people).toContainEqual({ id: ids.ana, name: 'Ana Pop', role: 'author' });
    // An author is told names only, never addresses.
    expect((await call('ana', 'GET', '/api/state')).data.people).toContainEqual({ id: ids.dan, name: '', role: 'author' });

    // The owner removes Ana: her posts pass to the owner, and stay published.
    expect((await call('owner', 'DELETE', `/api/users?id=${ids.ana}`)).status).toBe(200);
    expect(await store.entryAuthor('posts', 'oak')).toBe(ids.owner as string);
    expect(await store.entryPublished('posts', 'oak')).toBe(true);
  });

  test('on one\'s own computer there are no accounts to name', async () => {
    const local = await startEditor(store, { listen: false });
    const response = await local.fetch(
      new Request(local.url.split('#')[0]?.replace('/admin/', '/api/me') ?? '', { method: 'PUT', headers: { 'x-thecms-token': local.token, 'content-type': 'application/json' }, body: '{}' }),
    );
    expect(response.status).toBe(404);
    local.stop();
  });
});
