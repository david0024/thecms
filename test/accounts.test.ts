/**
 * Accounts (ADR 0022): the store keeps people, sessions and one-time links on
 * every database; the served editor lets in only who signed in, and only the
 * owner does the owner's things.
 */
import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanPublicAddress, cookieOf, ownerOnly } from '../src/site/accounts.ts';
import { main } from '../src/site/cli.ts';
import { type EditorServer, startEditor } from '../src/site/server.ts';
import { cleanEmail, passwordProblem, Store } from '../src/site/store.ts';
import plain from '../themes/plain.json';

const dir = await mkdtemp(join(tmpdir(), 'thecms-accounts-'));
afterAll(() => rm(dir, { recursive: true, force: true }));

const databases: [string, string][] = [['SQLite', join(dir, 'store.db')]];
if (process.env.THECMS_TEST_POSTGRES) databases.push(['Postgres', process.env.THECMS_TEST_POSTGRES]);
if (process.env.THECMS_TEST_MYSQL) databases.push(['MySQL', process.env.THECMS_TEST_MYSQL]);

const PASSWORD = 'a long enough password';

for (const [name, address] of databases) {
  describe(`people on ${name}`, () => {
    let store: Store;
    beforeEach(async () => {
      const old = await Store.open(address);
      for (const table of ['users', 'sessions', 'links']) await old.rawForTests(`DROP TABLE IF EXISTS ${table}`);
      await old.close();
      store = await Store.open(address);
    });
    afterEach(() => store.close());

    test('someone invited has no password until they choose one; then the right one signs them in', async () => {
      const ana = await store.addUser({ email: '  Ana@Example.com ', role: 'editor' });
      expect(ana).toMatchObject({ email: 'ana@example.com', role: 'editor', active: false });
      expect(await store.checkPassword('ana@example.com', '')).toBeNull();
      await store.setPassword(ana.id, PASSWORD, 'Ana');
      expect(await store.user(ana.id)).toMatchObject({ name: 'Ana', active: true });
      expect((await store.checkPassword('ANA@example.com', PASSWORD))?.id).toBe(ana.id);
      expect(await store.checkPassword('ana@example.com', 'a wrong password!')).toBeNull();
      expect(await store.checkPassword('nobody@example.com', PASSWORD)).toBeNull();
      expect(await store.checkPassword('ana@example.com', 'x'.repeat(201))).toBeNull();
      await expect(store.addUser({ email: 'ana@example.com', role: 'owner' })).rejects.toThrow('already has an account');
      await expect(store.addUser({ email: 'not an address', role: 'owner' })).rejects.toThrow('not an email address');
      await expect(store.setPassword(ana.id, 'short')).rejects.toThrow('at least 10');
      await expect(store.setPassword(ana.id, 'x'.repeat(201))).rejects.toThrow('at most 200');
    });

    test('a session signs one person in until it ends, runs out, or their password changes', async () => {
      const ana = await store.addUser({ email: 'ana@example.com', role: 'owner', password: PASSWORD });
      const secret = await store.startSession(ana.id);
      expect((await store.sessionUser(secret))?.id).toBe(ana.id);
      expect(await store.sessionUser('')).toBeNull();
      expect(await store.sessionUser('made up')).toBeNull();
      expect(await store.sessionUser(secret, new Date(Date.now() + 31 * 86_400_000))).toBeNull();
      expect(await store.sessionUser(secret)).toBeNull();
      const other = await store.startSession(ana.id);
      await store.endSession(other);
      expect(await store.sessionUser(other)).toBeNull();
      const third = await store.startSession(ana.id);
      await store.setPassword(ana.id, `${PASSWORD}!`);
      expect(await store.sessionUser(third)).toBeNull();
      // What is kept is the secret's hash, never the secret.
      expect(JSON.stringify(await store.users())).not.toContain('argon2');
    });

    test('a link works once, for its hours, and a new one replaces the old', async () => {
      const ana = await store.addUser({ email: 'ana@example.com', role: 'editor' });
      const first = await store.makeLink('invite', ana.id, 72);
      const second = await store.makeLink('invite', ana.id, 72);
      expect(await store.link(first)).toBeNull();
      expect(await store.link(second)).toMatchObject({ kind: 'invite', user: { id: ana.id } });
      expect(await store.link(second, false, new Date(Date.now() + 73 * 3_600_000))).toBeNull();
      const [one, two] = await Promise.all([store.link(second, true), store.link(second, true)]);
      expect([one, two].filter(Boolean)).toHaveLength(1);
      expect(await store.link(second)).toBeNull();
      expect(await store.link('')).toBeNull();
      const setup = await store.makeLink('setup', '', 1);
      expect(await store.link(setup)).toEqual({ kind: 'setup', user: null });
    });

    test('the site always keeps an owner', async () => {
      const ana = await store.addUser({ email: 'ana@example.com', role: 'owner', password: PASSWORD });
      const ion = await store.addUser({ email: 'ion@example.com', role: 'editor', password: PASSWORD });
      await expect(store.setRole(ana.id, 'editor')).rejects.toThrow('needs an owner');
      await expect(store.removeUser(ana.id)).rejects.toThrow('needs an owner');
      await store.setRole(ion.id, 'owner');
      await store.setRole(ana.id, 'editor');
      const session = await store.startSession(ana.id);
      await store.makeLink('reset', ana.id, 72);
      await store.removeUser(ana.id);
      expect((await store.users()).map((u) => u.email)).toEqual(['ion@example.com']);
      expect(await store.sessionUser(session)).toBeNull();
    });
  });
}

