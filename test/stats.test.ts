/**
 * Statistics without a cookie (ADR 0053): a page counted by the server as it
 * is sent, a visitor told apart by a fingerprint under a key of the day, only
 * the day's totals kept, and what the Statistics screen is shown.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serverOnly } from '../src/site/check.ts';
import { fullCheck, publishedSite } from '../src/site/export.ts';
import { FRESH_MS, startRuntime } from '../src/site/runtime.ts';
import { startEditor } from '../src/site/server.ts';
import { localShared } from '../src/site/shared.ts';
import { counted, dayIn, daysOf, deviceOf, isZone, sourceOf, statsShown, summarize, visits } from '../src/site/stats.ts';
import { Store, type VisitRow } from '../src/site/store.ts';
import plain from '../themes/plain.json';

const dir = await mkdtemp(join(tmpdir(), 'thecms-stats-'));
afterAll(() => rm(dir, { recursive: true, force: true }));

const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPAD = 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const ANDROID_TABLET = 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const GOOGLEBOT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

const visit = (path: string, headers: Record<string, string> = {}, method = 'GET'): Request =>
  new Request(`https://site.example${path}`, { method, headers: { 'user-agent': CHROME, ...headers } });

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
    expect(daysOf('7', 'UTC', late)).toEqual(['2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21']);
    expect(daysOf('today', 'Europe/Bucharest', late)).toEqual(['2026-11-22']);
  });
});

describe('the totals', () => {
  test('a range is summed, its chart is by day, or by month for 12 months, and its lists are the most first', () => {
    const rows: VisitRow[] = [
      { day: '2026-11-20', kind: 'visitors', name: '', hits: 3 },
      { day: '2026-11-20', kind: 'views', name: '', hits: 7 },
      { day: '2026-11-21', kind: 'visitors', name: '', hits: 2 },
      { day: '2026-11-21', kind: 'views', name: '', hits: 2 },
      { day: '2026-11-20', kind: 'page', name: '/', hits: 5 },
      { day: '2026-11-21', kind: 'page', name: '/about/', hits: 2 },
      { day: '2026-11-20', kind: 'page', name: '/about/', hits: 2 },
      { day: '2026-11-20', kind: 'source', name: 'Google', hits: 2 },
      { day: '2026-11-20', kind: 'device', name: 'phone', hits: 3 },
      { day: '2026-11-21', kind: 'search', name: 'oak', hits: 1 },
      { day: '2025-01-01', kind: 'views', name: '', hits: 99 },
    ];
    const week = summarize(rows, '7', 'UTC', daysOf('7', 'UTC', Date.parse('2026-11-21T10:00:00Z')));
    expect([week.visitors, week.views]).toEqual([5, 9]);
    expect(week.chart).toHaveLength(7);
    expect(week.chart.at(-1)).toEqual({ at: '2026-11-21', visitors: 2, views: 2 });
    expect(week.pages).toEqual([
      { name: '/', hits: 5 },
      { name: '/about/', hits: 4 },
    ]);
    expect(week.sources).toEqual([{ name: 'Google', hits: 2 }]);
    expect(week.devices).toEqual([{ name: 'phone', hits: 3 }]);
    expect(week.searches).toEqual([{ name: 'oak', hits: 1 }]);
    const year = summarize(rows, '365', 'UTC', daysOf('365', 'UTC', Date.parse('2026-11-21T10:00:00Z')));
    expect(year.chart.at(-1)).toEqual({ at: '2026-11', visitors: 5, views: 9 });
    expect(year.chart.length).toBeGreaterThanOrEqual(12);
    expect(year.views).toBe(9);
  });

  const databases: [string, string][] = [['SQLite', join(dir, 'totals.db')]];
  if (process.env.THECMS_TEST_POSTGRES) databases.push(['Postgres', process.env.THECMS_TEST_POSTGRES]);
  if (process.env.THECMS_TEST_MYSQL) databases.push(['MySQL', process.env.THECMS_TEST_MYSQL]);
  for (const [name, address] of databases) {
    test(`totals are added to, never replaced, in ${name}`, async () => {
      const store = await Store.open(address);
      try {
        await store.rawForTests('DELETE FROM visits');
        expect(await store.hasVisits()).toBe(false);
        await store.addVisits([
          { day: '2026-11-21', kind: 'views', name: '', hits: 2 },
          { day: '2026-11-21', kind: 'page', name: '/ă/', hits: 1 },
        ]);
        await store.addVisits([{ day: '2026-11-21', kind: 'views', name: '', hits: 3 }]);
        const rows = await store.visits('2026-11-21', '2026-11-21');
        expect(rows.sort((a, b) => a.kind.localeCompare(b.kind))).toEqual([
          { day: '2026-11-21', kind: 'page', name: '/ă/', hits: 1 },
          { day: '2026-11-21', kind: 'views', name: '', hits: 5 },
        ]);
        expect(await store.visits('2026-11-22', '2026-11-30')).toEqual([]);
        expect(await store.hasVisits()).toBe(true);
        expect(await store.statsZone()).toBe('UTC');
      } finally {
        await store.rawForTests('DELETE FROM visits');
        await store.close();
      }
    });
  }
});

describe('counted as the site is served', () => {
  test('pages, visitors, sources, devices and searches; robots, people signed in and missing pages are not', async () => {
    const store = await Store.open(join(dir, 'site.db'));
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

      const day = await statsShown(store, 'today', { now: clock });
      expect([day.visitors, day.views]).toEqual([3, 4]);
      expect(day.pages).toEqual([
        { name: '/', hits: 2 },
        { name: '/about/', hits: 2 },
      ]);
      expect(day.sources).toEqual([
        { name: '', hits: 2 },
        { name: 'Google', hits: 1 },
      ]);
      expect(day.devices).toEqual([
        { name: 'computer', hits: 2 },
        { name: 'phone', hits: 1 },
      ]);
      expect(day.searches).toEqual([{ name: 'oak table', hits: 1 }]);

      // The next day: the same person is a new visitor, and yesterday's key is gone.
      expect(await shared.get('visits:key:2026-11-21')).not.toBeNull();
      clock += 86_400_000;
      await get('/');
      await runtime.visits.flush();
      expect(await shared.get('visits:key:2026-11-21')).toBeNull();
      const two = await statsShown(store, '7', { now: clock });
      expect([two.visitors, two.views]).toEqual([4, 5]);

      // Nothing kept names a visitor: only totals.
      const kinds = (await store.visits('2026-11-01', '2026-11-30')).map((r) => r.name);
      expect(kinds.some((n) => n.includes('10.0.0'))).toBe(false);
    } finally {
      runtime.stop();
      await store.close();
    }
  });

  test('a page behind a password is counted once it is opened', async () => {
    const store = await Store.open(join(dir, 'locked.db'));
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
      expect((await statsShown(store, 'today', { now: clock })).pages).toEqual([{ name: '/secret/', hits: 1 }]);
    } finally {
      runtime.stop();
      await store.close();
    }
  });

  test('what cannot be written is said, and counting goes on', async () => {
    const lines: string[] = [];
    const broken = { statsZone: async () => 'UTC', addVisits: async () => Promise.reject(new Error('the database is away')) } as unknown as Store;
    const counter = visits(broken, localShared(), { log: (line) => lines.push(line), flushMs: 60_000 });
    await counter.seen(visit('/'), '10.0.0.1', '/');
    await counter.stop();
    expect(lines).toEqual(['The statistics could not be written: the database is away']);
  });

  test('written by itself, a little after', async () => {
    const store = await Store.open(join(dir, 'timer.db'));
    const counter = visits(store, localShared(), { flushMs: 20 });
    try {
      await counter.seen(visit('/'), '10.0.0.1', '/');
      await Bun.sleep(80);
      expect(await store.hasVisits()).toBe(true);
    } finally {
      await counter.stop();
      await store.close();
    }
  });
});

describe('what the admin is shown', () => {
  test('the owner\'s time zone becomes the statistics\' own; an editor\'s does not', async () => {
    const store = await Store.open(join(dir, 'zone.db'));
    try {
      expect((await statsShown(store, '30', { zone: 'Europe/Bucharest', owner: false })).zone).toBe('UTC');
      expect((await statsShown(store, '30', { zone: 'Not/AZone', owner: true })).zone).toBe('UTC');
      const shown = await statsShown(store, '30', { zone: 'Europe/Bucharest', owner: true });
      expect(shown.zone).toBe('Europe/Bucharest');
      expect(shown.chart).toHaveLength(30);
      expect(await store.statsZone()).toBe('Europe/Bucharest');
    } finally {
      await store.close();
    }
  });

  test('/api/stats answers a range, and a range it does not know is 30 days', async () => {
    const store = await Store.open(join(dir, 'api.db'));
    const editor = await startEditor(store, { listen: false });
    const call = (query: string) =>
      editor.fetch(new Request(`http://127.0.0.1:4321/api/stats${query}`, { headers: { host: '127.0.0.1:4321', 'x-thecms-token': editor.token } }));
    try {
      const week = (await (await call('?range=7&zone=Europe%2FBucharest')).json()) as { range: string; zone: string; chart: unknown[] };
      expect([week.range, week.zone, week.chart.length]).toEqual(['7', 'Europe/Bucharest', 7]);
      const other = (await (await call('?range=nine')).json()) as { range: string };
      expect(other.range).toBe('30');
    } finally {
      editor.stop();
      await store.close();
    }
  });

  test('an export is told it loses the statistics, once the site has some', async () => {
    expect(serverOnly(new Map(), { stats: true })).toEqual(['stats']);
    expect(serverOnly(new Map())).toEqual([]);
    const store = await Store.open(join(dir, 'export.db'));
    try {
      await store.setTheme(plain);
      await store.publishTheme();
      await store.savePage({ slug: '', title: 'Home', blocks: [] });
      await store.publish('');
      const files = await publishedSite(store);
      expect((await fullCheck(store, files)).server).toEqual([]);
      await store.addVisits([{ day: '2026-11-21', kind: 'views', name: '', hits: 1 }]);
      expect((await fullCheck(store, files)).server).toEqual(['stats']);
    } finally {
      await store.close();
    }
  });
});
