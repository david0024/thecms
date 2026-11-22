/**
 * Statistics without a cookie (ADR 0053), kept by an extension the program
 * carries (ADR 0062 d8): the program reads a visit as the page is sent and
 * tells the extension what it read, never who made it; the extension keeps
 * the day's and the month's totals and shows them in a report.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { actions, daysOf, dayIn as dayOfExtension, monthsOf } from '../extensions/stats/index.ts';
import { hashOf, rowsOf, summed } from '../extensions/stats/rows.ts';
import { serverOnly } from '../src/site/check.ts';
import { fullCheck, publishedSite } from '../src/site/export.ts';
import type { ExtensionHost } from '../src/site/extension-runner.ts';
import { batches, extensionHost } from '../src/site/extensions.ts';
import { FRESH_MS, startRuntime } from '../src/site/runtime.ts';
import { startEditor } from '../src/site/server.ts';
import { SHIPPED_STATS } from '../src/site/shipped.ts';
import { localShared } from '../src/site/shared.ts';
import { counted, dayIn, deviceOf, isZone, sourceOf, visits, zoneFor } from '../src/site/stats.ts';
import { STATS, Store } from '../src/site/store.ts';
import plain from '../themes/plain.json';
import { packExtension } from '../tools/pack-extension.ts';

const dir = await mkdtemp(join(tmpdir(), 'thecms-stats-'));
afterAll(() => rm(dir, { recursive: true, force: true }));

const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPAD = 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const ANDROID_TABLET = 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const GOOGLEBOT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

/** The ids a row added to may have (src/site/extensions.ts). */
const ROW_ID = /^[A-Za-z0-9._:-]{1,40}$/;

const visit = (path: string, headers: Record<string, string> = {}, method = 'GET'): Request =>
  new Request(`https://site.example${path}`, { method, headers: { 'user-agent': CHROME, ...headers } });

/** The extension's collections, reached as its code reaches them, without a process of its own. */
const hostOf = (store: Store): ExtensionHost =>
  ({
    collections: {
      list: (collection: string) => store.extensionRows(STATS, collection),
      add: (collection: string, id: string, numbers: Record<string, number>, row?: Record<string, unknown>) => store.addToExtensionRow(STATS, collection, id, row ?? {}, numbers),
      delete: (collection: string, id: string) => store.deleteExtensionRow(STATS, collection, id),
    },
  }) as unknown as ExtensionHost;

type Report = { totals: { label: string; value: number }[]; chart: { labels: string[]; series: { label: string; values: number[] }[] }; lists: { title: string; rows: { label: string; value: number }[] }[] };
const reportOf = async (store: Store, range: string, now: number, timeZone = 'UTC') => (await actions.report({ range, timeZone, now }, hostOf(store))) as Report;
const listOf = (report: Report, title: string) => report.lists.find((l) => l.title === title)?.rows;

async function install(store: Store): Promise<void> {
  const host = extensionHost(store);
  await host.install(SHIPPED_STATS, (await host.offer(SHIPPED_STATS)).sha256);
  host.close();
}

async function site(file: string): Promise<Store> {
  const store = await Store.open(join(dir, file));
  await store.setTheme(plain);
  await store.publishTheme();
  await store.setSite({ name: 'Atelier', url: 'https://site.example' });
  await store.savePage({ slug: '', title: 'Home', blocks: [] });
  await store.publish('');
  await store.savePage({ slug: 'about', title: 'About', blocks: [] });
  await store.publish('about');
  return store;
}

