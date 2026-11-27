/**
 * What the site's processes share (ADR 0044 d4): Valkey on a server, with what
 * each process keeps standing in for it, in memory and on disk, whenever it
 * does not answer.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBlock } from '../src/core/index.ts';
import { startClock } from '../src/site/clock.ts';
import { FRESH_MS, startRuntime } from '../src/site/runtime.ts';
import { startEditor } from '../src/site/server.ts';
import { ANSWER_MS, isValkeyAddress, localShared, openShared, RETRY_MS, shownAddress, switchable, testValkey, type ValkeyClient, valkeyShared } from '../src/site/shared.ts';
import { Store } from '../src/site/store.ts';
import plain from '../themes/plain.json';

const dir = await mkdtemp(join(tmpdir(), 'uhlaka-shared-'));
afterAll(() => rm(dir, { recursive: true, force: true }));

/** Valkey as the tests play it: a map, answering until it is told to stop. */
function fakeValkey() {
  const kept = new Map<string, string>();
  const state = { down: false, slow: false, connected: false, closed: 0, asked: [] as string[] };
  const client: ValkeyClient = {
    get connected() {
      return state.connected;
    },
    async connect() {
      if (state.down) throw new Error('Connection refused');
      state.connected = true;
    },
    async send(command, args) {
      state.asked.push(command);
      if (state.down) throw new Error('Connection closed');
      if (state.slow) return new Promise(() => {});
      const [key = '', value = ''] = args;
      switch (command) {
        case 'GET':
          return kept.get(key) ?? null;
        case 'SET':
          if (args.includes('NX') && kept.has(key)) return null;
          kept.set(key, value);
          return 'OK';
        case 'DEL':
          return kept.delete(key) ? 1 : 0;
        case 'INCR': {
          const next = Number(kept.get(key) ?? 0) + 1;
          kept.set(key, String(next));
          return next;
        }
        case 'PING':
          return 'PONG';
        default:
          return 1;
      }
    },
    close() {
      state.closed++;
      state.connected = false;
    },
  };
  return { client, kept, state };
}

describe('what one process keeps', () => {
  test('keeps a value for a while, counts tries in a window, and lets one take a claim', async () => {
    let clock = 0;
    const local = localShared({ now: () => clock });
    await local.set('a', 'x', 1000);
    expect(await local.get('a')).toBe('x');
    clock = 1000;
    expect(await local.get('a')).toBeNull();
    expect([await local.hit('n', 500), await local.hit('n', 500), await local.count('n')]).toEqual([1, 2, 2]);
    clock = 1500;
    expect([await local.count('n'), await local.hit('n', 500)]).toEqual([0, 1]);
    expect([await local.claim('c', 100), await local.claim('c', 100)]).toEqual([true, false]);
    clock = 1600;
    expect(await local.claim('c', 100)).toBe(true);
    await local.set('gone', 'y', 1000);
    await local.del('gone');
    expect(await local.get('gone')).toBeNull();
    expect(local.status()).toEqual({ kind: 'local', address: '', up: true, error: '' });
    local.close();
  });

  test('keeps what lasts longer than a minute on disk, so a process started again finds it', async () => {
    const at = join(dir, 'kept');
    await localShared({ dir: at }).set('page', 'built', 3_600_000);
    await localShared({ dir: at }).set('short', 'no', 1000);
    const again = localShared({ dir: at });
    expect(await again.get('page')).toBe('built');
    expect(await again.get('short')).toBeNull();
    await again.del('page');
    expect(await localShared({ dir: at }).get('page')).toBeNull();
    let clock = Date.now();
    await localShared({ dir: at }).set('old', 'v', 120_000);
    clock += 120_000;
    expect(await localShared({ dir: at, now: () => clock }).get('old')).toBeNull();
  });
});

