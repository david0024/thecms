/**
 * Backups (ADR 0051): the file, the schedule, the copy sent to S3, putting
 * back, the admin's calls and the command line. The store's part runs on each
 * database given, as in databases.test.ts, and a backup made on one is put
 * back into another.
 */
import { afterAll, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { ownerOnly } from '../src/site/accounts.ts';
import {
  backupHeader,
  backupName,
  backups,
  backupsFolder,
  DEFAULT_BACKUP_SETTINGS,
  isBackupName,
  isDue,
  type LastBackup,
  listBackups,
  normalizeBackupSettings,
  pruneBackups,
  readBackup,
  type Remote,
  s3Remote,
  shownSettings,
  writeBackup,
} from '../src/site/backup.ts';
import { main } from '../src/site/cli.ts';
import { startEditor } from '../src/site/server.ts';
import { Store } from '../src/site/store.ts';
import plain from '../themes/plain.json';

const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='), (c) => c.charCodeAt(0));
const dir = await mkdtemp(join(tmpdir(), 'uhlaka-backup-'));
afterAll(() => rm(dir, { recursive: true, force: true }));

const databases: [string, string][] = [['SQLite', join(dir, 'site.db')]];
if (process.env.UHLAKA_TEST_POSTGRES) databases.push(['Postgres', process.env.UHLAKA_TEST_POSTGRES]);
if (process.env.UHLAKA_TEST_MYSQL) databases.push(['MySQL', process.env.UHLAKA_TEST_MYSQL]);

const TABLES = ['meta', 'pages', 'sections', 'entries', 'media', 'messages', 'users', 'sessions', 'links', 'extensions', 'extension_rows', 'versions', 'media_sizes', 'schedule', 'media_variants', 'page_locks', 'extension_jobs', 'comments', 'message_answers', 'comment_languages', 'visits'];
/** A database emptied, then a small site in it: a page, a picture, an owner signed in, a message. */
async function fresh(address: string): Promise<Store> {
  const old = await Store.open(address);
  for (const table of TABLES) await old.rawForTests(`DROP TABLE IF EXISTS ${table}`);
  await old.close();
  const store = await Store.open(address);
  await store.setSite({ name: 'Atelier ăîșț 🌲', language: 'ro' });
  await store.setTheme(plain);
  await store.publishTheme();
  await store.publish((await store.savePage({ slug: 'despre', title: 'Despre noi', blocks: [] })).slug);
  await store.addMedia(PNG, 'logo.png');
  await store.addMessage({ form: 'contact', page: '/despre/', name: 'Ana', email: 'ana@example.com', body: 'Bună!', consent: 'Da' });
  return store;
}

/** A storage in memory, standing for S3. */
function memoryRemote(): Remote & { files: Map<string, number>; fail: string } {
  const files = new Map<string, number>();
  const remote = {
    files,
    fail: '',
    put: async (name: string, path: string) => {
      if (remote.fail) throw new Error(remote.fail);
      files.set(name, Bun.file(path).size);
    },
    names: async () => [...files.keys(), 'notes.txt'],
    remove: async (name: string) => void files.delete(name),
    test: async () => {
      if (remote.fail) throw new Error(remote.fail);
    },
  };
  return remote;
}

describe('backup settings and the schedule', () => {
  test('settings: anything missing or wrong is the default, and the secret is never shown', () => {
    expect(normalizeBackupSettings(null)).toEqual(DEFAULT_BACKUP_SETTINGS);
    expect(normalizeBackupSettings({ on: false, every: 'week', hour: 27, offset: -120, keep: 0, s3: { bucket: 'b' } })).toEqual({
      on: false,
      every: 'week',
      hour: 23,
      offset: -120,
      keep: 1,
      s3: { endpoint: '', bucket: 'b', region: 'auto', accessKeyId: '', secretAccessKey: '', prefix: 'uhlaka/' },
    });
    expect(normalizeBackupSettings({ on: 'yes', hour: '', keep: 500, s3: { endpoint: 'https://s3.example.com/', bucket: 'b', prefix: '/../site', secretAccessKey: 's' } })).toMatchObject({
      on: false,
      hour: 3,
      keep: 90,
      s3: { endpoint: 'https://s3.example.com', prefix: 'site/' },
    });
    expect(normalizeBackupSettings({ s3: { bucket: '' } }).s3).toBeNull();
    const set = normalizeBackupSettings({ s3: { bucket: 'b', secretAccessKey: 'secret' } });
    expect(shownSettings(set).s3?.secretAccessKey).toBe('***');
    expect(shownSettings(normalizeBackupSettings({ s3: { bucket: 'b' } })).s3?.secretAccessKey).toBe('');
    expect(shownSettings(DEFAULT_BACKUP_SETTINGS)).toEqual(DEFAULT_BACKUP_SETTINGS);
  });

  test('due: never made; once a day after the hour; a failure again after an hour; never when off', () => {
    const daily = normalizeBackupSettings({ hour: 3, offset: -120 }); // 03:00 in Bucharest's winter: 01:00 UTC
    const last = (at: string, ok = true): LastBackup => ({ at, ok, name: '', size: 0, error: '', sent: 'none', sendError: '' });
    const at = (iso: string) => new Date(iso);
    expect(isDue(daily, null, at('2026-11-21T12:00:00Z'))).toBe(true);
    expect(isDue(daily, last('nonsense'), at('2026-11-21T12:00:00Z'))).toBe(true);
    expect(isDue({ ...daily, on: false }, null, at('2026-11-21T12:00:00Z'))).toBe(false);
    // Made at 01:00 UTC today: not again until tomorrow's 01:00.
    expect(isDue(daily, last('2026-11-21T01:00:05Z'), at('2026-11-21T23:59:00Z'))).toBe(false);
    expect(isDue(daily, last('2026-11-21T01:00:05Z'), at('2026-11-22T00:59:00Z'))).toBe(false);
    expect(isDue(daily, last('2026-11-21T01:00:05Z'), at('2026-11-22T01:00:30Z'))).toBe(true);
    // Missed while the site was stopped: made as soon as it runs.
    expect(isDue(daily, last('2026-11-18T01:00:00Z'), at('2026-11-21T15:00:00Z'))).toBe(true);
    // Made by hand at 23:00: tonight's is not made, tomorrow night's is.
    expect(isDue(daily, last('2026-11-20T23:00:00Z'), at('2026-11-21T01:00:30Z'))).toBe(false);
    expect(isDue(daily, last('2026-11-20T23:00:00Z'), at('2026-11-22T01:00:30Z'))).toBe(true);
    // A failure is tried again after an hour.
    expect(isDue(daily, last('2026-11-21T01:00:00Z', false), at('2026-11-21T01:30:00Z'))).toBe(false);
    expect(isDue(daily, last('2026-11-21T01:00:00Z', false), at('2026-11-21T02:00:00Z'))).toBe(true);
    // Once a week.
    const weekly = { ...daily, every: 'week' as const };
    expect(isDue(weekly, last('2026-11-21T01:00:00Z'), at('2026-11-27T01:30:00Z'))).toBe(false);
    expect(isDue(weekly, last('2026-11-21T01:00:00Z'), at('2026-11-28T01:00:30Z'))).toBe(true);
    // An hour that is the day before in UTC: 01:00 in Bucharest is 23:00 UTC.
    expect(isDue(normalizeBackupSettings({ hour: 1, offset: -120 }), last('2026-11-20T23:00:00Z'), at('2026-11-21T22:59:00Z'))).toBe(false);
    expect(isDue(normalizeBackupSettings({ hour: 1, offset: -120 }), last('2026-11-20T23:00:00Z'), at('2026-11-21T23:00:30Z'))).toBe(true);
  });

  test('where backups are kept, and which names are backups', () => {
    expect(backupsFolder('/var/sites/a/site.db', '')).toBe('/var/sites/a/backups');
    expect(backupsFolder('sqlite:///var/sites/b.db', '')).toBe('/var/sites/backups');
    expect(backupsFolder('postgres://u:p@h/db', '')).toBe(resolve('backups'));
    expect(backupsFolder('site.db', '/mnt/kept')).toBe('/mnt/kept');
    expect(backupName('site', new Date('2026-11-21T03:00:07.123Z'))).toBe('site-2026-11-21-030007.uhlaka-backup');
    expect(isBackupName('site-2026-11-21-030007.uhlaka-backup')).toBe(true);
    for (const name of ['../site.uhlaka-backup', 'site.db', 'a/b.uhlaka-backup', 'Site.uhlaka-backup', '.uhlaka-backup']) expect(isBackupName(name)).toBe(false);
  });

  test('only the owner calls /api/backups, whatever the method', () => {
    for (const method of ['GET', 'PUT', 'POST', 'DELETE']) {
      expect(ownerOnly(method, '/api/backups')).toBe(true);
      expect(ownerOnly(method, '/api/backups/file')).toBe(true);
    }
  });
});

for (const [name, address] of databases) {
  describe(`a backup on ${name}`, () => {
    let store: Store;
    let folder: string;
    beforeEach(async () => {
      store = await fresh(address);
      folder = await mkdtemp(join(dir, 'kept-'));
    });

    test('holds the whole site, and putting it back undoes what came after', async () => {
      const owner = await store.addUser({ email: 'owner@example.com', name: 'Owner', role: 'owner', password: 'a long password' });
      const session = await store.startSession(owner.id);
      await store.setBackupSettings({ keep: 3 });
      await store.setValkeyAddress('redis://127.0.0.1:6379');
      const file = await writeBackup(store, folder, 'site', new Date('2026-11-21T03:00:00Z'));
      expect(file.name).toBe('site-2026-11-21-030000.uhlaka-backup');
      expect(file.size).toBeGreaterThan(0);
      expect(readdirSync(folder)).toEqual([file.name]);
      // One more within the same second is kept beside it.
      const twin = await writeBackup(store, folder, 'site', new Date('2026-11-21T03:00:00Z'));
      expect(twin.name).toBe('site-2026-11-21-030000-2.uhlaka-backup');
      pruneBackups(folder, 1, file.name);
      expect(await backupHeader(join(folder, file.name))).toEqual({ format: 'uhlaka.backup/1', version: expect.any(String), at: '2026-11-21T03:00:00.000Z', database: store.kind });
      // What the server keeps for itself is not in the file; the site's sessions are not either.
      const tables = new Set<string>();
      for await (const { table, row } of readBackup(join(folder, file.name))) {
        tables.add(table);
        if (table === 'meta') expect(['backups', 'valkey']).not.toContain(row.key);
      }
      expect(tables.has('sessions')).toBe(false);
      expect(tables.has('media')).toBe(true);

      // Afterwards: a page deleted, a picture gone, a name changed, someone else added and signed in.
      await store.deletePage('despre');
      await store.deleteMedia((await store.media())[0]?.name ?? '');
      await store.setSite({ name: 'Altceva', language: 'ro' });
      const other = await store.addUser({ email: 'later@example.com', name: 'Later', role: 'editor', password: 'a long password' });
      const otherSession = await store.startSession(other.id);
      await store.setBackupSettings({ keep: 5 });
      const version = await store.siteVersion();

      expect(await store.restoreRows(readBackup(join(folder, file.name)))).toBeGreaterThan(5);
      expect((await store.site()).name).toBe('Atelier ăîșț 🌲');
      expect((await store.draft('despre'))?.title).toBe('Despre noi');
      const media = await store.media();
      expect(media).toHaveLength(1);
      expect(await store.mediaFile(media[0]?.name ?? '')).toMatchObject({ bytes: PNG });
      expect((await store.messages())[0]?.body).toBe('Bună!');
      // The owner is still signed in; the one added later is gone, and so is their session.
      expect((await store.sessionUser(session))?.email).toBe('owner@example.com');
      expect(await store.sessionUser(otherSession)).toBeNull();
      expect((await store.users()).map((u) => u.email)).toEqual(['owner@example.com']);
      // The server's own settings stay as they are now; visitors are told the site changed.
      expect(await store.backupSettings()).toMatchObject({ keep: 5 });
      expect(await store.valkeyAddress()).toBe('redis://127.0.0.1:6379');
      expect(await store.siteVersion()).not.toBe(version);
      await store.close();
    });

    test('a file that is not a backup, or is damaged, changes nothing', async () => {
      const bad = join(folder, 'bad.uhlaka-backup');
      writeFileSync(bad, 'not gzip at all');
      await expect(backupHeader(bad)).rejects.toThrow('this file is not a Uhlaka backup');
      writeFileSync(bad, gzipSync('{"format":"something else"}\n'));
      await expect(backupHeader(bad)).rejects.toThrow('this file is not a Uhlaka backup');
      writeFileSync(bad, gzipSync('not json\n'));
      await expect(backupHeader(bad)).rejects.toThrow('this file is not a Uhlaka backup');
      writeFileSync(bad, gzipSync(''));
      await expect(backupHeader(bad)).rejects.toThrow('this file is not a Uhlaka backup');
      const head = '{"format":"uhlaka.backup/1"}\n';
      const cases: [string, string][] = [
        [`${head}\n{"t":"pages"}\n`, 'the backup is damaged'],
        [`${head}not json\n`, 'the backup is damaged'],
        [`${head}{"t":"secrets","r":{}}\n`, 'a table this program does not know: secrets'],
        [`${head}{"t":"sessions","r":{}}\n`, 'a table this program does not know: sessions'],
        [`${head}{"t":"pages","r":{"slug":"x","evil":1}}\n`, 'a column this program does not know: pages.evil'],
      ];
      for (const [text, error] of cases) {
        writeFileSync(bad, gzipSync(text));
        await expect(store.restoreRows(readBackup(bad))).rejects.toThrow(error);
        expect((await store.site()).name).toBe('Atelier ăîșț 🌲');
        expect((await store.draft('despre'))?.title).toBe('Despre noi');
      }
      // A meta row the server keeps for itself is skipped, not taken from a file.
      writeFileSync(bad, gzipSync(`${head}{"t":"meta","r":{"key":"valkey","value":"\\"redis://elsewhere\\""}}\n`));
      await store.restoreRows(readBackup(bad));
      expect(await store.valkeyAddress()).toBe('');
      await expect(backupHeader(join(folder, 'missing.uhlaka-backup'))).rejects.toThrow();
      await store.close();
    });

    test('made, kept, sent, and put back by the site', async () => {
      const remote = memoryRemote();
      const said: string[] = [];
      const kept = backups(store, { dir: folder, remote: () => remote, log: (line) => said.push(line) });
      await store.setBackupSettings({ keep: 2, s3: { bucket: 'b', secretAccessKey: 's' } });
      const first = await kept.make('site', new Date('2026-11-19T01:00:00Z'));
      expect(first).toMatchObject({ ok: true, sent: 'yes', name: 'site-2026-11-19-010000.uhlaka-backup' });
      await kept.make('site', new Date('2026-11-20T01:00:00Z'));
      await kept.make('site', new Date('2026-11-21T01:00:00Z'));
      // Two are kept, here and there; a file there the site did not make stays.
      expect(listBackups(folder)).toHaveLength(2);
      expect([...remote.files.keys()].sort()).toEqual(['site-2026-11-20-010000.uhlaka-backup', 'site-2026-11-21-010000.uhlaka-backup']);
      // A copy that cannot be sent is said; the backup is kept.
      remote.fail = 'Access Denied';
      const unsent = await kept.make('site', new Date('2026-11-21T02:00:00Z'));
      expect(unsent).toMatchObject({ ok: true, sent: 'failed', sendError: 'Access Denied' });
      expect(said.at(-1)).toContain('not sent to S3: Access Denied');
      expect(await kept.last()).toEqual(unsent);
      remote.fail = '';

      // The clock: not due right after one, due tomorrow, and taken by one process only.
      expect(await kept.tick(new Date('2026-11-21T03:00:00Z'))).toBeNull();
      const claimed: string[] = [];
      const other = backups(store, { dir: folder, remote: () => remote, claim: async (key) => (claimed.push(key), false) });
      expect(await other.tick(new Date('2026-11-23T05:00:00Z'))).toBeNull();
      expect(claimed).toHaveLength(1);
      expect((await kept.tick(new Date('2026-11-23T05:00:00Z')))?.ok).toBe(true);

      // Two asked at once make one.
      const [a, b] = await Promise.all([kept.make('site', new Date('2026-11-24T05:00:00Z')), kept.make('site', new Date('2026-11-24T05:00:01Z'))]);
      expect(a).toEqual(b);

      // Put back: the oldest one, which is kept although a backup is made first.
      const oldest = listBackups(folder).at(-1)?.name ?? '';
      await store.setSite({ name: 'Changed', language: 'ro' });
      expect(await kept.restore(oldest, new Date('2026-11-24T06:00:00Z'))).toBeGreaterThan(0);
      expect((await store.site()).name).toBe('Atelier ăîșț 🌲');
      expect(listBackups(folder).map((f) => f.name)).toContain(oldest);
      expect(listBackups(folder).map((f) => f.name)).toContain('before-restore-2026-11-24-060000.uhlaka-backup');
      expect(said.at(-1)).toMatch(/^Put back .* what was there before is in before-restore-/);
      await expect(kept.restore('nothing.uhlaka-backup')).rejects.toThrow('there is no such backup');
      await expect(kept.restore('../site.db')).rejects.toThrow('there is no such backup');
      await store.close();
    });

    test('a backup that cannot be made is said, and nothing is put back without one', async () => {
      const said: string[] = [];
      const good = await writeBackup(store, folder, 'site', new Date('2026-11-21T01:00:00Z'));
      // A folder that is a file cannot be written into.
      const blocked = join(folder, 'blocked');
      writeFileSync(blocked, '');
      const kept = backups(store, { dir: blocked, log: (line) => said.push(line) });
      const failed = await kept.make();
      expect(failed.ok).toBe(false);
      expect(failed.error).not.toBe('');
      expect(said[0]).toStartWith('The backup could not be made: ');
      // Its last is failed: due again in an hour.
      expect(await kept.tick(new Date(Date.parse(failed.at) + 10 * 60_000))).toBeNull();
      const there = backups(store, { dir: folder, log: () => {} });
      await store.setLastBackup({ ...failed });
      // The one asked for is in the folder, but the backup before it fails: nothing is put back.
      const broken = spyOn(store, 'backupRows').mockImplementation(async function* () {
        throw new Error('the disk is full');
      });
      await store.setSite({ name: 'Kept as it is', language: 'ro' });
      await expect(there.restore(good.name)).rejects.toThrow('nothing was put back: the backup of what is there now failed (the disk is full)');
      broken.mockRestore();
      expect((await store.site()).name).toBe('Kept as it is');
      expect(readdirSync(folder).filter((n) => n.endsWith('.part'))).toEqual([]);
      pruneBackups(folder, 1);
      expect(listBackups(folder)).toHaveLength(1);
      expect(listBackups(join(folder, 'none'))).toEqual([]);
      await store.close();
    });
  });
}

const [, postgres] = databases.find(([n]) => n === 'Postgres') ?? [];
test.skipIf(!postgres)('a backup made on SQLite is put back into Postgres (ADR 0051 d1)', async () => {
  const lite = await fresh(join(dir, 'moving.db'));
  const folder = await mkdtemp(join(dir, 'moving-'));
  const file = await writeBackup(lite, folder, 'site', new Date());
  await lite.close();
  const pg = await fresh(postgres as string);
  await pg.setSite({ name: 'Empty', language: 'en' });
  await pg.restoreRows(readBackup(join(folder, file.name)));
  expect((await pg.site()).name).toBe('Atelier ăîșț 🌲');
  const media = await pg.media();
  expect(await pg.mediaFile(media[0]?.name ?? '')).toMatchObject({ bytes: PNG });
  await pg.close();
});

describe('a copy in S3', () => {
  test('is written, listed, kept to the number and tested through Bun\'s client', async () => {
    const objects = new Map<string, Uint8Array>();
    const seen: string[] = [];
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        seen.push(`${request.method} ${url.pathname}`);
        const key = decodeURIComponent(url.pathname.replace(/^\/bucket\//, ''));
        if (request.method === 'PUT') {
          objects.set(key, new Uint8Array(await request.arrayBuffer()));
          return new Response('', { headers: { etag: '"x"' } });
        }
        if (request.method === 'DELETE') {
          objects.delete(key);
          return new Response(null, { status: 204 });
        }
        const prefix = url.searchParams.get('prefix') ?? '';
        const keys = [...objects.keys()].filter((k) => k.startsWith(prefix));
        return new Response(
          `<?xml version="1.0"?><ListBucketResult><Name>bucket</Name><Prefix>${prefix}</Prefix><KeyCount>${keys.length}</KeyCount><IsTruncated>false</IsTruncated>${keys.map((k) => `<Contents><Key>${k}</Key><Size>1</Size></Contents>`).join('')}</ListBucketResult>`,
          { headers: { 'content-type': 'application/xml' } },
        );
      },
    });
    try {
      const settings = normalizeBackupSettings({ s3: { endpoint: `http://127.0.0.1:${server.port}`, bucket: 'bucket', accessKeyId: 'k', secretAccessKey: 's', prefix: 'mine' } });
      const remote = s3Remote(settings.s3 as NonNullable<typeof settings.s3>);
      const file = join(dir, 'one.uhlaka-backup');
      writeFileSync(file, 'bytes');
      await remote.put('site-2026-11-21-010000.uhlaka-backup', file);
      expect(objects.has('mine/site-2026-11-21-010000.uhlaka-backup')).toBe(true);
      objects.set('mine/notes.txt', new Uint8Array());
      expect(await remote.names()).toEqual(['site-2026-11-21-010000.uhlaka-backup']);
      await remote.remove('site-2026-11-21-010000.uhlaka-backup');
      expect(await remote.names()).toEqual([]);
      await remote.test();
      expect(seen).toContain('PUT /bucket/mine/uhlaka-test.txt');
      expect(objects.has('mine/uhlaka-test.txt')).toBe(false);
    } finally {
      server.stop(true);
    }
  });
});