describe('who is counted', () => {
  test('a person reading a page is; a robot, someone signed in, a page loaded ahead and a HEAD are not', () => {
    expect(counted(visit('/'))).toBe(true);
    expect(counted(visit('/', { 'user-agent': GOOGLEBOT }))).toBe(false);
    expect(counted(visit('/', { 'user-agent': 'curl/8.5.0' }))).toBe(false);
    expect(counted(visit('/', { 'user-agent': '' }))).toBe(false);
    expect(counted(visit('/', { 'user-agent': 'Mozilla/5.0 (compatible; facebookexternalhit/1.1)' }))).toBe(false);
    expect(counted(visit('/', { cookie: 'a=b; thecms_session=xyz' }))).toBe(false);
    expect(counted(visit('/', { cookie: 'thecms_page_x=1' }))).toBe(true);
    expect(counted(visit('/', { 'sec-purpose': 'prefetch;prerender' }))).toBe(false);
    expect(counted(visit('/', { purpose: 'prefetch' }))).toBe(false);
    expect(counted(visit('/', {}, 'HEAD'))).toBe(false);
  });

  test('a phone, a tablet and a computer are told apart by the browser\'s name', () => {
    expect(deviceOf(CHROME)).toBe('computer');
    expect(deviceOf(IPHONE)).toBe('phone');
    expect(deviceOf(IPAD)).toBe('tablet');
    expect(deviceOf(ANDROID_TABLET)).toBe('tablet');
    expect(deviceOf('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36')).toBe('phone');
  });

  test('where a visitor came from: a campaign, a known place by its name, another site, directly, or not an arrival', () => {
    const at = new URL('https://site.example/about/');
    expect(sourceOf(new URL('https://site.example/?utm_source=Newsletter'), 'https://www.google.com/')).toBe('newsletter');
    expect(sourceOf(at, 'https://www.google.ro/')).toBe('Google');
    expect(sourceOf(at, 'https://l.facebook.com/')).toBe('Facebook');
    expect(sourceOf(at, 'https://t.co/abc')).toBe('X');
    expect(sourceOf(at, 'https://www.blog.example/post')).toBe('blog.example');
    expect(sourceOf(at, null)).toBe('');
    expect(sourceOf(at, 'not an address')).toBe('');
    expect(sourceOf(at, 'https://site.example/')).toBeNull();
  });

  test('a day is the owner\'s, and a zone that is not one is UTC', () => {
    const late = Date.parse('2026-11-21T23:30:00Z');
    expect(dayIn('UTC', late)).toBe('2026-11-21');
    expect(dayIn('Europe/Bucharest', late)).toBe('2026-11-22');
    expect(dayIn('Nowhere/Else', late)).toBe('2026-11-21');
    expect(isZone('Europe/Bucharest')).toBe(true);
    expect(isZone('UTC')).toBe(true);
    expect(isZone('Nowhere/Else')).toBe(false);
    expect(isZone('<script>')).toBe(false);
  });
});