describe('Valkey', () => {
  test('is asked first, and answers as one process would', async () => {
    const { client, kept } = fakeValkey();
    const shared = valkeyShared('redis://:secret@127.0.0.1:6379', { client, log: () => {} });
    await shared.set('a', 'x', 1000.4);
    expect(kept.get('a')).toBe('x');
    expect([await shared.get('a'), await shared.get('none')]).toEqual(['x', null]);
    await shared.del('a');
    expect(kept.has('a')).toBe(false);
    expect([await shared.hit('n', 1000), await shared.hit('n', 1000), await shared.count('n'), await shared.count('m')]).toEqual([1, 2, 2, 0]);
    expect([await shared.claim('c', 1000), await shared.claim('c', 1000)]).toEqual([true, false]);
    expect(shared.status()).toEqual({ kind: 'valkey', address: 'redis://:***@127.0.0.1:6379', up: true, error: '' });
  });

  test('when it does not answer, the site goes on from what the process keeps, is told once, and asks again later', async () => {
    const { client, state } = fakeValkey();
    let clock = 0;
    const said: string[] = [];
    const shared = valkeyShared('valkey://127.0.0.1:6379', { client, log: (line) => said.push(line), now: () => clock });
    state.down = true;
    await shared.set('a', 'x', 1000);
    expect(await shared.get('a')).toBe('x');
    expect(shared.status()).toMatchObject({ up: false, error: 'Connection refused' });
    expect(said).toEqual(['Valkey at valkey://127.0.0.1:6379 does not answer (Connection refused); the site goes on from what this process keeps.']);
    // Within RETRY_MS it is not asked at all.
    const asked = state.asked.length;
    await shared.get('a');
    expect(state.asked.length).toBe(asked);
    state.down = false;
    clock += RETRY_MS;
    expect(await shared.get('a')).toBeNull();
    expect(shared.status().up).toBe(true);
    expect(said[1]).toBe('Valkey answers again at valkey://127.0.0.1:6379.');
    // An answer that does not come is one that is not waited for.
    state.slow = true;
    const started = Date.now();
    expect(await shared.claim('c', 1000)).toBe(true);
    expect(Date.now() - started).toBeLessThan(ANSWER_MS * 3);
    expect(shared.status().error).toContain('no answer within');
    shared.close();
    expect(state.closed).toBe(1);
  });

  test('is tested from Settings → Performance', async () => {
    expect(await testValkey('http://127.0.0.1')).toEqual({ ok: false, ms: 0, error: 'an address starts with redis:// or valkey://' });
    const { client, state } = fakeValkey();
    expect((await testValkey('redis://127.0.0.1:6379', client)).ok).toBe(true);
    state.down = true;
    expect(await testValkey('redis://127.0.0.1:6379', client)).toEqual({ ok: false, ms: 0, error: 'Connection refused' });
    const odd: ValkeyClient = { connected: true, connect: async () => {}, send: async () => 'HELLO', close: () => {} };
    expect((await testValkey('redis://127.0.0.1:6379', odd)).error).toBe('it answered HELLO');
    // Nothing listens there: told so, quickly.
    expect((await testValkey('redis://127.0.0.1:1')).ok).toBe(false);
  });

  test('addresses: which are Valkey\'s, and how they are shown', () => {
    expect(['redis://h:6379', 'rediss://h', 'valkey://h', 'valkeys://u:p@h'].every(isValkeyAddress)).toBe(true);
    expect(['', 'http://h', 'redis://'].some(isValkeyAddress)).toBe(false);
    expect(shownAddress('redis://u:pw@h:6379/0')).toBe('redis://u:***@h:6379/0');
    expect(shownAddress('not one')).toBe('');
    expect(openShared('').status().kind).toBe('local');
    const opened = openShared('valkey://127.0.0.1:1', { log: () => {} });
    expect(opened.status()).toMatchObject({ kind: 'valkey', address: 'valkey://127.0.0.1:1' });
    opened.close();
  });

  test('a new address takes the place of the old one at once', async () => {
    const first = localShared();
    await first.set('a', 'first', 1000);
    const shared = switchable(first);
    expect(await shared.get('a')).toBe('first');
    const { client } = fakeValkey();
    shared.use(valkeyShared('redis://127.0.0.1:6379', { client }));
    expect(await shared.get('a')).toBeNull();
    await shared.set('b', 'x', 1000);
    await shared.del('b');
    expect([await shared.hit('n', 1000), await shared.count('n'), await shared.claim('c', 1000)]).toEqual([1, 1, true]);
    expect(shared.status().kind).toBe('valkey');
    shared.close();
  });

  // A real Valkey (or Redis), when one is given: UHLAKA_TEST_VALKEY=redis://127.0.0.1:6379.
  test.skipIf(!process.env.UHLAKA_TEST_VALKEY)('a real one answers through Bun\'s client', async () => {
    const shared = openShared(process.env.UHLAKA_TEST_VALKEY as string, { log: () => {} });
    const key = `uhlaka-test:${crypto.randomUUID()}`;
    await shared.set(key, 'x', 5000);
    expect(await shared.get(key)).toBe('x');
    expect([await shared.claim(`${key}:c`, 5000), await shared.claim(`${key}:c`, 5000)]).toEqual([true, false]);
    expect([await shared.hit(`${key}:n`, 5000), await shared.hit(`${key}:n`, 5000)]).toEqual([1, 2]);
    await shared.del(key);
    expect(await shared.get(key)).toBeNull();
    expect(shared.status().up).toBe(true);
    expect((await testValkey(process.env.UHLAKA_TEST_VALKEY as string)).ok).toBe(true);
    shared.close();
  });
});