describe('the admin\'s calls', () => {
  test('list, settings, now, test, download, delete, put back and upload', async () => {
    const store = await fresh(join(dir, 'admin.db'));
    const folder = await mkdtemp(join(dir, 'admin-'));
    const remote = memoryRemote();
    const editor = await startEditor(store, { listen: false, backups: folder, backupRemote: () => remote, log: () => {} });
    const call = async (path: string, init: { method?: string; body?: unknown; raw?: Uint8Array; headers?: Record<string, string> } = {}) =>
      editor.fetch(
        new Request(`http://127.0.0.1:4321${path}`, {
          method: init.method ?? 'GET',
          headers: { host: '127.0.0.1:4321', 'x-uhlaka-token': editor.token, ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers },
          body: init.raw ? new Blob([init.raw as Uint8Array<ArrayBuffer>]) : init.body ? JSON.stringify(init.body) : undefined,
        }),
      );
    try {
      let shown = (await (await call('/api/backups')).json()) as { settings: { s3: unknown; keep: number }; last: LastBackup | null; files: { name: string }[]; folder: string };
      expect(shown).toMatchObject({ last: null, files: [], folder, settings: { keep: 7, s3: null } });
      // The state says nothing failed yet.
      expect(((await (await call('/api/state')).json()) as { backupFailed: boolean }).backupFailed).toBe(false);

      shown = await (await call('/api/backups', { method: 'PUT', body: { settings: { keep: 4, s3: { bucket: 'b', accessKeyId: 'k', secretAccessKey: 'real secret' } } } })).json();
      expect(shown.settings).toMatchObject({ keep: 4, s3: { bucket: 'b', secretAccessKey: '***' } });
      // Saved again as shown: the secret kept is the real one.
      await call('/api/backups', { method: 'PUT', body: { settings: shown.settings } });
      expect(await store.backupSettings()).toMatchObject({ s3: { secretAccessKey: 'real secret' } });

      expect(await (await call('/api/backups/test', { method: 'POST', body: { settings: shown.settings } })).json()).toEqual({ test: { ok: true, error: '' } });
      remote.fail = 'No such bucket';
      expect(await (await call('/api/backups/test', { method: 'POST', body: { settings: shown.settings } })).json()).toEqual({ test: { ok: false, error: 'No such bucket' } });
      expect(await (await call('/api/backups/test', { method: 'POST', body: { settings: {} } })).json()).toEqual({ test: { ok: false, error: 'give the bucket first' } });
      remote.fail = '';

      shown = await (await call('/api/backups', { method: 'POST' })).json();
      expect(shown.last).toMatchObject({ ok: true, sent: 'yes' });
      const name = shown.files[0]?.name ?? '';
      const download = await call(`/api/backups/file?name=${name}`);
      expect(download.headers.get('content-disposition')).toBe(`attachment; filename="${name}"`);
      const bytes = new Uint8Array(await download.arrayBuffer());
      expect(bytes.length).toBeGreaterThan(0);
      expect((await call('/api/backups/file?name=../admin.db')).status).toBe(404);

      // Put back from the folder.
      await store.setSite({ name: 'Changed', language: 'ro' });
      const restored = (await (await call(`/api/backups/restore?name=${name}`, { method: 'POST' })).json()) as { restored: number };
      expect(restored.restored).toBeGreaterThan(0);
      expect((await store.site()).name).toBe('Atelier ăîșț 🌲');

      // Uploaded from elsewhere, then put back; a file that is not a backup is refused and not kept.
      await store.setSite({ name: 'Changed again', language: 'ro' });
      const uploaded = (await (await call('/api/backups/upload', { method: 'POST', raw: bytes })).json()) as { restored: number; files: { name: string }[] };
      expect(uploaded.restored).toBeGreaterThan(0);
      expect(uploaded.files.some((f) => f.name.startsWith('uploaded-'))).toBe(true);
      expect((await store.site()).name).toBe('Atelier ăîșț 🌲');
      const refused = await call('/api/backups/upload', { method: 'POST', raw: new TextEncoder().encode('hello') });
      expect(refused.status).toBe(400);
      expect(((await refused.json()) as { error: string }).error).toBe('this file is not a Uhlaka backup');
      expect(readdirSync(folder).some((n) => n.endsWith('.part'))).toBe(false);
      expect((await call('/api/backups/upload', { method: 'POST', raw: new Uint8Array(1), headers: { 'content-length': String(65 * 1024 * 1024) } })).status).toBe(413);

      // Deleted.
      const before = listBackups(folder).length;
      shown = await (await call(`/api/backups/file?name=${name}`, { method: 'DELETE' })).json();
      expect(shown.files).toHaveLength(before - 1);
      expect(existsSync(join(folder, name))).toBe(false);
      expect((await call('/api/backups/nothing', { method: 'POST' })).status).toBe(404);

      // A failed backup is said at the top of the admin.
      await store.setLastBackup({ ...shown.last, ok: false, error: 'the disk is full' });
      expect(((await (await call('/api/state')).json()) as { backupFailed: boolean }).backupFailed).toBe(true);
    } finally {
      editor.stop();
      await store.close();
    }
  });

  test('an editor that keeps no backups says so', async () => {
    const store = await fresh(join(dir, 'none.db'));
    const editor = await startEditor(store, { listen: false });
    try {
      const response = await editor.fetch(new Request('http://127.0.0.1:4321/api/backups', { headers: { host: '127.0.0.1:4321', 'x-uhlaka-token': editor.token } }));
      expect(response.status).toBe(404);
    } finally {
      editor.stop();
      await store.close();
    }
  });
});

