/**
 * Publishing later (ADR 0039): a page or an entry is set for an hour, and the
 * site's clock publishes what its draft holds then, once, whichever process
 * gets there first.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startClock } from '../src/site/clock.ts';
import { startEditor } from '../src/site/server.ts';
import { Store } from '../src/site/store.ts';

const dir = await mkdtemp(join(tmpdir(), 'uhlaka-schedule-'));
afterAll(() => rm(dir, { recursive: true, force: true }));

const NOW = new Date('2026-11-20T10:00:00Z');
const later = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000).toISOString();

describe('publishing later', () => {
  test('is set, moved, refused when it cannot be, and done once by the clock', async () => {
    const store = await Store.open(join(dir, 'site.db'));
    try {
      await store.savePage({ slug: '', title: 'Home', blocks: [] });
      await store.savePage({ slug: 'launch', title: 'Launch', blocks: [] });
      await store.saveEntry('posts', { slug: 'news', title: 'News', blocks: [] });

      for (const [kind, slug, at, error] of [
        ['page', 'launch', 'soon', 'give the date and hour to publish at'],
        ['page', 'launch', later(-1), 'that time has passed; publish it now instead'],
        ['page', 'launch', later(3 * 365 * 24 * 60), 'a publication is set at most two years ahead'],
        ['page', 'nothing', later(5), 'no page "nothing"'],
        ['posts', 'nothing', later(5), 'no entry "nothing"'],
        ['ghosts', 'news', later(5), 'this site has no content type "ghosts"'],
      ] as const) {
        await expect(store.schedule(kind, slug, at, NOW)).rejects.toThrow(error);
      }
      await store.schedule('page', 'launch', later(30), NOW);
      // Set again, it moves.
      await store.schedule('page', 'launch', later(10), NOW);
      await store.schedule('posts', 'news', later(20), NOW);
      expect(await store.scheduled()).toEqual([
        { kind: 'page', slug: 'launch', at: later(10) },
        { kind: 'posts', slug: 'news', at: later(20) },
      ]);

      // What the draft holds then is what is published.
      await store.savePage({ slug: 'launch', title: 'Launch day', blocks: [] });
      const said: string[] = [];
      const clock = startClock(store, { run: false, now: () => new Date(NOW.getTime() + 15 * 60_000), log: (line) => said.push(line) });
      const other = startClock(store, { run: false, now: () => new Date(NOW.getTime() + 15 * 60_000), log: () => {} });
      const [first, second] = await Promise.all([clock.tick(), other.tick()]);
      expect([...first, ...second]).toEqual(['/launch/']);
      expect(said).toEqual(['Published as set: /launch/']);
      expect((await store.published()).find((p) => p.slug === 'launch')?.title).toBe('Launch day');
      expect(await store.publishedEntries('posts')).toHaveLength(0);
      expect(await store.publishDue(new Date(NOW.getTime() + 25 * 60_000))).toEqual([{ kind: 'posts', slug: 'news', at: later(20) }]);
      expect(await store.publishedEntries('posts')).toHaveLength(1);
      clock.stop();
      other.stop();

      // A page that moves keeps its time; one deleted takes it away.
      await store.schedule('page', 'launch', later(60), NOW);
      await store.movePage('launch', 'start');
      expect(await store.scheduled()).toEqual([{ kind: 'page', slug: 'start', at: later(60) }]);
      await store.deletePage('start');
      await store.schedule('posts', 'news', later(60), NOW);
      await store.deleteEntry('posts', 'news');
      expect(await store.scheduled()).toEqual([]);

      // A clock that meets a broken store says so and goes on.
      const broken = startClock({ publishDue: async () => Promise.reject(new Error('locked')) } as unknown as Store, { run: false, log: (line) => said.push(line) });
      expect(await broken.tick()).toEqual([]);
      expect(said.at(-1)).toBe('The clock could not publish: locked');
      const looking = startClock(store, { every: 5, log: () => {} });
      await Bun.sleep(20);
      looking.stop();
    } finally {
      await store.close();
    }
  });

  test('the editor sets and cancels it', async () => {
    const store = await Store.open(join(dir, 'editor.db'));
    const editor = await startEditor(store, { listen: false });
    const call = async (method: string, path: string, body?: unknown) => {
      const response = await editor.fetch(
        new Request(`http://127.0.0.1:4321${path}`, {
          method,
          headers: { host: '127.0.0.1:4321', 'x-uhlaka-token': editor.token, 'content-type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
      );
      return { status: response.status, data: (await response.json()) as Record<string, any> };
    };
    try {
      await store.savePage({ slug: 'launch', title: 'Launch', blocks: [] });
      const at = new Date(Date.now() + 3_600_000).toISOString();
      expect((await call('POST', '/api/schedule', { kind: 'page', slug: 'launch', at })).data.scheduled).toEqual([{ kind: 'page', slug: 'launch', at }]);
      expect((await call('GET', '/api/schedule')).data.scheduled).toHaveLength(1);
      expect((await call('POST', '/api/schedule', { slug: 'launch', at: 'x' })).status).toBe(400);
      expect((await call('DELETE', '/api/schedule?kind=page&slug=launch')).data.scheduled).toEqual([]);
    } finally {
      editor.stop();
      await store.close();
    }
  });
});