test('an address, a password and a public address are checked before they are kept', () => {
  expect(cleanEmail(' Ana@Example.COM ')).toBe('ana@example.com');
  for (const bad of ['ana', 'ana@example', 'a b@example.com', '<a@example.com>', `${'a'.repeat(250)}@example.com`]) expect(cleanEmail(bad)).toBe('');
  expect(passwordProblem('short')).toContain('at least');
  expect(passwordProblem(PASSWORD)).toBe('');
  expect(cleanPublicAddress('https://cms.example.com/')).toBe('https://cms.example.com');
  expect(cleanPublicAddress('http://127.0.0.1:4400')).toBe('http://127.0.0.1:4400');
  for (const bad of ['http://cms.example.com', 'https://cms.example.com/admin', 'https://u:p@cms.example.com', 'https://cms.example.com/?a=1', 'https://cms.example.com/#x', 'ftp://cms.example.com', 'cms.example.com'])
    expect(cleanPublicAddress(bad)).toBe('');
  expect(cookieOf(new Request('http://x/', { headers: { cookie: 'a=1; thecms_session=abc=; b=2' } }))).toBe('abc=');
  expect(cookieOf(new Request('http://x/'))).toBe('');
  expect(ownerOnly('GET', '/api/users')).toBe(true);
  expect(ownerOnly('GET', '/api/theme')).toBe(false);
  expect(ownerOnly('PUT', '/api/site')).toBe(true);
  expect(ownerOnly('PUT', '/api/page')).toBe(false);
});

