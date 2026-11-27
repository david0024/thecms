/**
 * What an extension does on the server (ADR 0041): public addresses under
 * /_/x/<extension>/, jobs the site's clock runs, and events from the site.
 * Its code still runs in a process of its own, reaching only what it declared.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXTENSION_FORMAT_2, EXTENSION_FORMAT_1, extensionAsks, parseExtension } from '../src/core/index.ts';
import { describeOffer } from '../src/site/cli.ts';
import { startClock } from '../src/site/clock.ts';
import { extensionHost, ROUTE_MAX_BYTES } from '../src/site/extensions.ts';
import { startRuntime } from '../src/site/runtime.ts';
import { Store } from '../src/site/store.ts';
import plain from '../themes/plain.json';

const dir = await mkdtemp(join(tmpdir(), 'uhlaka-ext-server-'));
afterAll(() => rm(dir, { recursive: true, force: true }));

const CODE = `export const actions = {
  hook: async (input, host) => {
    await host.collections.insert('log', { line: input.method + ' ' + (input.query.ref ?? '') + ' ' + input.body });
    if (input.query.go) return { status: 303, headers: { location: '/thanks/', 'set-cookie': 'x=1', 'cache-control': 'no-cache' } };
    return { status: 202, body: { ok: true, sawCookie: 'cookie' in input.headers, sawType: input.headers['content-type'] ?? '' } };
  },
  text: async () => 'plain',
  empty: async () => ({ status: 204 }),
  broken: async () => { throw new Error('no'); },
  sync: async (input, host) => { await host.collections.insert('log', { line: 'sync' }); },
  heard: async (input, host) => { await host.collections.insert('log', { line: input.event + ' ' + (input.title ?? input.body ?? '') }); },
};`;

const manifest = {
  name: 'notices',
  displayName: 'Notices',
  version: '1.0.0',
  collections: [{ name: 'log', label: 'Log', fields: [{ key: 'line', label: 'Line', kind: 'text' }] }],
  actions: [
    { name: 'hook', label: 'Hook', writes: ['log'] },
    { name: 'text', label: 'Text' },
    { name: 'empty', label: 'Empty' },
    { name: 'broken', label: 'Broken' },
    { name: 'sync', label: 'Sync stock', writes: ['log'] },
    { name: 'heard', label: 'Heard', writes: ['log'] },
    { name: 'onBlock', label: 'On a block', on: 'block' },
  ],
  routes: [
    { path: '/stripe/confirm/', action: 'hook', methods: ['get', 'POST'] },
    { path: 'text', action: 'text', methods: ['GET'] },
    { path: 'empty', action: 'empty' },
    { path: 'broken', action: 'broken' },
  ],
  jobs: [{ action: 'sync', everyMinutes: 15 }],
  events: [
    { on: 'page.published', action: 'heard' },
    { on: 'comment.created', action: 'heard' },
    { on: 'comment.created', action: 'heard' },
  ],
};
const PACKAGE = JSON.stringify({ format: EXTENSION_FORMAT_2, manifest, code: CODE });

async function site(name: string): Promise<Store> {
  const store = await Store.open(join(dir, `${name}.db`));
  await store.setTheme(plain);
  await store.publishTheme();
  await store.setSite({ name: 'Atelier', url: 'https://example.com' });
  await store.savePage({ slug: '', title: 'Home', blocks: [] });
  await store.publish('');
  const host = extensionHost(store);
  await host.install(PACKAGE, (await host.offer(PACKAGE)).sha256);
  host.close();
  return store;
}

/** The log the extension keeps, once it holds what is waited for. */
async function logged(store: Store, wanted: number): Promise<string[]> {
  for (let i = 0; i < 100; i++) {
    const lines = (await store.extensionRows('notices', 'log')).map((r) => String(r.line));
    if (lines.length >= wanted) return lines;
    await Bun.sleep(30);
  }
  return (await store.extensionRows('notices', 'log')).map((r) => String(r.line));
}

