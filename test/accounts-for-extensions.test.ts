/**
 * What extensions are given of visitor accounts (ADR 0064 d7, PR c): the
 * events of an account made, removed and of a member's levels; the members,
 * read by one id or one address, a level given or taken; e-mail to one
 * visitor through the site's queue; the visitor signed in on a route. While
 * the accounts are off, none of it is there and nothing is loaded for it.
 * The owner changes the words of an extension's messages in Settings → E-mail.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXTENSION_FORMAT, EXTENSION_FORMAT_2, extensionAsks, parseExtension } from '../src/core/index.ts';
import { describeOffer } from '../src/site/cli.ts';
import { extensionHost } from '../src/site/extensions.ts';
import { startRuntime } from '../src/site/runtime.ts';
import { startEditor } from '../src/site/server.ts';
import { Store, type User } from '../src/site/store.ts';
import { VISITOR_TABLES } from '../src/parts/visitors/schema.ts';
import plain from '../themes/plain.json';

const dir = await mkdtemp(join(tmpdir(), 'uhlaka-accounts-ext-'));
afterAll(() => rm(dir, { recursive: true, force: true }));

const LEVELS = [
  { id: 'member', name: 'Member' },
  { id: 'premium', name: 'Premium' },
];

const CODE = `export const actions = {
  heard: async (input, host) => { await host.collections.insert('heard', { line: JSON.stringify(input) }); },
  who: async (input) => ({ body: { visitor: input.visitor, cookie: input.headers.cookie ?? null } }),
  look: async (input, host) => ({ byId: await host.members.get(input.id), byMail: await host.members.find(input.email), levels: await host.members.levels() }),
  give: async (input, host) => host.members.give(input.id, input.level),
  take: async (input, host) => host.members.take(input.id, input.level),
  mail: async (input, host) => host.mail.send(input.id, input.message, input.values),
  sneak: async (input, host) => host.members.get(input.id),
  spam: async (input, host) => host.mail.send(input.id, 'receipt'),
};`;

const manifest = {
  name: 'club',
  displayName: 'Club',
  version: '1.0.0',
  egress: ['pay.example'],
  uses: ['members', 'mail'],
  collections: [{ name: 'heard', label: 'Heard', fields: [{ key: 'line', label: 'Line', kind: 'longtext' }] }],
  actions: [
    { name: 'heard', label: 'Heard', writes: ['heard'] },
    { name: 'who', label: 'Who' },
    { name: 'look', label: 'Look', uses: ['members'] },
    { name: 'give', label: 'Give', uses: ['members'] },
    { name: 'take', label: 'Take', uses: ['members'] },
    { name: 'mail', label: 'Mail', uses: ['mail'] },
    { name: 'sneak', label: 'Sneak' },
    { name: 'spam', label: 'Spam' },
  ],
  events: [
    { on: 'account.made', action: 'heard' },
    { on: 'account.removed', action: 'heard' },
    { on: 'member.changed', action: 'heard' },
  ],
  routes: [{ path: 'who', action: 'who', methods: ['GET', 'POST'] }],
  mails: [{ name: 'receipt', subject: 'Your receipt from {site}', text: 'Hello {name}, it is at {link}' }],
  messages: { ro: { 'Your receipt from {site}': 'Chitanța ta de la {site}', 'Hello {name}, it is at {link}': 'Salut {name}, e la {link}' } },
};
const PACKAGE = JSON.stringify({ format: EXTENSION_FORMAT, manifest, code: CODE });
const OWNER = { id: 'owner', role: 'owner' } as unknown as User;

async function site(name: string): Promise<Store> {
  const store = await Store.open(join(dir, `${name}.db`));
  await store.setTheme(plain);
  await store.publishTheme();
  await store.setSite({ name: 'Atelier', url: 'https://example.com', forms: '/_', languages: ['ro'] });
  await store.savePage({ slug: '', title: 'Home', blocks: [] });
  await store.publish('');
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

/** What the extension heard, once it heard this many: events are told as they happen, apart from the request. */
async function heard(store: Store, count: number): Promise<Record<string, unknown>[]> {
  for (let i = 0; i < 200; i++) {
    const rows = await store.extensionRows('club', 'heard');
    if (rows.length >= count) return rows.map((r) => JSON.parse(String(r.line)) as Record<string, unknown>);
    await Bun.sleep(25);
  }
  throw new Error(`the extension heard fewer than ${count}`);
}