describe('the served editor', () => {
  const PUBLIC = 'https://cms.example.com';
  let store: Store;
  let editor: EditorServer;
  let siteDir: string;

  /** A call as the admin's own page makes it: its host, its origin, its header, and a cookie when signed in. */
  const call = async (method: string, path: string, body?: unknown, cookie = '', headers: Record<string, string> = {}) => {
    const response = await editor.fetch(
      new Request(`${PUBLIC}${path}`, {
        method,
        headers: { host: 'cms.example.com', origin: PUBLIC, 'x-thecms-request': '1', ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
    return { status: response.status, data: (await response.json()) as Record<string, unknown>, cookie: response.headers.get('set-cookie') ?? '' };
  };
  const secretOf = (link: unknown): string => String(link).split('#link=')[1] ?? '';
  const session = (setCookie: string): string => setCookie.split(';')[0] ?? '';

  beforeEach(async () => {
    siteDir = await mkdtemp(join(tmpdir(), 'thecms-served-'));
    store = await Store.open(join(siteDir, 'site.db'));
    await store.setSite({ name: 'S' });
    await store.setTheme(plain);
    editor = await startEditor(store, { listen: false, public: `${PUBLIC}/` });
  });
  afterEach(async () => {
    editor.stop();
    await store.close();
    await rm(siteDir, { recursive: true, force: true });
  });

  test('the first owner comes from the setup link, once', async () => {
    expect(editor.url).toBe(`${PUBLIC}/admin/`);
    expect(editor.setupUrl).toStartWith(`${PUBLIC}/admin/#link=`);
    const secret = secretOf(editor.setupUrl);
    expect((await call('GET', '/api/state')).status).toBe(401);
    expect((await call('POST', '/api/link', { secret })).data).toEqual({ kind: 'setup', email: '', name: '' });
    // A short password or a wrong address does not spend the link.
    expect((await call('POST', '/api/link/use', { secret, name: 'Ana', email: 'ana@example.com', password: 'short' })).data.error).toContain('at least 10');
    expect((await call('POST', '/api/link/use', { secret, name: 'Ana', email: 'ana', password: PASSWORD })).data.error).toBe('that is not an email address');
    const used = await call('POST', '/api/link/use', { secret, name: 'Ana', email: 'ana@example.com', password: PASSWORD });
    expect(used.status).toBe(200);
    expect(used.data.me).toMatchObject({ email: 'ana@example.com', name: 'Ana', role: 'owner' });
    expect(used.cookie).toMatch(/^thecms_session=[\w-]+; Path=\/; HttpOnly; SameSite=Strict; Max-Age=2592000; Secure$/);
    const state = await call('GET', '/api/state', undefined, session(used.cookie));
    expect(state.data).toMatchObject({ accounts: true, me: { role: 'owner' } });
    expect((await call('POST', '/api/link/use', { secret, name: 'Eve', email: 'eve@example.com', password: PASSWORD })).status).toBe(410);
    expect((await call('POST', '/api/link', { secret })).status).toBe(410);
    // With an owner, no new setup link is made.
    expect((await startEditor(store, { listen: false, public: PUBLIC })).setupUrl).toBe('');
    // A setup link from before an owner existed no longer makes one.
    const late = await store.makeLink('setup', '', 1);
    expect((await call('POST', '/api/link', { secret: late })).status).toBe(410);
    expect((await call('POST', '/api/link/use', { secret: late, name: 'Eve', email: 'eve@example.com', password: PASSWORD })).status).toBe(410);
  });

  test('a call must come from the admin itself: its host, its origin and its header', async () => {
    const owner = await store.addUser({ email: 'ana@example.com', role: 'owner', password: PASSWORD });
    const cookie = `thecms_session=${await store.startSession(owner.id)}`;
    expect((await call('GET', '/api/state', undefined, cookie)).status).toBe(200);
    expect((await call('GET', '/api/state', undefined, cookie, { host: '127.0.0.1:4321' })).data.error).toBe('wrong host');
    expect((await call('GET', '/api/state', undefined, cookie, { origin: 'https://evil.example' })).data.error).toBe('wrong origin');
    expect((await call('GET', '/api/state', undefined, cookie, { 'x-thecms-request': '' })).data.error).toBe('not a call from the admin');
    // The key of the editor on one's own computer means nothing here.
    expect((await call('GET', '/api/state', undefined, '', { 'x-thecms-token': editor.token })).data).toEqual({ error: 'sign in first', signIn: true });
  });

  test('signing in, too many wrong passwords, and signing out', async () => {
    await store.addUser({ email: 'ana@example.com', role: 'owner', password: PASSWORD });
    const wrong = await call('POST', '/api/session', { email: 'ana@example.com', password: 'not the password' });
    expect(wrong).toMatchObject({ status: 401, data: { signIn: true } });
    const right = await call('POST', '/api/session', { email: ' ANA@example.com', password: PASSWORD });
    expect(right.status).toBe(200);
    const cookie = session(right.cookie);
    expect((await call('GET', '/api/state', undefined, cookie)).status).toBe(200);
    const out = await call('DELETE', '/api/session', undefined, cookie);
    expect(out.cookie).toContain('Max-Age=0');
    expect((await call('GET', '/api/state', undefined, cookie)).status).toBe(401);
    for (let i = 0; i < 10; i++) await call('POST', '/api/session', { email: 'ana@example.com', password: `guess number ${i}` });
    const blocked = await call('POST', '/api/session', { email: 'ana@example.com', password: PASSWORD });
    expect(blocked.status).toBe(429);
    // Another address is not held back by it.
    expect((await call('POST', '/api/session', { email: 'ion@example.com', password: PASSWORD })).status).toBe(401);
    expect((await call('POST', '/api/session', 'not an object')).status).toBe(401);
  });

  test('the owner invites; an editor writes content and nothing else', async () => {
    const owner = await store.addUser({ email: 'ana@example.com', role: 'owner', password: PASSWORD });
    const ownerCookie = `thecms_session=${await store.startSession(owner.id)}`;
    expect(((await call('GET', '/api/users', undefined, ownerCookie)).data.me as { email: string }).email).toBe('ana@example.com');
    const invited = await call('POST', '/api/users', { email: 'ion@example.com', role: 'editor' }, ownerCookie);
    expect(invited.status).toBe(200);
    expect((invited.data.users as { email: string; active: boolean }[]).find((u) => u.email === 'ion@example.com')?.active).toBe(false);
    const secret = secretOf(invited.data.link);
    expect((await call('POST', '/api/link', { secret })).data).toEqual({ kind: 'invite', email: 'ion@example.com', name: '' });
    const joined = await call('POST', '/api/link/use', { secret, name: 'Ion', password: PASSWORD });
    expect(joined.data.me).toMatchObject({ name: 'Ion', role: 'editor' });
    const editorCookie = session(joined.cookie);

    expect((await call('GET', '/api/state', undefined, editorCookie)).data.me).toMatchObject({ role: 'editor' });
    const page = { slug: 'about', title: 'About', description: '', inMenu: true, blocks: [] };
    expect((await call('PUT', '/api/page', { page, create: true, kind: 'page' }, editorCookie)).status).toBe(200);
    expect((await call('POST', '/api/publish', { slug: 'about', kind: 'page' }, editorCookie)).status).toBe(200);
    expect((await call('GET', '/api/theme', undefined, editorCookie)).status).not.toBe(403);
    for (const [method, path, body] of [
      ['PUT', '/api/site', { site: { name: 'Mine' } }],
      ['PUT', '/api/theme', { theme: plain }],
      ['POST', '/api/theme/publish', {}],
      ['GET', '/api/users', undefined],
      ['GET', '/api/messages', undefined],
      ['GET', '/api/import', undefined],
    ] as const)
      expect((await call(method, path, body, editorCookie)).data.error).toBe('only the owner may do this');
    // How a content type's page looks is the owner's too; the editor sees it.
    expect((await call('PUT', '/api/page', { page, kind: 'template:posts' }, editorCookie)).data.error).toBe('only the owner may change this');
    expect((await call('GET', '/api/page?kind=template:posts&slug=posts', undefined, editorCookie)).status).toBe(200);

    // A new link for someone who has a password is for a new one, and signs them out.
    const reset = await call('POST', '/api/users/link', { id: (joined.data.me as { id: string }).id }, ownerCookie);
    const resetSecret = secretOf(reset.data.link);
    expect((await call('POST', '/api/link', { secret: resetSecret })).data).toMatchObject({ kind: 'reset', email: 'ion@example.com', name: 'Ion' });
    expect((await call('POST', '/api/link/use', { secret: resetSecret, password: `${PASSWORD} new` })).status).toBe(200);
    expect((await call('GET', '/api/state', undefined, editorCookie)).status).toBe(401);
    expect((await call('POST', '/api/session', { email: 'ion@example.com', password: `${PASSWORD} new` })).status).toBe(200);

    const ion = (joined.data.me as { id: string }).id;
    expect(((await call('PUT', '/api/users', { id: ion, role: 'owner' }, ownerCookie)).data.users as { role: string }[]).map((u) => u.role)).toEqual(['owner', 'owner']);
    expect((await call('DELETE', `/api/users?id=${ion}`, undefined, ownerCookie)).data.users).toHaveLength(1);
    expect((await call('DELETE', `/api/users?id=${owner.id}`, undefined, ownerCookie)).data.error).toBe('the site needs an owner');
    expect((await call('POST', '/api/users/link', { id: 'nobody' }, ownerCookie)).status).toBe(404);
    expect((await call('PATCH', '/api/users', {}, ownerCookie)).status).toBe(404);
    expect((await call('GET', '/api/users/other', undefined, ownerCookie)).status).toBe(404);
    expect((await call('POST', '/api/users', { email: 'ana@example.com' }, ownerCookie)).data.error).toBe('someone with this address already has an account');
  });

  test('on one\'s own computer there are no accounts, and a public address must be one', async () => {
    const local = await startEditor(store, { listen: false });
    const response = await local.fetch(new Request('http://127.0.0.1:4321/api/users', { headers: { host: '127.0.0.1:4321', 'x-thecms-token': local.token } }));
    expect(response.status).toBe(404);
    const state = (await (await local.fetch(new Request('http://127.0.0.1:4321/api/state', { headers: { host: '127.0.0.1:4321', 'x-thecms-token': local.token } }))).json()) as Record<string, unknown>;
    expect(state).toMatchObject({ accounts: false, me: { role: 'owner' } });
    expect(local.setupUrl).toBe('');
    await expect(startEditor(store, { listen: false, public: 'http://cms.example.com' })).rejects.toThrow('the public address is https://');
  });
});

describe('the command line for a served editor', () => {
  let said: string[];
  let log: ReturnType<typeof spyOn>;
  beforeEach(() => {
    said = [];
    log = spyOn(console, 'log').mockImplementation((...words: unknown[]) => void said.push(words.join(' ')));
  });
  afterEach(() => log.mockRestore());

  test('serve prints the setup link while there is no owner, and reset-link makes a new password link', async () => {
    const db = join(dir, 'served.db');
    await main(['init', db]);
    await expect(main(['serve', db])).rejects.toThrow('--public=');
    await expect(main(['serve', join(dir, 'none.db'), '--public=https://cms.example.com'])).rejects.toThrow('does not exist');
    const served = await main(['serve', db, '--public=https://cms.example.com', '--port=0']);
    served?.stop();
    expect(said.join('\n')).toMatch(/Open this link within the hour[^\n]*\n\n {2}https:\/\/cms\.example\.com\/admin\/#link=[\w-]+/);

    const store = await Store.open(db);
    const ana = await store.addUser({ email: 'ana@example.com', role: 'owner', password: PASSWORD });
    const ion = await store.addUser({ email: 'ion@example.com', role: 'editor' });
    await store.close();
    said = [];
    const again = await main(['serve', db, '--public=https://cms.example.com', '--port=0']);
    again?.stop();
    expect(said.join('\n')).toContain('Sign in there with your account.');

    said = [];
    await main(['reset-link', db, 'Ana@example.com', '--public=https://cms.example.com']);
    const secret = said.join('\n').split('#link=')[1]?.trim() ?? '';
    const check = await Store.open(db);
    expect(await check.link(secret)).toMatchObject({ kind: 'reset', user: { id: ana.id } });
    said = [];
    await main(['reset-link', db, 'ion@example.com', '--public=https://cms.example.com']);
    expect(await check.link(said.join('\n').split('#link=')[1]?.trim() ?? '')).toMatchObject({ kind: 'invite', user: { id: ion.id } });
    await check.close();
    await expect(main(['reset-link', db, 'nobody@example.com', '--public=https://cms.example.com'])).rejects.toThrow('nobody has an account');
    await expect(main(['reset-link', db, 'ana@example.com'])).rejects.toThrow('--public=');
    await expect(main(['reset-link', join(dir, 'none.db'), 'ana@example.com', '--public=https://cms.example.com'])).rejects.toThrow('does not exist');
  });
});