describe('a package in the second format', () => {
  test('declares routes, jobs and events, and says so before it is installed', () => {
    const { pkg, problems } = parseExtension(JSON.parse(PACKAGE));
    expect(problems).toEqual([]);
    expect(pkg?.manifest.routes).toEqual([
      { path: 'stripe/confirm', action: 'hook', methods: ['GET', 'POST'] },
      { path: 'text', action: 'text', methods: ['GET'] },
      { path: 'empty', action: 'empty', methods: ['POST'] },
      { path: 'broken', action: 'broken', methods: ['POST'] },
    ]);
    const asks = extensionAsks(pkg!.manifest);
    expect([asks.routes[0], asks.jobs, asks.events]).toEqual(['/_/x/notices/stripe/confirm', [{ action: 'Sync stock', everyMinutes: 15 }], ['page.published', 'comment.created']]);
    const said = describeOffer({ manifest: pkg!.manifest, sha256: 'x', asks, replaces: null, accountsOff: false, shopOff: false });
    expect(said).toContain('answer visitors at /_/x/notices/stripe/confirm');
    expect(said).toContain('do "Sync stock" every 15 minutes');
    expect(said).toContain('be told when: page.published, comment.created');
    expect(describeOffer({ manifest: pkg!.manifest, sha256: 'x', asks: { ...asks, jobs: [{ action: 'Tick', everyMinutes: 1 }] }, replaces: null, accountsOff: false, shopOff: false })).toContain('do "Tick" every minute');
  });

  test('in the first format, has none of them', () => {
    expect(parseExtension({ format: EXTENSION_FORMAT_1, manifest, code: CODE }).pkg?.manifest.routes).toEqual([]);
  });

  test('that asks for what it may not is refused with every reason', () => {
    const { problems } = parseExtension({
      format: EXTENSION_FORMAT_2,
      code: CODE,
      manifest: {
        ...manifest,
        routes: [{ path: 'A b' }, { path: 'x', action: 'onBlock' }, { path: 'y', action: 'nothing' }, { path: 'text', action: 'text' }, { path: 'text', action: 'text' }, 'x'],
        jobs: [{ action: 'sync', everyMinutes: 0 }, { action: 'sync', everyMinutes: 5 }, { action: 'sync', everyMinutes: 5 }, 'x'],
        events: [{ on: 'everything', action: 'heard' }, 'x'],
      },
    });
    expect(problems).toEqual([
      'a route\'s path is lower case words joined by / ("A b")',
      'the route "x" runs "onBlock", which the editor offers on a block',
      'the route "y" runs "nothing", which is not one of its actions',
      'the route "text" is declared twice',
      'a job runs every 1 to 10080 minutes ("0")',
      'the job "sync" is declared twice',
      'an extension listens to one of page.published, entry.published, comment.created, comment.approved, message.received ("everything")',
    ]);
  });
});

describe('on the runtime', () => {
  test('a route answers visitors with what its action gives back', async () => {
    const store = await site('routes');
    const lines: string[] = [];
    const runtime = startRuntime(store, { listen: false, log: (line) => lines.push(line) });
    const call = (path: string, init: RequestInit = {}) => runtime.fetch(new Request(`http://site.local${path}`, init), '1.1.1.1');
    try {
      const paid = await call('/_/x/notices/stripe/confirm?ref=7', { method: 'POST', headers: { cookie: 'uhlaka_session=secret', 'content-type': 'text/plain' }, body: 'paid' });
      expect(paid.status).toBe(202);
      expect(paid.headers.get('content-type')).toBe('application/json; charset=utf-8');
      expect(await paid.json()).toEqual({ ok: true, sawCookie: false, sawType: 'text/plain' });
      expect(await logged(store, 1)).toEqual(['POST 7 paid']);

      const back = await call('/_/x/notices/stripe/confirm/?go=1');
      expect([back.status, back.headers.get('location'), back.headers.get('set-cookie'), back.headers.get('cache-control')]).toEqual([303, '/thanks/', null, 'no-cache']);
      expect(await (await call('/_/x/notices/text')).text()).toBe('plain');
      expect((await call('/_/x/notices/text', { method: 'HEAD' })).status).toBe(200);
      expect((await call('/_/x/notices/empty', { method: 'POST' })).status).toBe(204);
      const refused = await call('/_/x/notices/text', { method: 'POST' });
      expect([refused.status, refused.headers.get('allow')]).toEqual([405, 'GET']);
      expect((await call('/_/x/notices/nothing')).status).toBe(404);
      expect((await call('/_/x/nobody/text')).status).toBe(404);
      expect((await call('/_/x/notices/stripe/confirm', { method: 'POST', body: 'x'.repeat(ROUTE_MAX_BYTES + 1) })).status).toBe(413);
      expect((await call('/_/x/notices/stripe/confirm', { method: 'POST', headers: { 'content-length': String(ROUTE_MAX_BYTES + 1) } })).status).toBe(413);
      expect((await call('/_/x/notices/broken', { method: 'POST' })).status).toBe(502);
      expect(lines.at(-1)).toBe('Notices could not answer /_/x/notices/broken: no');

      await store.enableExtension('notices', false);
      expect((await call('/_/x/notices/text')).status).toBe(404);
    } finally {
      runtime.stop();
      await store.close();
    }
  });
});