describe('the extension', () => {
  test('a total is a row of its day and of its month, named the same by every process', () => {
    expect(hashOf('/about/')).toBe(hashOf('/about/'));
    expect(hashOf('/about/')).not.toBe(hashOf('/about'));
    expect(hashOf('')).toMatch(/^[0-9a-f]{16}$/);
    const [day, month] = rowsOf('2026-11-21', 'visitors', 'x'.repeat(500), 2);
    expect(day?.collection).toBe('days');
    expect(month?.collection).toBe('months');
    expect(day?.row).toEqual({ day: '2026-11-21', kind: 'visitors', name: 'x'.repeat(200) });
    expect(month?.row).toEqual({ month: '2026-11', kind: 'visitors', name: 'x'.repeat(200) });
    for (const one of [day, month]) expect(ROW_ID.test(one?.id ?? '')).toBe(true);
    const sums = summed([
      { day: '2026-11-21', kind: 'views', name: '', hits: 1 },
      { day: '2026-11-21', kind: 'views', name: '', hits: 2 },
      { day: '2026-11-20', kind: 'views', name: '', hits: 4 },
    ]);
    expect(sums.map((s) => [s.collection, s.hits])).toEqual([
      ['days', 3],
      ['months', 7],
      ['days', 4],
    ]);
  });

  test('the days and the months of a report', () => {
    const late = Date.parse('2026-11-21T23:30:00Z');
    expect(dayOfExtension('Europe/Bucharest', late)).toBe('2026-11-22');
    expect(dayOfExtension('Nowhere/Else', late)).toBe('2026-11-21');
    expect(daysOf('7', '2026-11-21')).toEqual(['2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21']);
    expect(daysOf('today', '2026-11-22')).toEqual(['2026-11-22']);
    expect(monthsOf('2026-02-10')).toEqual(['2025-03', '2025-04', '2025-05', '2025-06', '2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02']);
  });

  test('a batch is added in one call a row; a report sums a range, by day, or by month for 12 months', async () => {
    const store = await Store.open(join(dir, 'actions.db'));
    const host = hostOf(store);
    let calls = 0;
    const counting = { ...host, collections: { ...host.collections, add: (...args: Parameters<ExtensionHost['collections']['add']>) => (calls++, host.collections.add(...args)) } } as ExtensionHost;
    try {
      await actions.served(
        {
          items: [
            { day: '2026-11-20', path: '/', source: '', device: 'computer', first: true },
            { day: '2026-11-20', path: '/about/', source: null, device: 'computer', first: false },
            { day: '2026-11-20', path: '/', source: '', device: 'computer', first: false },
            { day: '2026-11-21', path: '/about/', source: 'Google', device: 'phone', first: true },
            { day: '2026-11-21', path: '/', source: 'Google', device: 'tablet', first: true },
            { day: 'not a day', path: '/', source: '', device: 'computer', first: true },
          ],
        },
        counting,
      );
      // One call a row, however many visits: 6 rows of the first day, 7 of the second, 9 of their month.
      expect(calls).toBe(22);
      await actions.searched({ items: [{ day: '2026-11-21', words: 'oak' }, { day: '2026-11-21', words: 'oak' }, { day: '2026-11-21', words: '' }] }, host);
      await actions.served({ items: [{ day: '2025-11-02', path: '/', source: '', device: 'computer', first: true }] }, host);

      const now = Date.parse('2026-11-21T10:00:00Z');
      const week = await reportOf(store, '7', now);
      expect(week.totals).toEqual([
        { label: 'Visitors', value: 3 },
        { label: 'Pages seen', value: 5 },
      ]);
      expect(week.chart.labels).toHaveLength(7);
      expect(week.chart.series.map((s) => s.values.at(-1))).toEqual([2, 2]);
      expect(listOf(week, 'Pages read most')).toEqual([
        { label: '/', value: 3 },
        { label: '/about/', value: 2 },
      ]);
      expect(listOf(week, 'Where visitors came from')).toEqual([
        { label: 'Google', value: 2 },
        { label: 'Directly (a typed address or a bookmark)', value: 1 },
      ]);
      expect(listOf(week, 'Devices')).toEqual([
        { label: 'Computer', value: 1 },
        { label: 'Phone', value: 1 },
        { label: 'Tablet', value: 1 },
      ]);
      expect(listOf(week, 'Searched for on the site')).toEqual([{ label: 'oak', value: 2 }]);
      expect((await reportOf(store, 'today', now)).totals[0]?.value).toBe(2);
      expect((await reportOf(store, 'nine', now)).chart.labels).toHaveLength(30);

      const year = await reportOf(store, '365', now);
      expect(year.chart.labels).toHaveLength(12);
      expect(year.chart.labels.at(-1)).toBe('2026-11');
      expect(year.chart.series[0]?.values.at(-1)).toBe(3);
      // November 2025 is the thirteenth month back: not one of the twelve.
      expect(year.totals[0]?.value).toBe(3);
      expect(year.chart.labels[0]).toBe('2025-12');

      // Once a day: days older than a month go, their months stay.
      await actions.forget({ at: '2026-11-21T03:00:00Z' }, host);
      expect((await store.extensionRows(STATS, 'days')).some((r) => r.day === '2025-11-02')).toBe(false);
      expect((await store.extensionRows(STATS, 'days')).some((r) => r.day === '2026-11-20')).toBe(true);
      expect((await store.extensionRows(STATS, 'months')).some((r) => r.month === '2025-11')).toBe(true);
      await actions.forget({}, host);
      await actions.served({ items: undefined as unknown as [] }, host);
      await actions.searched({ items: undefined as unknown as [] }, host);
    } finally {
      await store.close();
    }
  });

  test('the program carries the extension as a fresh pack makes it', async () => {
    const out = await mkdtemp(join(dir, 'pack-'));
    const { file } = await packExtension('extensions/stats', out);
    expect(await Bun.file(file).text()).toBe(SHIPPED_STATS);
  });
});