describe('the format', () => {
  test('the third may listen to accounts and declare messages to visitors; the owner is told', () => {
    const { pkg, problems } = parseExtension(JSON.parse(PACKAGE));
    expect(problems).toEqual([]);
    const asks = extensionAsks(pkg!.manifest);
    expect(asks).toMatchObject({ uses: ['members', 'mail'], mails: ['Your receipt from {site}'], accounts: true, events: ['account.made', 'account.removed', 'member.changed'] });
    expect(describeOffer({ manifest: pkg!.manifest, sha256: 'x', asks, replaces: null, accountsOff: true, shopOff: false })).toContain('send visitors these messages: Your receipt from {site}');
    expect(describeOffer({ manifest: pkg!.manifest, sha256: 'x', asks, replaces: null, accountsOff: true, shopOff: false })).toContain('visitor accounts, which are off');

    const second = parseExtension({ format: EXTENSION_FORMAT_2, manifest: { ...manifest, uses: undefined, mails: undefined }, code: CODE });
    expect(second.problems.join('; ')).toContain('("account.made")');
    const noMail = parseExtension({ format: EXTENSION_FORMAT, manifest: { ...manifest, uses: ['members'], actions: manifest.actions.filter((a) => a.name !== 'mail') }, code: CODE });
    expect(noMail.problems).toContain('it declares messages to visitors, and does not declare "mail" in "uses"');
    const sitesOwn = parseExtension({ format: EXTENSION_FORMAT, manifest: { ...manifest, mails: [{ name: 'welcome', subject: 'Hi', text: 'Hi' }] }, code: CODE });
    expect(sitesOwn.problems.join('; ')).toContain('is one of the site\'s');
    const empty = parseExtension({ format: EXTENSION_FORMAT, manifest: { ...manifest, mails: [{ name: 'receipt', subject: '', text: 'Hi' }] }, code: CODE });
    expect(empty.problems.join('; ')).toContain('has a subject and a text');
  });
});

describe('while visitor accounts are off', () => {
  test('nothing is lent, nobody is signed in on a route, and nothing of the accounts is loaded or made', async () => {
    const store = await site('off');
    const host = extensionHost(store, { log: () => {} });
    const offer = await host.offer(PACKAGE);
    expect(offer.accountsOff).toBe(true);
    await host.install(PACKAGE, offer.sha256);
    const runtime = startRuntime(store, { listen: false, log: () => {}, extensions: host });
    try {
      await expect(host.run('club', 'look', { id: 'x', email: 'a@example.com' })).rejects.toThrow('visitor accounts are off');
      await expect(host.run('club', 'mail', { id: 'x', message: 'receipt' })).rejects.toThrow('visitor accounts are off');
      const answered = await runtime.fetch(new Request('https://example.com/_/x/club/who', { headers: { cookie: 'uhlaka_visitor=made-up' } }));
      expect(await answered.json()).toEqual({ visitor: null, cookie: null });
      expect(runtime.visitors.loaded()).toBe(false);
      for (const table of VISITOR_TABLES) expect(await store.hasTable(table)).toBe(false);
    } finally {
      runtime.stop();
      host.close();
      await store.close();
    }
  });
});