describe('a job', () => {
  test('runs when it is due, once across every clock, and again after its interval', async () => {
    const store = await site('jobs');
    const host = extensionHost(store, { log: () => {} });
    try {
      const at = new Date('2026-11-20T10:00:00Z');
      expect(await host.jobs(at)).toEqual(['notices.sync']);
      expect(await host.jobs(new Date('2026-11-20T10:14:00Z'))).toEqual([]);
      expect(await store.claimJob('notices', 'sync', 15, at)).toBe(false);
      expect(await host.jobs(new Date('2026-11-20T10:15:00Z'))).toEqual(['notices.sync']);
      expect(await logged(store, 2)).toEqual(['sync', 'sync']);

      // The clock does the jobs at each look.
      let asked: Date | null = null;
      const clock = startClock(store, { run: false, log: () => {}, now: () => new Date('2026-11-20T11:00:00Z'), jobs: async (now) => void (asked = now) });
      await clock.tick();
      expect(asked as Date | null).toEqual(new Date('2026-11-20T11:00:00Z'));

      // One that fails is said, and tried at its next time.
      const said: string[] = [];
      const failing = extensionHost(store, { log: (line) => said.push(line) });
      await store.enableExtension('notices', true);
      const broken = JSON.parse(PACKAGE);
      broken.manifest.version = '1.0.1';
      broken.code = CODE.replace("await host.collections.insert('log', { line: 'sync' });", "throw new Error('the stock is not there');");
      const text = JSON.stringify(broken);
      await failing.install(text, (await failing.offer(text)).sha256);
      expect(await failing.jobs(new Date('2026-11-20T12:00:00Z'))).toEqual([]);
      expect(said).toEqual(['Notices could not do "sync": the stock is not there']);
      failing.close();

      await store.enableExtension('notices', false);
      expect(await host.jobs(new Date('2026-11-21T10:00:00Z'))).toEqual([]);
      await store.uninstallExtension('notices');
      expect(await store.claimJob('notices', 'sync', 15, new Date('2026-11-21T10:00:00Z'))).toBe(true);
    } finally {
      host.close();
      await store.close();
    }
  });
});

describe('an event', () => {
  test('is told to the extensions that listen, and to none that is off', async () => {
    const store = await site('events');
    const said: string[] = [];
    const host = extensionHost(store, { log: (line) => said.push(line) });
    const stop = host.listen();
    try {
      await store.publish('');
      await store.addComment({ type: 'posts', entry: 'x', name: 'Ana', email: 'ana@example.org', body: 'Hi', consent: 'c' });
      expect((await logged(store, 2)).sort()).toEqual(['comment.created Hi', 'page.published Home']);

      // A listener that throws does not undo what happened.
      const off = store.onEvent(() => {
        throw new Error('a bad listener');
      });
      await store.publish('');
      off();
      expect(await logged(store, 3)).toHaveLength(3);

      await store.enableExtension('notices', false);
      await host.deliver({ name: 'page.published', data: { slug: '', title: 'Home' } });
      expect(await store.extensionRows('notices', 'log')).toHaveLength(3);

      // One whose action fails is said, and goes no further.
      await store.enableExtension('notices', true);
      const broken = JSON.parse(PACKAGE);
      broken.manifest.version = '1.0.2';
      broken.code = CODE.replace('heard: async (input, host) => {', "heard: async () => { throw new Error('deaf'); }, unused: async (input, host) => {");
      const text = JSON.stringify(broken);
      await host.install(text, (await host.offer(text)).sha256);
      await host.deliver({ name: 'page.published', data: { slug: '', title: 'Home' } });
      expect(said).toEqual(['Notices could not take page.published: deaf']);
    } finally {
      stop();
      host.close();
      await store.close();
    }
  });
});