describe('the command line', () => {
  test('backup and restore', async () => {
    const said: string[] = [];
    const log = spyOn(console, 'log').mockImplementation((...words: unknown[]) => void said.push(words.join(' ')));
    try {
      const db = join(dir, 'cli', 'site.db');
      mkdirSync(join(dir, 'cli'));
      await main(['init', db]);
      await main(['backup', db]);
      expect(said.at(-1)).toMatch(/^Backed up .*site\.db to .*\/cli\/backups\/site-.*\.uhlaka-backup \(\d+ KB\)\.$/);
      const elsewhere = join(dir, 'cli-elsewhere');
      await main(['backup', db, elsewhere]);
      const file = join(elsewhere, readdirSync(elsewhere)[0] as string);
      const store = await Store.open(db);
      await store.setSite({ name: 'Changed', language: 'en' });
      await store.close();
      await main(['restore', db, file]);
      expect(said.at(-1)).toMatch(/^Put back \d+ rows into /);
      const back = await Store.open(db);
      expect((await back.site()).name).not.toBe('Changed');
      await back.close();
      // A file already in the folder is put back from there.
      const inFolder = listBackups(join(dir, 'cli', 'backups')).find((f) => f.name.startsWith('site-'))?.name ?? '';
      await main(['restore', db, join(dir, 'cli', 'backups', inFolder)]);
      expect(said.at(-1)).toMatch(/^Put back /);
      await expect(main(['restore', db])).rejects.toThrow('give the backup file');
      await expect(main(['restore', db, join(dir, 'nothing')])).rejects.toThrow('does not exist');
      await expect(main(['backup', join(dir, 'missing.db')])).rejects.toThrow('does not exist');
      // A backup that fails says why.
      const blocked = join(dir, 'blocked-file');
      writeFileSync(blocked, '');
      await expect(main(['backup', db, blocked])).rejects.toThrow('the backup could not be made: ');
    } finally {
      log.mockRestore();
    }
  });
});