describe('while visitor accounts are on', () => {
  test('an account made, a level changed and an account removed are told with the id and levels, never more', async () => {
    const store = await site('events');
    const sent: { to: string; subject: string; text: string }[] = [];
    await store.setVisitorSettings({ on: true, signup: 'open', levels: LEVELS, welcome: 'member' });
    const host = extensionHost(store, { log: () => {} });
    await host.install(PACKAGE, (await host.offer(PACKAGE)).sha256);
    const unlisten = host.listen();
    const runtime = startRuntime(store, { listen: false, log: () => {}, extensions: host, mailer: async (mail) => void sent.push(mail as never), from: 'site@example.com' });
    const admin = (method: string, path: string, body: Record<string, unknown> = {}) =>
      runtime.visitors.admin(new Request(`https://example.com${path}`, { method }), new URL(`https://example.com${path}`), OWNER, body);
    const tab = browser((r) => runtime.fetch(r));
    try {
      // Signed up, not yet confirmed: nothing is told.
      await tab.go('POST', '/_/account/signup', { name: 'Ion', email: 'ion@example.com', password: 'long enough pass', consent: 'yes' });
      await runtime.chores(new Date());
      await Bun.sleep(100);
      expect(await store.extensionRows('club', 'heard')).toEqual([]);
      const k = /k=([A-Za-z0-9_-]+)/.exec(sent[0]?.text ?? '')?.[1] as string;
      expect((await tab.go('POST', '/_/account/link', { k })).status).toBe(303);
      const [made] = await heard(store, 1);
      const id = String(made?.id);
      // Made, with the level for new accounts; nothing of the e-mail, the name or a session.
      expect(made).toEqual({ event: 'account.made', id, levels: ['member'] });

      // The owner gives a level; giving what is held already tells nothing.
      await admin('PUT', '/api/visitors/levels', { id, levels: ['member', 'premium'] });
      await admin('PUT', '/api/visitors/levels', { id, levels: ['member', 'premium'] });
      expect((await heard(store, 2))[1]).toEqual({ event: 'member.changed', id, levels: ['member', 'premium'], added: ['premium'], removed: [] });
      // A level the owner takes away is taken from everyone, and each is told of.
      await store.setVisitorSettings({ on: true, signup: 'open', levels: [LEVELS[1]], welcome: '' });
      await admin('PUT', '/api/visitors', {});
      expect((await heard(store, 3))[2]).toEqual({ event: 'member.changed', id, levels: ['premium'], added: [], removed: ['member'] });

      // An account the owner deletes.
      await admin('DELETE', `/api/visitors?id=${id}`);
      expect((await heard(store, 4))[3]).toEqual({ event: 'account.removed', id, levels: ['premium'] });
      await Bun.sleep(100);
      expect(await store.extensionRows('club', 'heard')).toHaveLength(4);
    } finally {
      unlisten();
      runtime.stop();
      host.close();
      await store.close();
    }
  });

  test('members are read by one id or one address, and a level is given or taken, only by an action that declared it', async () => {
    const store = await site('members');
    const sent: { to: string; subject: string; text: string }[] = [];
    await store.setVisitorSettings({ on: true, signup: 'open', levels: LEVELS });
    const host = extensionHost(store, { log: () => {} });
    await host.install(PACKAGE, (await host.offer(PACKAGE)).sha256);
    const unlisten = host.listen();
    const runtime = startRuntime(store, { listen: false, log: () => {}, extensions: host, mailer: async (mail) => void sent.push(mail as never), from: 'site@example.com' });
    const tab = browser((r) => runtime.fetch(r));
    try {
      await tab.go('POST', '/_/account/signup?l=ro', { name: 'Ana', email: 'ana@example.com', password: 'long enough pass', consent: 'yes', l: 'ro' });
      // Not confirmed yet: not a member an extension may read.
      expect(await host.run('club', 'look', { id: 'nobody', email: 'ana@example.com' })).toEqual({ byId: null, byMail: null, levels: LEVELS });
      await runtime.chores(new Date());
      const k = /k=([A-Za-z0-9_-]+)/.exec(sent[0]?.text ?? '')?.[1] as string;
      await tab.go('POST', '/_/account/link', { k, l: 'ro' });
      const id = String((await heard(store, 1))[0]?.id);
      const ana = { id, name: 'Ana', email: 'ana@example.com', language: 'ro', levels: [] };
      expect(await host.run('club', 'look', { id, email: ' ANA@example.com ' })).toEqual({ byId: ana, byMail: ana, levels: LEVELS });

      expect(await host.run('club', 'give', { id, level: 'premium' })).toEqual(['premium']);
      expect((await heard(store, 2))[1]).toEqual({ event: 'member.changed', id, levels: ['premium'], added: ['premium'], removed: [] });
      await expect(host.run('club', 'give', { id, level: 'gold' })).rejects.toThrow('not one of the levels the owner named');
      await expect(host.run('club', 'give', { id: 'nobody', level: 'premium' })).rejects.toThrow('no member has that id');
      expect(await host.run('club', 'take', { id, level: 'premium' })).toEqual([]);
      await expect(host.run('club', 'sneak', { id })).rejects.toThrow('did not declare that it uses "members"');

      // The visitor signed in, on a route: by id and levels, never the cookie.
      const answered = await tab.go('GET', '/_/x/club/who');
      expect(await answered.json()).toEqual({ visitor: { id, levels: [] }, cookie: null });
      expect(await (await runtime.fetch(new Request('https://example.com/_/x/club/who'))).json()).toEqual({ visitor: null, cookie: null });
    } finally {
      unlisten();
      runtime.stop();
      host.close();
      await store.close();
    }
  });

  test('e-mail goes to one member, in their language, through the queue; its link leads to the site or a host declared', async () => {
    const store = await site('mail');
    const sent: { to: string; subject: string; text: string }[] = [];
    await store.setVisitorSettings({ on: true, signup: 'open', levels: LEVELS });
    const host = extensionHost(store, { log: () => {} });
    await host.install(PACKAGE, (await host.offer(PACKAGE)).sha256);
    const unlisten = host.listen();
    const runtime = startRuntime(store, { listen: false, log: () => {}, extensions: host, mailer: async (mail) => void sent.push(mail as never), from: 'site@example.com' });
    const tab = browser((r) => runtime.fetch(r));
    try {
      await tab.go('POST', '/_/account/signup?l=ro', { name: 'Ana', email: 'ana@example.com', password: 'long enough pass', consent: 'yes', l: 'ro' });
      await runtime.chores(new Date());
      const k = /k=([A-Za-z0-9_-]+)/.exec(sent[0]?.text ?? '')?.[1] as string;
      await tab.go('POST', '/_/account/link', { k, l: 'ro' });
      const id = String((await heard(store, 1))[0]?.id);
      await runtime.chores(new Date());
      sent.length = 0;

      await host.run('club', 'mail', { id, message: 'receipt', values: { link: '/receipts/7/' } });
      await host.run('club', 'mail', { id, message: 'receipt', values: { link: 'https://pay.example/r/7' } });
      await host.run('club', 'mail', { id, message: 'welcome' });
      // Waiting in the queue until the clock sends it: no action waits for a mail server.
      expect(sent).toEqual([]);
      await runtime.chores(new Date());
      expect(sent.map((m) => [m.to, m.subject, m.text])).toEqual([
        ['ana@example.com', 'Chitanța ta de la Atelier', 'Salut Ana, e la https://example.com/receipts/7/'],
        ['ana@example.com', 'Chitanța ta de la Atelier', 'Salut Ana, e la https://pay.example/r/7'],
        ['ana@example.com', expect.any(String), expect.stringContaining('https://example.com/_/account')],
      ]);

      await expect(host.run('club', 'mail', { id, message: 'receipt', values: { link: 'https://elsewhere.example/x' } })).rejects.toThrow('a link leads to the site, or over https to a host it declared');
      await expect(host.run('club', 'mail', { id, message: 'receipt', values: { link: 'javascript:alert(1)' } })).rejects.toThrow('a link leads to the site');
      await expect(host.run('club', 'mail', { id, message: 'reset' })).rejects.toThrow('not one of its messages');
      await expect(host.run('club', 'mail', { id: 'nobody', message: 'receipt' })).rejects.toThrow('no member has that id');
      await expect(host.run('club', 'spam', { id })).rejects.toThrow('did not declare that it uses "mail"');
      // At most ten an hour to one visitor from extensions.
      for (let i = 0; i < 7; i++) await host.run('club', 'mail', { id, message: 'receipt' });
      await expect(host.run('club', 'mail', { id, message: 'receipt' })).rejects.toThrow('at most 10 messages an hour');
    } finally {
      unlisten();
      runtime.stop();
      host.close();
      await store.close();
    }
  });

  test("the owner changes an extension's messages in Settings → E-mail; they go with the extension", async () => {
    const store = await site('words');
    const sent: { to: string; subject: string; text: string }[] = [];
    await store.setVisitorSettings({ on: true, signup: 'open', levels: LEVELS });
    const host = extensionHost(store, { log: () => {} });
    await host.install(PACKAGE, (await host.offer(PACKAGE)).sha256);
    const unlisten = host.listen();
    const runtime = startRuntime(store, { listen: false, log: () => {}, extensions: host, mailer: async (mail) => void sent.push(mail as never), from: 'site@example.com' });
    const editor = await startEditor(store, { listen: false, log: () => {} });
    const ask = async (method: string, path: string, body?: unknown) =>
      editor.fetch(new Request(`http://127.0.0.1:4321${path}`, { method, headers: { host: '127.0.0.1:4321', 'x-uhlaka-token': editor.token, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }));
    type Words = { names: string[]; labels: Record<string, string>; defaults: Record<string, Record<string, { subject: string; text: string }>>; saved: Record<string, Record<string, unknown>> };
    const tab = browser((r) => runtime.fetch(r));
    try {
      // Listed after the site's own, by the extension's name, with its own words in each language.
      const listed = (await (await ask('GET', '/api/mail/templates')).json()) as Words;
      expect(listed.names).toEqual(['confirm', 'reset', 'welcome', 'invite', 'deleted', 'club:receipt']);
      expect(listed.labels).toEqual({ 'club:receipt': 'Club: Your receipt from {site}' });
      expect(listed.defaults.ro?.['club:receipt']).toEqual({ subject: 'Chitanța ta de la {site}', text: 'Salut {name}, e la {link}' });
      expect(listed.defaults.en?.['club:receipt']).toEqual({ subject: 'Your receipt from {site}', text: 'Hello {name}, it is at {link}' });
      // One it does not declare is refused; the extension's own words are no change of the owner's.
      expect((await ask('PUT', '/api/mail/templates', { language: 'ro', name: 'club:refund', subject: 'a', text: 'b' })).status).toBe(400);
      expect((await ask('PUT', '/api/mail/templates', { language: 'ro', name: 'other:receipt', subject: 'a', text: 'b' })).status).toBe(400);
      expect(((await (await ask('PUT', '/api/mail/templates', { language: 'ro', name: 'club:receipt', subject: 'Chitanța ta de la {site}', text: 'Salut {name}, e la {link}' })).json()) as Words).saved).toEqual({});
      const changed = (await (await ask('PUT', '/api/mail/templates', { language: 'ro', name: 'club:receipt', subject: 'Plata ta la {site}', text: 'Mulțumim, {name}: {link}' })).json()) as Words;
      expect(changed.saved).toEqual({ ro: { 'club:receipt': { subject: 'Plata ta la {site}', text: 'Mulțumim, {name}: {link}' } } });

      await tab.go('POST', '/_/account/signup?l=ro', { name: 'Ana', email: 'ana@example.com', password: 'long enough pass', consent: 'yes', l: 'ro' });
      await runtime.chores(new Date());
      const k = /k=([A-Za-z0-9_-]+)/.exec(sent[0]?.text ?? '')?.[1] as string;
      await tab.go('POST', '/_/account/link', { k, l: 'ro' });
      const id = String((await heard(store, 1))[0]?.id);
      await runtime.chores(new Date());
      sent.length = 0;
      // Sent with the owner's words, filled in as the extension's would be.
      await host.run('club', 'mail', { id, message: 'receipt', values: { link: '/receipts/7/' } });
      await runtime.chores(new Date());
      expect(sent.map((m) => [m.subject, m.text])).toEqual([['Plata ta la Atelier', 'Mulțumim, Ana: https://example.com/receipts/7/']]);

      // Uninstalled, its messages leave the list and the owner's words for them are forgotten; the site's stay.
      await ask('PUT', '/api/mail/templates', { language: 'ro', name: 'welcome', subject: 'Salut {name}', text: 'Bun venit la {site}.' });
      await host.uninstall('club');
      const after = (await (await ask('GET', '/api/mail/templates')).json()) as Words;
      expect(after.names).not.toContain('club:receipt');
      expect(after.saved).toEqual({ ro: { welcome: { subject: 'Salut {name}', text: 'Bun venit la {site}.' } } });
    } finally {
      unlisten();
      editor.stop();
      runtime.stop();
      host.close();
      await store.close();
    }
  });
});