describe('counted as the site is served', () => {
  test('pages, visitors, sources, devices and searches; robots, people signed in and missing pages are not', async () => {
    const store = await Store.open(join(dir, 'site.db'));
    await install(store);
    let clock = Date.parse('2026-11-21T10:00:00Z');
    const shared = localShared({ now: () => clock });
    const runtime = startRuntime(store, { listen: false, log: () => {}, now: () => clock, shared });
    const get = (path: string, headers: Record<string, string> = {}, ip = '10.0.0.1') => runtime.fetch(visit(path, headers), ip);
    try {
      await store.setTheme(plain);
      await store.publishTheme();
      await store.setSite({ name: 'Atelier', url: 'https://site.example' });
      await store.savePage({ slug: '', title: 'Home', blocks: [] });
      await store.publish('');
      await store.savePage({ slug: 'about', title: 'About', blocks: [] });
      await store.publish('about');
      await store.savePage({ slug: 'secret', title: 'Secret', blocks: [] });
      await store.publish('secret');
      await store.lockPage('secret', 'a long password');
      clock += FRESH_MS;

      expect((await get('/')).status).toBe(200);
      expect((await get('/about/', { referer: 'https://site.example/' })).status).toBe(200);
      expect((await get('/about/', { referer: 'https://www.google.com/' }, '10.0.0.2')).status).toBe(200);
      expect((await get('/', { 'user-agent': IPHONE }, '10.0.0.3')).status).toBe(200);
      // Not counted.
      await get('/', { 'user-agent': GOOGLEBOT }, '10.0.0.9');
      await get('/', { cookie: 'thecms_session=abc' }, '10.0.0.9');
      await get('/nowhere/', {}, '10.0.0.9');
      await get('/assets/site.css', {}, '10.0.0.9');
      await get('/secret/', {}, '10.0.0.9');
      // Searched.
      await get('/_/search?q=%20Oak%20%20Table');
      await get('/_/search?q=');
      await runtime.visits.flush();
      await runtime.told.flush();

      const day = await reportOf(store, 'today', clock);
      expect(day.totals.map((t) => t.value)).toEqual([3, 4]);
      expect(listOf(day, 'Pages read most')).toEqual([
        { label: '/', value: 2 },
        { label: '/about/', value: 2 },
      ]);
      expect(listOf(day, 'Where visitors came from')).toEqual([
        { label: 'Directly (a typed address or a bookmark)', value: 2 },
        { label: 'Google', value: 1 },
      ]);
      expect(listOf(day, 'Devices')).toEqual([
        { label: 'Computer', value: 2 },
        { label: 'Phone', value: 1 },
      ]);
      expect(listOf(day, 'Searched for on the site')).toEqual([{ label: 'oak table', value: 1 }]);

      // The next day: the same person is a new visitor, and yesterday's key is gone.
      expect(await shared.get('visits:key:2026-11-21')).not.toBeNull();
      clock += 86_400_000;
      await get('/');
      await runtime.visits.flush();
      await runtime.told.flush();
      expect(await shared.get('visits:key:2026-11-21')).toBeNull();
      const two = await reportOf(store, '7', clock);
      expect(two.totals.map((t) => t.value)).toEqual([4, 5]);

      // Nothing kept names a visitor: only totals.
      const kept = JSON.stringify([...(await store.extensionRows(STATS, 'days')), ...(await store.extensionRows(STATS, 'months'))]);
      expect(kept.includes('10.0.0')).toBe(false);
      expect(kept.includes('Chrome')).toBe(false);
    } finally {
      runtime.stop();
      await store.close();
    }
  });

  test('a page behind a password is counted once it is opened', async () => {
    const store = await Store.open(join(dir, 'locked.db'));
    await install(store);
    let clock = Date.parse('2026-11-21T10:00:00Z');
    const runtime = startRuntime(store, { listen: false, log: () => {}, now: () => clock });
    try {
      await store.setTheme(plain);
      await store.publishTheme();
      await store.savePage({ slug: '', title: 'Home', blocks: [] });
      await store.publish('');
      await store.savePage({ slug: 'secret', title: 'Secret', blocks: [] });
      await store.publish('secret');
      await store.lockPage('secret', 'a long password');
      clock += FRESH_MS;
      const opened = await runtime.fetch(new Request('https://site.example/_/unlock', { method: 'POST', body: 'back=%2Fsecret%2F&password=a+long+password', headers: { 'content-type': 'application/x-www-form-urlencoded' } }), '10.0.0.1');
      const cookie = (opened.headers.get('set-cookie') ?? '').split(';')[0] as string;
      expect((await runtime.fetch(visit('/secret/', { cookie }), '10.0.0.1')).status).toBe(200);
      await runtime.visits.flush();
      await runtime.told.flush();
      expect(listOf(await reportOf(store, 'today', clock), 'Pages read most')).toEqual([{ label: '/secret/', value: 1 }]);
    } finally {
      runtime.stop();
      await store.close();
    }
  });

  test('until it is installed, nothing is read of a visit', async () => {
    const store = await site('none.db');
    const told = batches({ listens: async () => false, deliver: async () => {} });
    const added: unknown[] = [];
    const counter = visits(store, localShared(), { told: { ...told, add: (...args: unknown[]) => void added.push(args) } as typeof told });
    try {
      await counter.seen(visit('/'), '10.0.0.1', '/');
      await counter.searched(visit('/_/search?q=oak'), 'oak');
      await counter.seen(visit('/', { 'user-agent': GOOGLEBOT }), '10.0.0.1', '/');
      await visits(store, localShared()).seen(visit('/'), '10.0.0.1', '/');
      await counter.flush();
      expect(added).toEqual([]);
    } finally {
      await told.stop();
      await store.close();
    }
  });
});