describe('the site', () => {
  test('a runtime serves a version another process built, without building it', async () => {
    const store = await Store.open(join(dir, 'site.db'));
    await store.setTheme(plain);
    await store.publishTheme();
    await store.setSite({ name: 'Atelier', url: 'https://example.com' });
    await store.savePage({ slug: '', title: 'Home', blocks: [createBlock('search')] });
    await store.publish('');
    const shared = localShared();
    const first = startRuntime(store, { listen: false, log: () => {}, shared });
    const second = startRuntime(store, { listen: false, log: () => {}, shared });
    try {
      expect((await first.fetch(new Request('http://site.local/'))).status).toBe(200);
      const version = await store.siteVersion();
      for (let i = 0; i < 50 && (await shared.get(`page:${version}:index.html`)) === null; i++) await Bun.sleep(10);
      await shared.set(`page:${version}:index.html`, 'kept by another process', 60_000);
      expect(await (await second.fetch(new Request('http://site.local/'))).text()).toBe('kept by another process');
      // Once it has built its own, it serves that.
      expect((await second.fetch(new Request('http://site.local/nowhere/'))).status).toBe(404);
      await Bun.sleep(FRESH_MS / 100);
      expect(await (await second.fetch(new Request('http://site.local/'))).text()).toContain('<title>Atelier</title>');
    } finally {
      first.stop();
      second.stop();
      await store.close();
    }
  });

  test('the clock looks once in each tick, whichever process takes it', async () => {
    const store = await Store.open(join(dir, 'clock.db'));
    const shared = localShared();
    const looked: string[] = [];
    const at = () => new Date('2026-11-21T10:00:00Z');
    const one = startClock(store, { run: false, now: at, jobs: async () => void looked.push('one'), claim: shared.claim });
    const two = startClock(store, { run: false, now: at, jobs: async () => void looked.push('two'), claim: shared.claim });
    await one.tick();
    await two.tick();
    expect(looked).toEqual(['one']);
    await store.close();
  });

  test('Settings → Performance shows what is used, tests an address and takes a new one', async () => {
    const store = await Store.open(join(dir, 'editor.db'));
    const editor = await startEditor(store, { listen: false, cacheDir: join(dir, 'editor-cache'), log: () => {} });
    const call = async (method: string, body?: unknown) => {
      const response = await editor.fetch(
        new Request('http://127.0.0.1:4321/api/performance', {
          method,
          headers: { host: '127.0.0.1:4321', 'x-uhlaka-token': editor.token, 'content-type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
      );
      return { status: response.status, data: (await response.json()) as Record<string, any> };
    };
    try {
      expect((await call('GET')).data).toEqual({ status: { kind: 'local', address: '', up: true, error: '' }, address: '', fromEnvironment: false });
      expect((await call('POST', { address: '' })).data.test.ok).toBe(false);
      expect((await call('POST', { address: 'redis://127.0.0.1:1' })).data.test.ok).toBe(false);
      expect((await call('PUT', { address: 'http://nope' })).status).toBe(400);
      const set = (await call('PUT', { address: 'redis://u:pw@127.0.0.1:1' })).data;
      expect(set).toMatchObject({ status: { kind: 'valkey', address: 'redis://u:***@127.0.0.1:1', up: false }, address: 'redis://u:***@127.0.0.1:1' });
      expect(await store.valkeyAddress()).toBe('redis://u:pw@127.0.0.1:1');
      // Sent back as it was shown, it is the same address, kept as it is.
      expect((await call('PUT', { address: 'redis://u:***@127.0.0.1:1' })).data.address).toBe('redis://u:***@127.0.0.1:1');
      expect((await call('POST', { address: 'redis://u:***@127.0.0.1:1' })).data.test.ok).toBe(false);
      // Valkey that does not answer: the site is still served, and the admin is told.
      expect((await editor.fetch(new Request('http://127.0.0.1:4321/', { headers: { host: '127.0.0.1:4321' } }))).status).toBe(404);
      expect((await call('GET')).data.status.up).toBe(false);
      await call('PUT', { address: '' });
      expect((await call('GET')).data.status.kind).toBe('local');
    } finally {
      editor.stop();
    }
    const fixed = await startEditor(store, { listen: false, valkey: 'redis://127.0.0.1:1', log: () => {} });
    try {
      const response = await fixed.fetch(
        new Request('http://127.0.0.1:4321/api/performance', { method: 'PUT', headers: { host: '127.0.0.1:4321', 'x-uhlaka-token': fixed.token, 'content-type': 'application/json' }, body: '{"address":""}' }),
      );
      expect(response.status).toBe(409);
    } finally {
      fixed.stop();
      await store.close();
    }
  });
});
