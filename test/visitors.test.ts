/**
 * Visitor accounts (ADR 0064, PR a): off, they cost nothing; on, a visitor
 * signs up, confirms the address, signs in and out, chooses a new password,
 * changes their address, downloads their data and deletes the account; the
 * owner invites, and mail waits in a queue the site's clock sends.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Mail } from '../src/site/mail.ts';
import { startRuntime } from '../src/site/runtime.ts';
import { startEditor } from '../src/site/server.ts';
import { renderTemplate } from '../src/site/site-mail.ts';
import { Store } from '../src/site/store.ts';
import { VISITOR_TABLES } from '../src/site/visitor-schema.ts';
import plain from '../themes/plain.json';

const dir = await mkdtemp(join(tmpdir(), 'thecms-visitors-'));
afterAll(() => rm(dir, { recursive: true, force: true }));
const text = (body: string) => ({ id: `b_${Math.random().toString(36).slice(2, 10)}`, type: 'text', content: { body: [{ type: 'paragraph', children: [{ text: body }] }] } });

async function site(name: string, languages: string[] = []): Promise<Store> {
  const store = await Store.open(join(dir, `${name}.db`));
  await store.setTheme(plain);
  await store.publishTheme();
  await store.setSite({ name: 'Atelier', url: 'https://example.com', languages });
  await store.savePage({ slug: '', title: 'Home', blocks: [text('Welcome.')] });
  await store.publish('');
  return store;
}

/** A browser of one visitor: it keeps its cookie, and follows nothing by itself. */
function browser(fetch: (request: Request) => Promise<Response>) {
  let cookie = '';
  const go = async (method: string, path: string, fields?: Record<string, string>, headers: Record<string, string> = {}): Promise<Response> => {
    const response = await fetch(
      new Request(`https://example.com${path}`, {
        method,
        headers: { ...(cookie ? { cookie } : {}), ...(fields ? { 'content-type': 'application/x-www-form-urlencoded' } : {}), ...headers },
        body: fields ? new URLSearchParams(fields).toString() : undefined,
      }),
    );
    const set = response.headers.get('set-cookie');
    if (set) cookie = /Max-Age=0/.test(set) ? '' : (set.split(';')[0] as string);
    return response;
  };
  return { go, cookie: () => cookie };
}

const linkIn = (mail: Mail | undefined): string => {
  const found = /https:\/\/example\.com(\/_\/account\/link\?k=[A-Za-z0-9_-]+(&l=[a-z-]+)?)/.exec(mail?.text ?? '');
  if (!found) throw new Error(`no link in ${mail?.text}`);
  return found[1] as string;
};
const secretOf = (path: string): string => new URL(`https://example.com${path}`).searchParams.get('k') as string;

