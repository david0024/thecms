/**
 * The third format of extensions (ADR 0062): what every visit tells, in
 * batches and without who made it, and numbers added to rather than written over.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ANSWER_SECONDS, EXTENSION_FORMAT, EXTENSION_FORMAT_2, extensionAsks, parseExtension, postsType } from '../src/core/index.ts';
import { BATCH_MAX, batches, extensionHost, WAITING_MAX } from '../src/site/extensions.ts';
import { startForms } from '../src/site/forms.ts';
import { FRESH_MS, startRuntime } from '../src/site/runtime.ts';
import { localShared } from '../src/site/shared.ts';
import { Store, type SiteEvent } from '../src/site/store.ts';
import plain from '../themes/plain.json';

const dir = await mkdtemp(join(tmpdir(), 'uhlaka-ext3-'));
afterAll(() => rm(dir, { recursive: true, force: true }));

const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

const CODE = `export const actions = {
  served: async (input, host) => {
    for (const item of input.items) await host.collections.insert('heard', { line: JSON.stringify(item) });
  },
  searched: async (input, host) => {
    for (const item of input.items) await host.collections.insert('heard', { line: 'search ' + item.words });
  },
  count: async (input, host) => host.collections.add('totals', input.id, input.numbers, input.row),
};`;

const manifest = {
  name: 'counter',
  displayName: 'Counter',
  version: '1.0.0',
  collections: [
    { name: 'heard', label: 'Heard', fields: [{ key: 'line', label: 'Line', kind: 'longtext' }] },
    {
      name: 'totals',
      label: 'Totals',
      fields: [
        { key: 'day', label: 'Day', kind: 'text' },
        { key: 'hits', label: 'Hits', kind: 'number' },
        { key: 'visitors', label: 'Visitors', kind: 'number' },
      ],
    },
  ],
  actions: [
    { name: 'served', label: 'Served', writes: ['heard'] },
    { name: 'searched', label: 'Searched', writes: ['heard'] },
    { name: 'count', label: 'Count', writes: ['totals'] },
  ],
  events: [
    { on: 'page.served', action: 'served' },
    { on: 'search.made', action: 'searched' },
  ],
};
const PACKAGE = JSON.stringify({ format: EXTENSION_FORMAT, manifest, code: CODE });

async function site(name: string): Promise<Store> {
  const store = await Store.open(join(dir, `${name}.db`));
  await store.setTheme(plain);
  await store.publishTheme();
  await store.setSite({ name: 'Atelier', url: 'https://site.example' });
  await store.savePage({ slug: '', title: 'Home', blocks: [] });
  await store.publish('');
  await store.savePage({ slug: 'about', title: 'About', blocks: [] });
  await store.publish('about');
  return store;
}

async function install(store: Store): Promise<void> {
  const host = extensionHost(store);
  await host.install(PACKAGE, (await host.offer(PACKAGE)).sha256);
  host.close();
}

describe('the third format', () => {
  test('may listen to the visits; the second may not', () => {
    expect(parseExtension(JSON.parse(PACKAGE)).pkg?.manifest.events.map((e) => e.on)).toEqual(['page.served', 'search.made']);
    const second = parseExtension({ format: EXTENSION_FORMAT_2, manifest, code: CODE });
    expect(second.pkg).toBeNull();
    expect(second.problems.join(' ')).toContain('page.served');
    // The second format is still read, with what it could say.
    expect(parseExtension({ format: EXTENSION_FORMAT_2, manifest: { ...manifest, events: [] }, code: CODE }).pkg?.manifest.name).toBe('counter');
  });
});

describe('a number added to', () => {
  test('counts every add of two processes at once, and makes the row the first time', async () => {
    const store = await site('add');
    await install(store);
    const one = extensionHost(store);
    const two = extensionHost(store);
    try {
      const add = (host: typeof one) => host.run('counter', 'count', { id: '2026-11-22', numbers: { hits: 1, visitors: 2 }, row: { day: '2026-11-22' } });
      await Promise.all(Array.from({ length: 20 }, (_, i) => add(i % 2 ? one : two)));
      expect(await store.extensionRow('counter', 'totals', '2026-11-22')).toEqual({ id: '2026-11-22', day: '2026-11-22', hits: 20, visitors: 40 });
    } finally {
      one.close();
      two.close();
    }
  });

  test('is refused for a field that is not a number, and for a row named otherwise', async () => {
    const store = await site('add-refused');
    await install(store);
    const host = extensionHost(store);
    try {
      await expect(host.run('counter', 'count', { id: 'x', numbers: { day: 1 } })).rejects.toThrow('not a number');
      await expect(host.run('counter', 'count', { id: 'x', numbers: { hits: '1' } })).rejects.toThrow('is a number');
      await expect(host.run('counter', 'count', { id: 'a/b', numbers: { hits: 1 } })).rejects.toThrow('a row added to is named');
      await expect(host.run('counter', 'count', { id: 'x'.repeat(41), numbers: { hits: 1 } })).rejects.toThrow('a row added to is named');
    } finally {
      host.close();
    }
  });
});

describe('what visits tell', () => {
  test('pages served and searches, in a batch, with what was read of the visit and never who made it', async () => {
    const store = await site('served');
    await install(store);
    let clock = Date.parse('2026-11-21T10:00:00Z');
    const shared = localShared({ now: () => clock });
    const runtime = startRuntime(store, { listen: false, log: () => {}, now: () => clock, shared });
    const get = (path: string, headers: Record<string, string> = {}, ip = '10.0.0.1') =>
      runtime.fetch(new Request(`https://site.example${path}`, { headers: { 'user-agent': CHROME, ...headers } }), ip);
    try {
      clock += FRESH_MS;
      await get('/');
      await get('/about/', { referer: 'https://site.example/' });
      await get('/about/', { referer: 'https://www.google.com/', 'user-agent': IPHONE }, '10.0.0.2');
      await get('/', { 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' }, '10.0.0.9');
      await get('/_/search?q=Oak%20Table');
      await runtime.visits.flush();
      await runtime.told.flush();
      const lines = (await store.extensionRows('counter', 'heard')).map((r) => String(r.line));
      expect(lines.filter((l) => l.startsWith('search'))).toEqual(['search oak table']);
      // The rows are named at random, so they are compared in one order.
      const sorted = (list: unknown[]): string[] => list.map((x) => JSON.stringify(x)).sort();
      const items = lines.filter((l) => !l.startsWith('search')).map((l) => JSON.parse(l) as Record<string, unknown>);
      expect(sorted(items)).toEqual(
        sorted([
          { day: '2026-11-21', path: '/', source: '', device: 'computer', first: true },
          { day: '2026-11-21', path: '/about/', source: null, device: 'computer', first: false },
          { day: '2026-11-21', path: '/about/', source: 'Google', device: 'phone', first: true },
        ]),
      );
      expect(lines.join(' ')).not.toContain('10.0.0');
      expect(lines.join(' ')).not.toContain('Mozilla');
    } finally {
      runtime.stop();
    }
  });

  test('nothing is gathered while no extension that is on listens', async () => {
    const delivered: SiteEvent[] = [];
    let on = false;
    const told = batches({ deliver: async (e) => void delivered.push(e), listens: async () => on }, { everyMs: 60_000 });
    try {
      expect(await told.listens('page.served')).toBe(false);
      on = true;
      expect(await told.listens('page.served')).toBe(true);
      told.add('page.served', { path: '/' });
      await told.flush();
      expect(delivered).toEqual([{ name: 'page.served', data: { items: [{ path: '/' }] } }]);
    } finally {
      await told.stop();
    }
  });

  test('a large batch is told in parts; one that is not taken holds the next, and what is beyond the limit is dropped and said', async () => {
    const delivered: number[] = [];
    let release: () => void = () => {};
    let hold = true;
    const said: string[] = [];
    const told = batches(
      {
        deliver: async (e) => {
          delivered.push((e.data.items as unknown[]).length);
          if (hold) await new Promise<void>((resolve) => (release = resolve));
        },
        listens: async () => true,
      },
      { everyMs: 60_000, log: (line) => said.push(line) },
    );
    for (let i = 0; i < 5; i++) told.add('page.served', { i });
    const first = told.flush();
    // The listener has not taken it: what comes waits, up to the limit.
    for (let i = 0; i < WAITING_MAX + 7; i++) told.add('page.served', { i });
    await told.flush();
    expect(delivered).toEqual([5]);
    hold = false;
    release();
    await first;
    await told.flush();
    expect(delivered.slice(1)).toEqual([BATCH_MAX, ...Array(WAITING_MAX / BATCH_MAX - 1).fill(BATCH_MAX)]);
    expect(said).toEqual(['7 of page.served were not told: the extensions that listen did not keep up']);
    await told.stop();
  });
});

const CHECKER = `export const actions = {
  check: async (input, host) => {
    await host.collections.insert('seen', { line: JSON.stringify(input) });
    if (input.words.includes('casino')) return 'spam';
    if (input.words.includes('slow')) return new Promise(() => {});
    if (input.words.includes('odd')) return 'maybe';
    return input.name === 'Trusted' ? 'approve' : 'hold';
  },
  list: async (input, host) => host.published(),
  sneak: async (input, host) => host.published(),
};`;
const checker = {
  name: 'checker',
  displayName: 'Checker',
  version: '1.0.0',
  collections: [{ name: 'seen', label: 'Seen', fields: [{ key: 'line', label: 'Line', kind: 'longtext' }] }],
  uses: ['published'],
  actions: [
    { name: 'check', label: 'Check', writes: ['seen'], timeoutSeconds: 30 },
    { name: 'list', label: 'List', uses: ['published'] },
    { name: 'sneak', label: 'Sneak' },
  ],
  answers: [{ question: 'comment.check', action: 'check' }],
};
const CHECKER_PACKAGE = JSON.stringify({ format: EXTENSION_FORMAT, manifest: checker, code: CHECKER });

describe('a question the program waits for', () => {
  test('is declared, shown before installing, and only in the third format', () => {
    const { pkg } = parseExtension(JSON.parse(CHECKER_PACKAGE));
    expect(pkg?.manifest.answers).toEqual([{ question: 'comment.check', action: 'check', methods: [] }]);
    expect(extensionAsks(pkg!.manifest)).toMatchObject({ answers: ['comment.check'], uses: ['published'] });
    expect(parseExtension({ format: EXTENSION_FORMAT_2, manifest: checker, code: CHECKER }).pkg?.manifest.answers).toEqual([]);
    const wrong = parseExtension({
      format: EXTENSION_FORMAT,
      manifest: { ...checker, uses: ['payments'], answers: [{ question: 'order.pay', action: 'check' }, { question: 'comment.check', action: 'nothing' }] },
      code: CHECKER,
    });
    expect(wrong.problems).toEqual([
      'an extension reads published, members, mail, orders of the program\'s data ("payments")',
      'list: it reads "published", which the extension does not declare in "uses"',
      'an extension answers one of comment.check, checkout.payment, checkout.delivery, invoice.make, invoice.storno ("order.pay")',
      'answering comment.check runs "nothing", which is not one of its actions',
    ]);
  });

  test('comment.check: the answer is waited for, spam is kept apart, and the writer\'s address is never given', async () => {
    const store = await site('checked');
    await store.setSite({ ...(await store.site()), forms: 'https://site.example', types: [{ ...postsType(), comments: true }] });
    await store.savePost({ slug: 'oak', title: 'On oak', date: '2026-11-01', blocks: [] });
    await store.publishPost('oak');
    const said: string[] = [];
    const host = extensionHost(store, { log: (l) => said.push(l) });
    await host.install(CHECKER_PACKAGE, (await host.offer(CHECKER_PACKAGE)).sha256);
    const forms = startForms(store, { listen: false, log: () => {}, ask: host.ask });
    const send = (name: string, words: string, email = 'ana@example.org') =>
      forms.fetch(
        new Request('http://forms.local/comment', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://site.example' },
          body: new URLSearchParams({ back: '/blog/oak/', type: 'posts', entry: 'oak', name, email, comment: words, consent: 'yes', website: '' }).toString(),
        }),
        `10.0.0.${name.length}`,
      );
    try {
      await send('Ana', 'Lovely grain.');
      await send('Trusted', 'Nice.', 'trusted@example.org');
      await send('Bot', 'Win at the casino');
      await send('Odd', 'An odd answer');
      const shown = await store.comments();
      expect(shown.map((c) => `${c.name}:${c.approved ? 'shown' : c.spam ? 'spam' : 'waiting'}`)).toEqual(['Odd:waiting', 'Ana:waiting', 'Trusted:shown', 'Bot:spam']);
      expect(said.some((l) => l.includes('did not answer comment.check') && l.includes('"maybe"'))).toBe(true);
      const seen = (await store.extensionRows('checker', 'seen')).map((r) => JSON.parse(String(r.line)) as Record<string, unknown>);
      expect(seen[0]).toEqual({ question: 'comment.check', name: 'Ana', words: 'Lovely grain.', language: 'en', entry: '/blog/oak/', title: 'On oak' });
      expect(JSON.stringify(seen)).not.toContain('@example.org');
      // The owner may still approve what was taken for spam.
      await store.approveComment(shown.find((c) => c.spam)!.id);
      expect((await store.comments()).find((c) => c.name === 'Bot')?.approved).toBe(true);
    } finally {
      forms.stop();
      host.close();
    }
  });

  test('an extension that does not answer in time is gone around', async () => {
    const store = await site('late');
    const host = extensionHost(store, { log: () => {} });
    await host.install(CHECKER_PACKAGE, (await host.offer(CHECKER_PACKAGE)).sha256);
    try {
      const started = Date.now();
      expect(await host.ask('comment.check', { name: 'Ana', words: 'slow', language: 'en', entry: '/', title: 'Home' })).toEqual([]);
      expect(Date.now() - started).toBeLessThan(ANSWER_SECONDS * 1000 + 2000);
    } finally {
      host.close();
    }
  }, 20_000);
});

describe('the program\'s data', () => {
  test('published: the pages and entries visitors can read, newest first; never what is behind a password, and only for an action that declared it', async () => {
    const store = await site('published');
    await store.setSite({ ...(await store.site()), types: [postsType()] });
    await store.savePost({ slug: 'oak', title: 'On oak', description: 'Grain', date: '2026-11-01', blocks: [] });
    await store.publishPost('oak');
    await store.savePost({ slug: 'draft', title: 'Not yet', date: '2026-11-05', blocks: [] });
    await store.savePage({ slug: 'secret', title: 'Secret', blocks: [] });
    await store.publish('secret');
    await store.lockPage('secret', 'a long password');
    const host = extensionHost(store);
    await host.install(CHECKER_PACKAGE, (await host.offer(CHECKER_PACKAGE)).sha256);
    try {
      const listed = (await host.run('checker', 'list', {})) as { address: string; title: string; type: string; date: string }[];
      expect(listed.map((p) => `${p.type}:${p.address}:${p.title}`).sort()).toEqual(['page:/:Home', 'page:/about/:About', 'posts:/blog/oak/:On oak']);
      expect(listed.map((p) => p.date)).toEqual(listed.map((p) => p.date).sort().reverse());
      expect(listed.find((p) => p.type === 'posts')).toMatchObject({ date: '2026-11-01', description: 'Grain', language: 'en' });
      await expect(host.run('checker', 'sneak', {})).rejects.toThrow('did not declare that it reads "published"');
    } finally {
      host.close();
    }
  });
});
