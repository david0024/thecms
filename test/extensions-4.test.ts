/**
 * The fourth format of extensions (ADR 0076 d4): what a shop's providers
 * need. Collections searched and with a unique field, numbers taken only
 * while enough is left, work queued once and tried again.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanFind, EXTENSION_FORMAT, EXTENSION_FORMAT_3, extensionAsks, findRows, LATER_TRIES, parseExtension } from '../src/core/index.ts';
import { extensionHost } from '../src/site/extensions.ts';
import { Store } from '../src/site/store.ts';

const dir = await mkdtemp(join(tmpdir(), 'uhlaka-ext4-'));
afterAll(() => rm(dir, { recursive: true, force: true }));

const CODE = `export const actions = {
  save: async (input, host) => host.collections.insert('payments', input),
  change: async (input, host) => host.collections.update('payments', input.id, input.row),
  find: async (input, host) => host.collections.find('payments', input),
  seats: async (input, host) => host.collections.add('seats', input.id, { left: input.left }),
  take: async (input, host) => host.collections.take('seats', input.id, { left: input.n }),
  queue: async (input, host) => host.later(input.action, input.input, input.minutes),
  check: async (input, host) => {
    await host.collections.insert('log', { line: JSON.stringify(input) });
    if (input.input && input.input.fail) throw new Error('not yet');
  },
};`;

const manifest = {
  name: 'payer',
  displayName: 'Payer',
  version: '1.0.0',
  collections: [
    {
      name: 'payments',
      label: 'Payments',
      fields: [
        { key: 'session', label: 'Session', kind: 'text', unique: true },
        { key: 'order', label: 'Order', kind: 'text' },
        { key: 'amount', label: 'Amount', kind: 'number' },
        { key: 'state', label: 'State', kind: 'choice', options: ['open', 'paid'] },
      ],
    },
    { name: 'seats', label: 'Seats', fields: [{ key: 'left', label: 'Left', kind: 'number' }] },
    { name: 'log', label: 'Log', fields: [{ key: 'line', label: 'Line', kind: 'longtext' }] },
  ],
  actions: [
    { name: 'save', label: 'Save', writes: ['payments'] },
    { name: 'change', label: 'Change', writes: ['payments'] },
    { name: 'find', label: 'Find', reads: ['payments'] },
    { name: 'seats', label: 'Seats', writes: ['seats'] },
    { name: 'take', label: 'Take', writes: ['seats'] },
    { name: 'queue', label: 'Queue' },
    { name: 'check', label: 'Check', writes: ['log'] },
  ],
  jobs: [{ action: 'check', once: true }],
};
const PACKAGE = JSON.stringify({ format: EXTENSION_FORMAT, manifest, code: CODE });

async function installed(name: string, log: string[] = []) {
  const store = await Store.open(join(dir, `${name}.db`));
  const host = extensionHost(store, { log: (line) => log.push(line) });
  await host.install(PACKAGE, (await host.offer(PACKAGE)).sha256);
  return { store, host, log };
}

describe('the fourth format', () => {
  test('declares a unique field and a job queued once; the third may not', () => {
    const { pkg, problems } = parseExtension(JSON.parse(PACKAGE));
    expect(problems).toEqual([]);
    expect(pkg!.manifest.collections[0]!.fields.map((f) => f.unique)).toEqual([true, false, false, false]);
    expect(pkg!.manifest.later).toEqual(['check']);
    expect(pkg!.manifest.jobs).toEqual([]);
    expect(extensionAsks(pkg!.manifest).later).toEqual(['Check']);
    const third = parseExtension({ format: EXTENSION_FORMAT_3, manifest, code: CODE });
    expect(third.problems).toEqual(['payments.session: a unique field needs uhlaka.extension/4', 'a job queued once needs uhlaka.extension/4']);
    const choice = parseExtension({ format: EXTENSION_FORMAT, manifest: { ...manifest, collections: [{ name: 'x', fields: [{ key: 'y', kind: 'boolean', unique: true }] }] }, code: CODE });
    expect(choice.problems).toContain('x.y: only a field of text, number, url is unique');
  });
});

describe('a search', () => {
  const of = parseExtension(JSON.parse(PACKAGE)).pkg!.manifest.collections[0]!;
  const rows = [
    { id: 'a', session: 's1', order: 'o1', amount: 500, state: 'paid' },
    { id: 'b', session: 's2', order: 'o2', amount: 1500, state: 'open' },
    { id: 'c', session: 's3', order: 'o1', amount: 900, state: 'paid' },
    { id: 'd', session: '', order: 'o3', amount: null, state: 'open' },
  ];
  const find = (raw: unknown) => {
    const { query, problems } = cleanFind(of, raw);
    expect(problems).toEqual([]);
    return findRows(rows, query);
  };

  test('filters on fields, orders, limits and counts', () => {
    expect(find({ where: { order: 'o1' } }).rows.map((r) => r.id)).toEqual(['a', 'c']);
    expect(find({ where: { amount: { gte: 900 } }, order: '-amount' }).rows.map((r) => r.id)).toEqual(['b', 'c']);
    expect(find({ where: { state: { in: ['open'] } }, order: 'amount' }).rows.map((r) => r.id)).toEqual(['b', 'd']);
    expect(find({ where: { session: { has: 'S' } } }).count).toBe(3);
    expect(find({ where: { session: { ne: '' } }, limit: 1, offset: 1 })).toEqual({ rows: [rows[1]!], count: 3 });
    expect(find({}).rows.map((r) => r.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  test('refuses a field the collection does not have, a test it does not know, a limit too large', () => {
    expect(cleanFind(of, { where: { email: 'x' }, order: 'when', limit: 1000 }).problems).toEqual(['payments has no field "email"', 'payments has no field "when" to order by', '"limit" is 0 to 500']);
    expect(cleanFind(of, { where: { amount: { like: '%' } } }).problems).toEqual(['amount: a test is one of ne, gt, gte, lt, lte, in, has ("like")']);
    expect(cleanFind(of, { where: { amount: [1] } }).problems).toEqual(['amount: a value, or a test']);
  });
});

describe('a unique field', () => {
  test('refuses a second row with the same value, kept or changed; an empty one is not counted', async () => {
    const { store, host } = await installed('unique');
    const first = (await host.run('payer', 'save', { session: 'cs_1', order: 'o1', amount: 500 })) as { id: string };
    await expect(host.run('payer', 'save', { session: 'cs_1', order: 'o2' })).rejects.toThrow('another row already has session "cs_1"');
    const second = (await host.run('payer', 'save', { session: 'cs_2', order: 'o2' })) as { id: string };
    await expect(host.run('payer', 'change', { id: second.id, row: { session: 'cs_1' } })).rejects.toThrow('another row already has session "cs_1"');
    // A row changed keeps its own value, and gives up the one it had.
    await host.run('payer', 'change', { id: first.id, row: { session: 'cs_9', state: 'paid' } });
    await host.run('payer', 'save', { session: 'cs_1', order: 'o3' });
    await host.run('payer', 'save', { session: '', order: 'o4' });
    await host.run('payer', 'save', { order: 'o5' });
    // Looked up by its value.
    const found = (await host.run('payer', 'find', { where: { session: 'cs_9' } })) as { rows: { id: string; state: string }[]; count: number };
    expect(found).toMatchObject({ count: 1, rows: [{ id: first.id, state: 'paid' }] });
    expect(((await host.run('payer', 'find', { where: { session: 'cs_404' } })) as { count: number }).count).toBe(0);
    expect(((await host.run('payer', 'find', { where: { order: { in: ['o3', 'o4', 'o5'] } } })) as { count: number }).count).toBe(3);
    // A row removed frees its value.
    await store.deleteExtensionRow('payer', 'payments', first.id);
    await host.run('payer', 'save', { session: 'cs_9' });
    host.close();
  });
});

describe('a number taken', () => {
  test('in one step, and never below zero', async () => {
    const { host } = await installed('take');
    await host.run('payer', 'seats', { id: 'concert', left: 3 });
    const taken = await Promise.allSettled(Array.from({ length: 5 }, () => host.run('payer', 'take', { id: 'concert', n: 1 })));
    expect(taken.filter((t) => t.status === 'fulfilled').length).toBe(3);
    expect(taken.filter((t) => t.status === 'rejected').map((t) => (t as PromiseRejectedResult).reason.message)).toEqual(['not enough left left', 'not enough left left']);
    await expect(host.run('payer', 'take', { id: 'nowhere', n: 1 })).rejects.toThrow('no such row');
    await expect(host.run('payer', 'take', { id: 'concert', n: -1 })).rejects.toThrow('what is taken from "left" is a number, 0 or more');
    host.close();
  });
});

describe('work queued once', () => {
  test('runs when due, is given what it was queued with, and is gone once done', async () => {
    const { store, host } = await installed('later');
    await host.run('payer', 'queue', { action: 'check', input: { invoice: 7 }, minutes: 0 });
    await host.run('payer', 'queue', { action: 'check', input: { invoice: 8 }, minutes: 30 });
    expect(await host.jobs(new Date(Date.now() + 1000))).toEqual(['payer.check']);
    const lines = (await store.extensionRows('payer', 'log')).map((r) => JSON.parse(String(r.line)));
    expect(lines).toMatchObject([{ input: { invoice: 7 }, tries: 0 }]);
    expect(await store.laterCount('payer')).toBe(1);
    expect(await host.jobs(new Date(Date.now() + 31 * 60_000))).toEqual(['payer.check']);
    expect(await store.laterCount('payer')).toBe(0);
    host.close();
  });

  test('is only an action declared so, and not without end', async () => {
    const { host } = await installed('later-refused');
    await expect(host.run('payer', 'queue', { action: 'save', input: {} })).rejects.toThrow('"save" is not one of its jobs queued once');
    await expect(host.run('payer', 'queue', { action: 'check', minutes: 60 * 24 * 31 })).rejects.toThrow('a job is queued 0 to 43200 minutes from now');
    await expect(host.run('payer', 'queue', { action: 'check', input: 'x'.repeat(70_000) })).rejects.toThrow('at most 64 KB');
    host.close();
  });

  test('what fails is tried again, waiting longer each time, and given up after the last try', async () => {
    const { store, host, log } = await installed('later-fails');
    await host.run('payer', 'queue', { action: 'check', input: { fail: true } });
    let at = Date.now() + 1000;
    for (let i = 0; i < LATER_TRIES; i++) {
      expect(await host.jobs(new Date(at))).toEqual([]);
      const [waiting] = await store.laterDue(new Date(at + 365 * 24 * 3600_000));
      if (i < LATER_TRIES - 1) {
        expect(waiting?.tries).toBe(i + 1);
        // Two minutes after the first, four after the second…
        expect(Date.parse(waiting!.dueAt) - Date.now()).toBeGreaterThan(2 ** (i + 1) * 60_000 - 5000);
        at = Date.parse(waiting!.dueAt) + 1000;
      } else expect(waiting).toBeUndefined();
    }
    expect(log.at(-1)).toBe(`Payer could not do "check" after ${LATER_TRIES} tries, and gave it up: not yet`);
    expect((await store.extensionRows('payer', 'log')).length).toBe(LATER_TRIES);
    host.close();
  });

  test('waits while its extension is off, and goes with it', async () => {
    const { store, host } = await installed('later-off');
    await host.run('payer', 'queue', { action: 'check', input: {} });
    await host.enable('payer', false);
    expect(await host.jobs(new Date(Date.now() + 1000))).toEqual([]);
    expect(await store.laterCount('payer')).toBe(1);
    await host.uninstall('payer');
    expect(await store.laterCount('payer')).toBe(0);
    host.close();
  });
});