describe('visitor accounts, off', () => {
  test('cost nothing: no tables, nothing loaded, /_/account not found', async () => {
    const store = await site('off');
    const runtime = startRuntime(store, { listen: false, log: () => {} });
    try {
      expect((await runtime.fetch(new Request('https://example.com/_/account'))).status).toBe(404);
      expect((await runtime.fetch(new Request('https://example.com/_/account/signup', { method: 'POST' }))).status).toBe(404);
      await runtime.chores(new Date());
      for (const table of VISITOR_TABLES) expect(await store.hasTable(table)).toBe(false);
      expect(runtime.visitors.loaded()).toBe(false);
    } finally {
      runtime.stop();
      await store.close();
    }
  });

  test('the admin shows only the switch, and a mail server is needed for open sign-up', async () => {
    const store = await site('off-admin');
    const editor = await startEditor(store, { listen: false, log: () => {} });
    const call = async (method: string, path: string, body?: unknown) =>
      editor.fetch(new Request(`http://127.0.0.1:4321${path}`, { method, headers: { host: '127.0.0.1:4321', 'x-thecms-token': editor.token, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }));
    try {
      const off = (await (await call('GET', '/api/visitors')).json()) as Record<string, unknown>;
      expect(off).toEqual({ settings: { on: false, signup: 'closed', privacy: '', levels: [], welcome: '' }, mail: false });
      expect((await call('POST', '/api/visitors', { email: 'a@example.com' })).status).toBe(404);
      for (const table of VISITOR_TABLES) expect(await store.hasTable(table)).toBe(false);
      const refused = await call('PUT', '/api/visitors', { on: true, signup: 'open' });
      expect(refused.status).toBe(409);
      expect(await store.hasTable('visitors')).toBe(false);
      // By invitation needs no server to turn on; the tables are made then.
      const on = (await (await call('PUT', '/api/visitors', { on: true, signup: 'invite' })).json()) as { settings: { on: boolean }; visitors: unknown[] };
      expect(on.settings.on).toBe(true);
      expect(on.visitors).toEqual([]);
      for (const table of VISITOR_TABLES) expect(await store.hasTable(table)).toBe(true);
      // Turned off again, the accounts stay and the pages are not found.
      await call('PUT', '/api/visitors', { on: false });
      expect((await editor.fetch(new Request('http://127.0.0.1:4321/_/account', { headers: { host: '127.0.0.1:4321' } }))).status).toBe(404);
      expect(await store.hasTable('visitors')).toBe(true);
    } finally {
      editor.stop();
      await store.close();
    }
  });
});

describe('visitor accounts, on', () => {
  test('a visitor signs up, confirms, signs in and out', async () => {
    const store = await site('signup');
    const sent: Mail[] = [];
    const runtime = startRuntime(store, { listen: false, log: () => {}, mailer: async (mail) => void sent.push(mail), from: 'site@example.com' });
    await store.setVisitorSettings({ on: true, signup: 'open', privacy: '/privacy/' });
    const tab = browser((r) => runtime.fetch(r));
    try {
      const form = await tab.go('GET', '/_/account/signup');
      expect(form.status).toBe(200);
      const page = await form.text();
      expect(page).toContain('<main');
      expect(page).toContain('action="/_/account/signup"');
      expect(page).toContain('href="/privacy/"');
      expect(page).toContain('<meta name="robots" content="noindex">');
      expect(form.headers.get('cache-control')).toBe('private, no-store');
      expect(form.headers.get('content-security-policy')).toContain("default-src 'none'");

      // Checked before anything is kept.
      expect((await tab.go('POST', '/_/account/signup', { name: 'Ana', email: 'ana@example.com', password: 'short' , consent: 'yes' })).status).toBe(400);
      expect((await tab.go('POST', '/_/account/signup', { name: 'Ana', email: 'ana@example.com', password: 'long enough pass' })).status).toBe(400);
      // A form of another site is refused.
      expect((await tab.go('POST', '/_/account/signup', { name: 'Ana', email: 'ana@example.com', password: 'long enough pass', consent: 'yes' }, { origin: 'https://evil.example' })).status).toBe(403);

      const made = await tab.go('POST', '/_/account/signup', { name: 'Ana', email: 'Ana@Example.com', password: 'long enough pass', consent: 'yes' });
      expect(made.status).toBe(200);
      expect(await made.text()).toContain('ana@example.com');
      // Nothing is sent by the request: the clock sends it.
      expect(sent).toHaveLength(0);
      await runtime.chores(new Date());
      expect(sent).toHaveLength(1);
      expect(sent[0]?.to).toBe('ana@example.com');
      expect(sent[0]?.from).toBe('site@example.com');
      expect(sent[0]?.subject).toBe('Confirm your address for Atelier');

      // Not confirmed: no way in, and the link goes again.
      const early = await tab.go('POST', '/_/account/signin', { email: 'ana@example.com', current: 'long enough pass' });
      expect(early.status).toBe(403);
      await runtime.chores(new Date());
      expect(sent).toHaveLength(2);

      const confirm = linkIn(sent[0]);
      const ask = await tab.go('GET', confirm);
      expect(ask.status).toBe(200);
      expect(await ask.text()).toContain('name="k"');
      const done = await tab.go('POST', '/_/account/link', { k: secretOf(confirm) });
      expect(done.status).toBe(303);
      expect(done.headers.get('set-cookie')).toContain('thecms_visitor=');
      expect(done.headers.get('set-cookie')).toContain('HttpOnly; SameSite=Lax; Max-Age=2592000');
      // The other link was for the same account; it is spent with the first.
      expect((await tab.go('GET', linkIn(sent[1]))).status).toBe(410);
      expect((await tab.go('POST', '/_/account/link', { k: secretOf(confirm) })).status).toBe(410);

      const mine = await (await tab.go('GET', '/_/account?said=confirmed')).text();
      expect(mine).toContain('Hello, Ana');
      expect(mine).toContain('Your address is confirmed.');
      await runtime.chores(new Date());
      expect(sent.at(-1)?.subject).toBe('Welcome to Atelier');

      const data = await tab.go('GET', '/_/account/data');
      expect(data.headers.get('content-disposition')).toContain('attachment');
      const kept = (await data.json()) as Record<string, unknown>;
      expect(Object.keys(kept).sort()).toEqual(['confirmedAt', 'createdAt', 'email', 'id', 'language', 'lastAt', 'levels', 'name']);
      expect(JSON.stringify(kept)).not.toContain('argon');

      expect((await tab.go('POST', '/_/account/signout', {})).status).toBe(303);
      expect(tab.cookie()).toBe('');
      expect(await (await tab.go('GET', '/_/account')).text()).toContain('action="/_/account/signin"');
      expect((await tab.go('POST', '/_/account/signin', { email: 'ana@example.com', current: 'wrong password!' })).status).toBe(401);
      const back = await tab.go('POST', '/_/account/signin', { email: 'ana@example.com', current: 'long enough pass', back: '/members/' });
      expect(back.status).toBe(303);
      expect(back.headers.get('location')).toBe('/members/');

      // Signing up again with the address says the same, and sends nothing.
      const again = sent.length;
      expect((await tab.go('POST', '/_/account/signout', {})).status).toBe(303);
      expect((await tab.go('POST', '/_/account/signup', { name: 'Eve', email: 'ana@example.com', password: 'another password', consent: 'yes' })).status).toBe(200);
      await runtime.chores(new Date());
      expect(sent).toHaveLength(again);
    } finally {
      runtime.stop();
      await store.close();
    }
  });

  test('a forgotten password, a new address, and the account deleted', async () => {
    const store = await site('forgot', ['ro']);
    const sent: Mail[] = [];
    const runtime = startRuntime(store, { listen: false, log: () => {}, mailer: async (mail) => void sent.push(mail), from: 'site@example.com' });
    await store.setVisitorSettings({ on: true, signup: 'open' });
    const tab = browser((r) => runtime.fetch(r));
    const tick = () => runtime.chores(new Date());
    try {
      // Signed up from the Romanian pages: the messages are in Romanian.
      await tab.go('POST', '/_/account/signup?l=ro', { name: 'Ion', email: 'ion@example.com', password: 'parola lunga 1', consent: 'yes' });
      await tick();
      expect(sent[0]?.subject).toBe('Confirmă-ți adresa pentru Atelier');
      const confirm = linkIn(sent[0]);
      expect(confirm).toContain('&l=ro');
      await tab.go('POST', '/_/account/link?l=ro', { k: secretOf(confirm), l: 'ro' });
      expect(await (await tab.go('GET', '/_/account')).text()).toContain('Bună, Ion');
      await tab.go('POST', '/_/account/signout', {});

      const unknown = await (await tab.go('POST', '/_/account/forgot', { email: 'nobody@example.com' })).text();
      const known = await (await tab.go('POST', '/_/account/forgot', { email: 'ion@example.com' })).text();
      // The same words either way.
      expect(unknown.replace(/\s+/g, ' ')).toBe(known.replace(/\s+/g, ' '));
      const before = sent.length;
      await tick();
      expect(sent.length).toBe(before + 2);
      const reset = sent.find((m) => m.subject.startsWith('O parolă nouă'));
      const link = linkIn(reset);
      expect((await tab.go('POST', '/_/account/link', { k: secretOf(link), password: 'short' })).status).toBe(400);
      expect((await tab.go('POST', '/_/account/link', { k: secretOf(link), password: 'a new long password' })).status).toBe(303);
      await tab.go('POST', '/_/account/signout', {});
      expect((await tab.go('POST', '/_/account/signin', { email: 'ion@example.com', current: 'parola lunga 1' })).status).toBe(401);
      expect((await tab.go('POST', '/_/account/signin', { email: 'ion@example.com', current: 'a new long password' })).status).toBe(303);

      // A new address is confirmed by a link sent to it.
      const changing = await (await tab.go('POST', '/_/account/profile', { name: 'Ion Pop', email: 'pop@example.com' })).text();
      expect(changing).toContain('pop@example.com');
      await tick();
      const moved = sent.at(-1);
      expect(moved?.to).toBe('pop@example.com');
      expect((await tab.go('POST', '/_/account/link', { k: secretOf(linkIn(moved)) })).status).toBe(303);
      const data = (await (await tab.go('GET', '/_/account/data')).json()) as { email: string; name: string };
      expect(data).toMatchObject({ email: 'pop@example.com', name: 'Ion Pop' });

      // Deleting asks for the password.
      expect((await tab.go('POST', '/_/account/delete', { current: 'wrong one' })).status).toBe(401);
      const gone = await tab.go('POST', '/_/account/delete', { current: 'a new long password' });
      expect(gone.status).toBe(303);
      expect(tab.cookie()).toBe('');
      await tick();
      expect(sent.at(-1)?.subject).toBe('Contul tău pe Atelier a fost șters');
      expect((await tab.go('POST', '/_/account/signin', { email: 'pop@example.com', current: 'a new long password' })).status).toBe(401);
    } finally {
      runtime.stop();
      await store.close();
    }
  });

  test('wrong passwords are counted, and an account never confirmed is deleted after a week', async () => {
    const store = await site('tries');
    const runtime = startRuntime(store, { listen: false, log: () => {}, mailer: async () => {}, from: 'site@example.com' });
    await store.setVisitorSettings({ on: true, signup: 'open' });
    const tab = browser((r) => runtime.fetch(r));
    try {
      for (let i = 0; i < 10; i++) await tab.go('POST', '/_/account/signin', { email: 'x@example.com', current: 'nope' });
      expect((await tab.go('POST', '/_/account/signin', { email: 'x@example.com', current: 'nope' })).status).toBe(429);
      await tab.go('POST', '/_/account/signup', { name: 'Old', email: 'old@example.com', password: 'long enough pass', consent: 'yes' });
      await runtime.chores(new Date());
      expect((await store.database().rows('SELECT id FROM visitors'))).toHaveLength(1);
      await runtime.chores(new Date(Date.now() + 8 * 86_400_000));
      expect((await store.database().rows('SELECT id FROM visitors'))).toHaveLength(0);
    } finally {
      runtime.stop();
      await store.close();
    }
  });

  test('mail that fails is tried again, then said in the admin', async () => {
    const store = await site('queue');
    const lines: string[] = [];
    let tries = 0;
    const mailer = async (): Promise<void> => {
      tries++;
      throw new Error('the mail server refused the sender');
    };
    const editor = await startEditor(store, { listen: false, log: () => {}, mailer, from: 'site@example.com' });
    // The clock of a runtime on the same site sends what waits.
    const runtime = startRuntime(store, { listen: false, log: (line) => lines.push(line), mailer, from: 'site@example.com' });
    const call = async (method: string, path: string, body?: unknown) =>
      editor.fetch(new Request(`http://127.0.0.1:4321${path}`, { method, headers: { host: '127.0.0.1:4321', 'x-thecms-token': editor.token, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }));
    try {
      await call('PUT', '/api/visitors', { on: true, signup: 'invite' });
      const invited = (await (await call('POST', '/api/visitors', { email: 'guest@example.com' })).json()) as { visitors: { email: string; invited: boolean }[]; waiting: number };
      expect(invited.visitors).toMatchObject([{ email: 'guest@example.com', invited: true }]);
      expect(invited.waiting).toBe(1);
      expect((await call('POST', '/api/visitors', { email: 'guest@example.com' })).status).toBe(409);
      // Many hours later each time: tried five times, then given up.
      for (let i = 1; i <= 6; i++) await runtime.chores(new Date(Date.now() + i * 3 * 3_600_000));
      expect(tries).toBe(5);
      const listed = (await (await call('GET', '/api/visitors')).json()) as { failed: { id: string; to: string; what: string; error: string }[]; waiting: number };
      expect(listed.waiting).toBe(0);
      expect(listed.failed).toMatchObject([{ to: 'guest@example.com', what: 'invite', error: 'the mail server refused the sender' }]);
      expect(lines.some((l) => l.includes('could not be sent (invite, after 5 tries)'))).toBe(true);
      // Tried again at the owner's word, or forgotten.
      expect(((await (await call('POST', `/api/visitors/retry?id=${listed.failed[0]?.id}`, {})).json()) as { waiting: number }).waiting).toBe(1);
      await runtime.chores(new Date(Date.now() + 60 * 3_600_000));
      const again = (await (await call('GET', '/api/visitors')).json()) as { failed: { id: string }[] };
      expect(((await (await call('DELETE', `/api/visitors/failed?id=${again.failed[0]?.id}`)).json()) as { failed: unknown[]; waiting: number })).toMatchObject({ failed: [], waiting: 1 });
      // The owner deletes the account.
      const visitors = (await (await call('GET', '/api/visitors')).json()) as { visitors: { id: string }[] };
      expect(((await (await call('DELETE', `/api/visitors?id=${visitors.visitors[0]?.id}`)).json()) as { visitors: unknown[] }).visitors).toEqual([]);
    } finally {
      runtime.stop();
      editor.stop();
      await store.close();
    }
  });

  test('an invitation is taken up from its link', async () => {
    const store = await site('invite');
    const sent: Mail[] = [];
    const mailer = async (mail: Mail): Promise<void> => void sent.push(mail);
    const editor = await startEditor(store, { listen: false, log: () => {}, mailer, from: 'site@example.com' });
    const runtime = startRuntime(store, { listen: false, log: () => {}, mailer, from: 'site@example.com' });
    const call = async (method: string, path: string, body?: unknown) =>
      editor.fetch(new Request(`http://127.0.0.1:4321${path}`, { method, headers: { host: '127.0.0.1:4321', 'x-thecms-token': editor.token, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }));
    const tab = browser((r) => runtime.fetch(r));
    try {
      await call('PUT', '/api/visitors', { on: true, signup: 'invite' });
      // By invitation, nobody signs up alone.
      expect((await tab.go('GET', '/_/account/signup')).status).toBe(403);
      await call('POST', '/api/visitors', { email: 'guest@example.com' });
      await runtime.chores(new Date());
      expect(sent[0]?.subject).toBe('An invitation to Atelier');
      const link = linkIn(sent[0]);
      expect(await (await tab.go('GET', link)).text()).toContain('name="consent"');
      expect((await tab.go('POST', '/_/account/link', { k: secretOf(link), name: 'Guest', password: 'long enough pass' })).status).toBe(400);
      expect((await tab.go('POST', '/_/account/link', { k: secretOf(link), name: 'Guest', password: 'long enough pass', consent: 'yes' })).status).toBe(303);
      expect(await (await tab.go('GET', '/_/account')).text()).toContain('Hello, Guest');
      const listed = (await (await call('GET', '/api/visitors')).json()) as { visitors: { invited: boolean; confirmedAt: string | null }[] };
      expect(listed.visitors[0]?.invited).toBe(false);
      expect(listed.visitors[0]?.confirmedAt).not.toBeNull();
    } finally {
      runtime.stop();
      editor.stop();
      await store.close();
    }
  });
});

describe('Settings → E-mail', () => {
  test('keeps the server, never gives back its password, and the environment is stronger', async () => {
    const store = await site('mail');
    const editor = await startEditor(store, { listen: false, log: () => {} });
    const call = async (method: string, path: string, body?: unknown) =>
      editor.fetch(new Request(`http://127.0.0.1:4321${path}`, { method, headers: { host: '127.0.0.1:4321', 'x-thecms-token': editor.token, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }));
    try {
      expect(((await (await call('GET', '/api/mail')).json()) as { ready: boolean }).ready).toBe(false);
      expect((await call('PUT', '/api/mail', { host: 'mail.example.com', security: 'plain', port: 25, from: 'site@example.com' })).status).toBe(400);
      expect((await call('PUT', '/api/mail', { host: 'mail.example.com', from: 'not an address' })).status).toBe(400);
      const saved = (await (await call('PUT', '/api/mail', { host: 'mail.example.com', port: 465, user: 'site', password: 'secret!', from: 'site@example.com' })).json()) as Record<string, unknown>;
      expect(saved).toEqual({ settings: { host: 'mail.example.com', port: 465, security: 'tls', user: 'site', from: 'site@example.com', passwordSet: true }, fromEnvironment: { server: false, from: false }, ready: true });
      expect(JSON.stringify(saved)).not.toContain('secret!');
      // Not given again, the password stays.
      await call('PUT', '/api/mail', { host: 'mail.example.com', port: 465, user: 'site', from: 'site@example.com' });
      expect(((await store.mailSettings()) as { password: string }).password).toBe('secret!');
      expect((await call('POST', '/api/mail/test', { to: 'nope' })).status).toBe(400);
    } finally {
      editor.stop();
    }
    const sent: Mail[] = [];
    const strong = await startEditor(store, { listen: false, log: () => {}, mailer: async (m) => void sent.push(m), from: 'env@example.com' });
    const ask = async (method: string, path: string, body?: unknown) =>
      strong.fetch(new Request(`http://127.0.0.1:4321${path}`, { method, headers: { host: '127.0.0.1:4321', 'x-thecms-token': strong.token, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }));
    try {
      expect(((await (await ask('GET', '/api/mail')).json()) as { fromEnvironment: unknown }).fromEnvironment).toEqual({ server: true, from: true });
      expect(((await (await ask('POST', '/api/mail/test', { to: 'owner@example.com' })).json()) as { sent: boolean }).sent).toBe(true);
      expect(sent[0]).toMatchObject({ from: 'env@example.com', to: 'owner@example.com', subject: 'A test message from Atelier' });
      // The words of each message, in each language, back to the program's when emptied.
      const words = (await (await ask('PUT', '/api/mail/templates', { language: 'en', name: 'welcome', subject: 'Hi {name}', text: 'Welcome to {site}.' })).json()) as { saved: unknown; defaults: { en: { welcome: { subject: string } } } };
      expect(words.saved).toEqual({ en: { welcome: { subject: 'Hi {name}', text: 'Welcome to {site}.' } } });
      expect(words.defaults.en.welcome.subject).toBe('Welcome to {site}');
      expect(((await (await ask('PUT', '/api/mail/templates', { language: 'en', name: 'welcome', subject: '', text: '' })).json()) as { saved: unknown }).saved).toEqual({});
      expect((await ask('PUT', '/api/mail/templates', { language: 'xx', name: 'welcome', subject: 'a', text: 'b' })).status).toBe(400);
    } finally {
      strong.stop();
      await store.close();
    }
  });
});

describe('the messages', () => {
  test('are the owner\'s words where given, with what they name filled in', () => {
    const values = { name: 'Ana', link: 'https://example.com/x', site: 'Atelier' };
    expect(renderTemplate({}, 'welcome', 'en', values).subject).toBe('Welcome to Atelier');
    expect(renderTemplate({ en: { welcome: { subject: 'Hi {name}', text: 'Go to {link} on {site}' } } }, 'welcome', 'en', values)).toEqual({ subject: 'Hi Ana', text: 'Go to https://example.com/x on Atelier' });
    expect(renderTemplate({}, 'invite', 'ro', values).subject).toBe('O invitație pe Atelier');
  });
});

describe('what is kept, and given back (ADR 0064 d6)', () => {
  test('a backup holds the visitors once the accounts were on, and puts them back', async () => {
    const from = await site('backup-from');
    const runtime = startRuntime(from, { listen: false, log: () => {}, mailer: async () => {}, from: 'site@example.com' });
    await from.setVisitorSettings({ on: true, signup: 'open' });
    const tab = browser((r) => runtime.fetch(r));
    await tab.go('POST', '/_/account/signup', { name: 'Ana', email: 'ana@example.com', password: 'long enough pass', consent: 'yes' });
    runtime.stop();
    const rows: { table: string; row: Record<string, unknown> }[] = [];
    for await (const one of from.backupRows()) rows.push(one);
    expect(rows.filter((r) => r.table === 'visitors').map((r) => r.row.email)).toEqual(['ana@example.com']);
    expect(rows.some((r) => r.table === 'visitor_sessions' || r.table === 'visitor_links' || r.table === 'mail_queue')).toBe(false);
    await from.close();

    const into = await site('backup-into');
    expect(await into.hasTable('visitors')).toBe(false);
    await into.restoreRows((async function* () { yield* rows; })());
    expect((await into.database().rows<{ email: string }>('SELECT email FROM visitors')).map((r) => r.email)).toEqual(['ana@example.com']);
    // A backup of a site that never had them makes no tables.
    const plainRows = rows.filter((r) => !(r.table === 'visitors' || (r.table === 'meta' && r.row.key === 'visitors')));
    const other = await site('backup-plain');
    await other.restoreRows((async function* () { yield* plainRows; })());
    expect(await other.hasTable('visitors')).toBe(false);
    await into.close();
    await other.close();
  });

  test('nothing loads the accounts but the door to them', async () => {
    const { Glob } = await import('bun');
    const importers: string[] = [];
    for await (const file of new Glob('src/**/*.{ts,svelte}').scan('.')) {
      if (file.endsWith('visitor-gate.ts')) continue;
      const source = await Bun.file(file).text();
      if (/from '\.\/visitors\.ts'|import\(['"]\.\/visitors\.ts['"]\)|from '\.\/visitor-pages\.ts'/.test(source) && !file.endsWith('visitors.ts')) importers.push(file);
    }
    expect(importers).toEqual([]);
  });
});