describe('moved from before', () => {
  const day = (ago: number) => new Date(Date.now() - ago * 86_400_000).toISOString().slice(0, 10);
  const databases: [string, string][] = [['SQLite', join(dir, 'moved.db')]];
  if (process.env.THECMS_TEST_POSTGRES) databases.push(['Postgres', process.env.THECMS_TEST_POSTGRES]);
  if (process.env.THECMS_TEST_MYSQL) databases.push(['MySQL', process.env.THECMS_TEST_MYSQL]);
  for (const [name, address] of databases) {
    test(`the totals kept before go to the extension's rows, and their table goes, in ${name}`, async () => {
      const before = await Store.open(address);
      await before.rawForTests(`DELETE FROM extension_rows WHERE extension = '${STATS}'`);
      await before.rawForTests('CREATE TABLE visits (day VARCHAR(10) NOT NULL, kind VARCHAR(20) NOT NULL, name VARCHAR(255) NOT NULL, hits INTEGER NOT NULL)');
      await before.rawForTests('INSERT INTO visits (day, kind, name, hits) VALUES (?, ?, ?, ?), (?, ?, ?, ?), (?, ?, ?, ?), (?, ?, ?, ?)', [
        day(1), 'views', '', 3,
        day(1), 'page', '/ă/', 2,
        day(200), 'views', '', 5,
        day(1), 'nonsense', '', 9,
      ]);
      await before.close();
      const store = await Store.open(address);
      try {
        const days = await store.extensionRows(STATS, 'days');
        expect(days.map((r) => [r.day, r.kind, r.name, r.hits]).sort()).toEqual([
          [day(1), 'page', '/ă/', 2],
          [day(1), 'views', '', 3],
        ]);
        const months = await store.extensionRows(STATS, 'months');
        expect(months.filter((r) => r.kind === 'views').map((r) => r.hits).sort()).toEqual(day(1).slice(0, 7) === day(200).slice(0, 7) ? [8] : [3, 5]);
        expect(store.rawForTests('SELECT 1 FROM visits')).rejects.toThrow();
        // Opened again, there is nothing more to move.
        await store.close();
        const again = await Store.open(address);
        expect((await again.extensionRows(STATS, 'days')).length).toBe(2);
        await again.rawForTests(`DELETE FROM extension_rows WHERE extension = '${STATS}'`);
        await again.close();
      } catch (error) {
        await store.close().catch(() => {});
        throw error;
      }
    });
  }

  test('a backup from before holds them too: restored, they go to the same rows', async () => {
    const store = await Store.open(join(dir, 'restored.db'));
    try {
      await store.addToExtensionRow(STATS, 'days', 'gone', { day: day(1) }, { hits: 1 });
      const rows = async function* () {
        yield { table: 'meta', row: { key: 'site', value: JSON.stringify({ name: 'Old' }) } };
        yield { table: 'visits', row: { day: day(2), kind: 'visitors', name: '', hits: 4 } };
        yield { table: 'visits', row: { day: day(2), kind: 'visitors', name: '', hits: 1 } };
      };
      expect(await store.restoreRows(rows())).toBe(3);
      expect((await store.extensionRows(STATS, 'days')).map((r) => [r.day, r.kind, r.hits])).toEqual([[day(2), 'visitors', 5]]);
      expect((await store.extensionRows(STATS, 'months')).map((r) => r.hits)).toEqual([5]);
    } finally {
      await store.close();
    }
  });
});

describe('what the admin is shown', () => {
  test('the owner\'s time zone becomes the statistics\' own; an editor\'s does not', async () => {
    const store = await Store.open(join(dir, 'zone.db'));
    try {
      expect(await zoneFor(store, 'Europe/Bucharest', false)).toBe('UTC');
      expect(await zoneFor(store, 'Not/AZone', true)).toBe('UTC');
      expect(await zoneFor(store, '', true)).toBe('UTC');
      expect(await zoneFor(store, 'Europe/Bucharest', true)).toBe('Europe/Bucharest');
      expect(await store.statsZone()).toBe('Europe/Bucharest');
    } finally {
      await store.close();
    }
  });

  test('the owner installs the statistics from their screen; the editors read them', async () => {
    const store = await site('admin.db');
    const editor = await startEditor(store, { listen: false, public: 'https://cms.example.com' });
    const ion = await store.addUser({ email: 'ion@example.com', role: 'editor', password: 'a long password' });
    const ana = await store.addUser({ email: 'ana@example.com', role: 'author', password: 'a long password' });
    const owner = await store.addUser({ email: 'owner@example.com', role: 'owner', password: 'a long password' });
    const as = async (id: string) => `thecms_session=${await store.startSession(id)}`;
    const cookies = { owner: await as(owner.id), editor: await as(ion.id), author: await as(ana.id) };
    const call = async (who: keyof typeof cookies, method: string, path: string, body?: unknown) => {
      const response = await editor.fetch(
        new Request(`https://cms.example.com${path}`, {
          method,
          headers: { host: 'cms.example.com', origin: 'https://cms.example.com', 'x-thecms-request': '1', cookie: cookies[who], 'content-type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
      );
      return { status: response.status, data: (await response.json()) as Record<string, any> };
    };
    try {
      const first = await call('owner', 'GET', '/api/stats?zone=Europe%2FBucharest');
      expect(first.data.installed).toBeNull();
      expect(first.data.zone).toBe('Europe/Bucharest');
      expect(first.data.offer.manifest.name).toBe('stats');
      expect(first.data.offer.asks.events).toEqual(['page.served', 'search.made']);
      const seen = await call('editor', 'GET', '/api/stats?zone=America%2FNew_York');
      expect([seen.data.offer, seen.data.installed, seen.data.zone]).toEqual([null, null, 'Europe/Bucharest']);
      expect((await call('editor', 'POST', `/api/stats/install?sha256=${first.data.offer.sha256}`)).status).toBe(403);
      expect((await call('owner', 'GET', '/api/stats/install')).status).toBe(404);
      expect((await call('owner', 'PUT', '/api/stats')).status).toBe(404);
      expect((await call('owner', 'POST', '/api/stats/install?sha256=nope')).status).toBe(400);

      const done = await call('owner', 'POST', `/api/stats/install?sha256=${first.data.offer.sha256}`);
      expect(done.data.installed).toEqual({ version: '1.0.0', enabled: true });
      expect(done.data.offer).toBeNull();
      expect(done.data.extensions.find((e: { name: string }) => e.name === 'stats').views[0].type).toBe('report');

      // An editor sees the report, and runs only what it runs.
      const read = (await call('editor', 'GET', '/api/stats')).data.extensions.find((e: { name: string }) => e.name === 'stats');
      expect(read.views.map((v: { id: string }) => v.id)).toEqual(['stats.report']);
      expect(read.actions.map((a: { name: string }) => a.name)).toEqual(['report']);
      expect(read.collections).toEqual([]);
      expect(read.sha256).toBeUndefined();
      const answered = await call('editor', 'POST', '/api/extensions/stats/run/report', { input: { range: '7', timeZone: 'UTC' } });
      expect(answered.status).toBe(200);
      expect(answered.data.answer.chart.labels).toHaveLength(7);
      expect((await call('editor', 'POST', '/api/extensions/stats/run/forget', { input: {} })).status).toBe(403);
      // An author reads no statistics.
      const author = (await call('author', 'GET', '/api/extensions')).data.extensions.find((e: { name: string }) => e.name === 'stats');
      expect(author.views).toBeUndefined();
      expect((await call('author', 'POST', '/api/extensions/stats/run/report', { input: { range: '7' } })).status).toBe(403);

      // Turned off, the screen says so.
      await store.enableExtension(STATS, false);
      expect((await call('owner', 'GET', '/api/stats')).data.installed).toEqual({ version: '1.0.0', enabled: false });
    } finally {
      editor.stop();
      await store.close();
    }
  });

  test('an export is told it loses the statistics, while they are on', async () => {
    expect(serverOnly(new Map(), { stats: true })).toEqual(['stats']);
    expect(serverOnly(new Map())).toEqual([]);
    const store = await site('export.db');
    try {
      const files = await publishedSite(store);
      expect((await fullCheck(store, files)).server).toEqual([]);
      await install(store);
      expect((await fullCheck(store, files)).server).toEqual(['stats']);
      await store.enableExtension(STATS, false);
      expect((await fullCheck(store, files)).server).toEqual([]);
    } finally {
      await store.close();
    }
  });
});
