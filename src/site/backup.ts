/**
 * Backups (ADR 0051): the whole site in one file, made on a schedule by the
 * editor's clock or at once, kept on the server, sent to an S3 storage when
 * one is given, and put back after a backup of what is there now.
 *
 * The file is gzip; inside, one line saying what it is, then one line per row
 * of each table, the same for the three databases (ADR 0013), so a backup
 * made on SQLite goes back into Postgres or MySQL.
 */
import { once } from 'node:events';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { createGunzip, createGzip } from 'node:zlib';
import { fromOldName } from '../core/index.ts';
import { IMPORT_MAX_BYTES } from '../import/run.ts';
import { databaseKind, type Store } from './store.ts';
import { VERSION } from './version.ts';

export const BACKUP_FORMAT = 'uhlaka.backup/1';
export const BACKUP_SUFFIX = '.uhlaka-backup';
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
export const KEEP_MIN = 1;
export const KEEP_MAX = 90;
/** What a secret is shown as: given back unchanged, it means "keep the one saved". */
export const HIDDEN = '***';

/** An S3 storage, where a copy of each backup is sent (ADR 0051 d4). */
export interface S3Settings {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** The folder inside the bucket, ending in `/`. */
  prefix: string;
}

export interface BackupSettings {
  on: boolean;
  every: 'day' | 'week';
  /** The hour chosen, in the owner's own time, and that time's distance from UTC in minutes (as `Date.getTimezoneOffset` says it). */
  hour: number;
  offset: number;
  keep: number;
  s3: S3Settings | null;
}

/** How the last backup went (ADR 0051 d6). */
export interface LastBackup {
  at: string;
  ok: boolean;
  name: string;
  size: number;
  error: string;
  /** Whether the copy reached the S3 storage: `none` when there is none. */
  sent: 'yes' | 'failed' | 'none';
  sendError: string;
}

export interface BackupFile {
  name: string;
  size: number;
  at: string;
}

export const DEFAULT_BACKUP_SETTINGS: BackupSettings = { on: true, every: 'day', hour: 3, offset: 0, keep: 7, s3: null };

const text = (value: unknown, max = 500): string => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const whole = (value: unknown, min: number, max: number, fallback: number): number => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && typeof value !== 'boolean' && value !== null && value !== '' ? Math.min(max, Math.max(min, n)) : fallback;
};

/** Settings as they are kept: anything missing or wrong is the default. */
export function normalizeBackupSettings(input: unknown): BackupSettings {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const d = DEFAULT_BACKUP_SETTINGS;
  const s3raw = (raw.s3 && typeof raw.s3 === 'object' ? raw.s3 : null) as Record<string, unknown> | null;
  let s3: S3Settings | null = null;
  if (s3raw && text(s3raw.bucket)) {
    const prefix = text(s3raw.prefix, 200).replace(/\.\.+/g, '').replace(/\/+/g, '/').replace(/^\//, '');
    s3 = {
      endpoint: text(s3raw.endpoint).replace(/\/+$/, ''),
      bucket: text(s3raw.bucket, 63),
      region: text(s3raw.region, 40) || 'auto',
      accessKeyId: text(s3raw.accessKeyId, 200),
      secretAccessKey: text(s3raw.secretAccessKey, 200),
      prefix: prefix === '' ? 'uhlaka/' : prefix.endsWith('/') ? prefix : `${prefix}/`,
    };
  }
  return {
    on: raw.on === undefined ? d.on : raw.on === true,
    every: raw.every === 'week' ? 'week' : 'day',
    hour: whole(raw.hour, 0, 23, d.hour),
    offset: whole(raw.offset, -14 * 60, 14 * 60, d.offset),
    keep: whole(raw.keep, KEEP_MIN, KEEP_MAX, d.keep),
    s3,
  };
}

/** The settings as the admin is shown them: the secret left out. */
export const shownSettings = (settings: BackupSettings): BackupSettings =>
  settings.s3 ? { ...settings, s3: { ...settings.s3, secretAccessKey: settings.s3.secretAccessKey ? HIDDEN : '' } } : settings;

/** Where backups are kept (ADR 0051 d3): UHLAKA_BACKUPS, or `backups` beside a site that is a file, or in the folder the program runs in. */
export function backupsFolder(site: string, given = process.env.UHLAKA_BACKUPS ?? ''): string {
  if (given) return resolve(given);
  if (databaseKind(site) === 'sqlite') return join(dirname(resolve(site.replace(/^sqlite:\/\//i, ''))), 'backups');
  return resolve('backups');
}

/** The most recent time a scheduled backup was meant for, at or before now. */
function slotBefore(settings: BackupSettings, now: Date): number {
  const minute = (((settings.hour * 60 + settings.offset) % 1440) + 1440) % 1440;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + minute * 60_000;
  return today > now.getTime() ? today - DAY : today;
}

/**
 * Whether a backup is due (ADR 0051 d2): none was ever made; or the last one
 * is older than the last time one was meant for, and a day (or a week) has
 * nearly passed since it. A failed one is tried again after an hour.
 */
export function isDue(settings: BackupSettings, last: LastBackup | null, now: Date): boolean {
  if (!settings.on) return false;
  if (!last) return true;
  const at = Date.parse(last.at);
  if (!Number.isFinite(at)) return true;
  const since = now.getTime() - at;
  if (!last.ok) return since >= HOUR;
  return at < slotBefore(settings, now) && since >= (settings.every === 'week' ? 7 * DAY : DAY) - HOUR;
}

/** A backup's name: what it is, and when it was made, in UTC. */
export const backupName = (kind: string, now: Date): string => `${kind}-${now.toISOString().slice(0, 19).replace('T', '-').replace(/:/g, '')}${BACKUP_SUFFIX}`;

/** A name the admin may ask for: a backup's, in the folder, never a path. One made before the rename (ADR 0066) ends in .thecms-backup. */
export const isBackupName = (name: string): boolean => /^[a-z][a-z0-9-]{0,80}\.(uhlaka|thecms)-backup$/.test(name);

const asLine = (table: string, row: Record<string, unknown>): string =>
  `${JSON.stringify({ t: table, r: Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v instanceof Uint8Array ? { $b64: Buffer.from(v).toString('base64') } : v])) })}\n`;

/** Writes the whole site into a new file in the folder. The file appears only once it is whole. */
export async function writeBackup(store: Store, dir: string, kind: string, now: Date): Promise<BackupFile> {
  mkdirSync(dir, { recursive: true });
  // Two made within the same second are both kept.
  let name = backupName(kind, now);
  for (let n = 2; existsSync(join(dir, name)); n++) name = backupName(kind, now).replace(BACKUP_SUFFIX, `-${n}${BACKUP_SUFFIX}`);
  const path = join(dir, name);
  const part = `${path}.part`;
  const out = createWriteStream(part);
  await once(out, 'open');
  const gzip = createGzip();
  gzip.pipe(out);
  const write = async (line: string): Promise<void> => {
    if (!gzip.write(line)) await once(gzip, 'drain');
  };
  try {
    await write(`${JSON.stringify({ format: BACKUP_FORMAT, version: VERSION, at: now.toISOString(), database: store.kind })}\n`);
    for await (const { table, row } of store.backupRows()) await write(asLine(table, row));
    gzip.end();
    await once(out, 'close');
  } catch (error) {
    gzip.unpipe(out);
    gzip.destroy();
    await new Promise((done) => out.close(done));
    rmSync(part, { force: true });
    throw error;
  }
  renameSync(part, path);
  return { name, size: statSync(path).size, at: now.toISOString() };
}

/** What a backup file says of itself in its first line. */
export interface BackupHeader {
  format: string;
  version: string;
  at: string;
  database: string;
}

/** What a backup file says it is; an error when it is not one. */
export async function backupHeader(path: string): Promise<BackupHeader> {
  let head: BackupHeader | null = null;
  for await (const _ of readBackup(path, (h) => (head = h))) break;
  return head as unknown as BackupHeader;
}

/** The rows of a backup file, as the store takes them back. Anything that is not a backup stops it. */
export async function* readBackup(path: string, onHeader?: (header: BackupHeader) => void): AsyncGenerator<{ table: string; row: Record<string, unknown> }> {
  const input = createReadStream(path);
  const gunzip = createGunzip();
  const lines = createInterface({ input: input.pipe(gunzip), crlfDelay: Infinity });
  // A file that is not gzip fails in the stream, not in a line: it is said as what it means.
  let started = false;
  const said = (error: unknown): Error =>
    (error as { code?: unknown }).code?.toString().startsWith('Z_') ? new Error(started ? 'the backup is damaged' : 'this file is not a Uhlaka backup') : (error as Error);
  const failed = new Promise<never>((_, reject) => {
    gunzip.on('error', (error) => reject(said(error)));
    input.on('error', (error) => reject(error));
  });
  failed.catch(() => {});
  const iterator = lines[Symbol.asyncIterator]();
  const next = () =>
    Promise.race([iterator.next(), failed]).catch((error: unknown) => {
      throw said(error);
    });
  try {
    const first = await next();
    let head: Record<string, unknown> = {};
    try {
      head = first.done ? {} : (JSON.parse(first.value) as Record<string, unknown>);
    } catch {
      // Said below.
    }
    if (fromOldName(head.format) !== BACKUP_FORMAT) throw new Error('this file is not a Uhlaka backup');
    started = true;
    onHeader?.({ format: String(head.format), version: String(head.version ?? ''), at: String(head.at ?? ''), database: String(head.database ?? '') });
    for (let line = await next(); !line.done; line = await next()) {
      if (!line.value) continue;
      let parsed: { t?: unknown; r?: unknown } = {};
      try {
        parsed = JSON.parse(line.value) as { t?: unknown; r?: unknown };
      } catch {
        // Said below.
      }
      if (typeof parsed.t !== 'string' || !parsed.r || typeof parsed.r !== 'object') throw new Error('the backup is damaged');
      const row = Object.fromEntries(
        Object.entries(parsed.r as Record<string, unknown>).map(([k, v]) => [
          k,
          v && typeof v === 'object' && typeof (v as { $b64?: unknown }).$b64 === 'string' ? new Uint8Array(Buffer.from((v as { $b64: string }).$b64, 'base64')) : v,
        ]),
      );
      yield { table: parsed.t, row };
    }
  } finally {
    lines.close();
    input.destroy();
  }
}

/** The backups in the folder, newest first. */
export function listBackups(dir: string): BackupFile[] {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  return readdirSync(dir)
    .filter(isBackupName)
    .map((name) => {
      const stat = statSync(join(dir, name));
      return { name, size: stat.size, at: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.at.localeCompare(a.at) || b.name.localeCompare(a.name));
}

/** Deletes what is past the number kept, oldest first; never the one named in `spare`. */
export function pruneBackups(dir: string, keep: number, spare = ''): string[] {
  const gone = listBackups(dir).filter((f) => f.name !== spare).slice(Math.max(0, keep - (spare ? 1 : 0)));
  for (const f of gone) rmSync(join(dir, f.name), { force: true });
  return gone.map((f) => f.name);
}

/** Where copies are sent: S3, or what a test gives in its place. */
export interface Remote {
  put(name: string, path: string): Promise<void>;
  /** The backups there, by name. */
  names(): Promise<string[]>;
  remove(name: string): Promise<void>;
  /** Writes and deletes a small file: whether the storage takes what is sent. */
  test(): Promise<void>;
}

export function s3Remote(s3: S3Settings): Remote {
  const client = new Bun.S3Client({
    endpoint: s3.endpoint || undefined,
    bucket: s3.bucket,
    region: s3.region,
    accessKeyId: s3.accessKeyId,
    secretAccessKey: s3.secretAccessKey,
  });
  return {
    put: async (name, path) => {
      await client.write(`${s3.prefix}${name}`, Bun.file(path));
    },
    names: async () => {
      const listed = await client.list({ prefix: s3.prefix, maxKeys: 1000 });
      return (listed.contents ?? []).map((item) => item.key.slice(s3.prefix.length)).filter(isBackupName);
    },
    remove: async (name) => {
      await client.delete(`${s3.prefix}${name}`);
    },
    test: async () => {
      const key = `${s3.prefix}uhlaka-test.txt`;
      await client.write(key, 'uhlaka checks that it may write here; this file is deleted at once.');
      await client.delete(key);
    },
  };
}

const stamp = (name: string): string => name.match(/\d{4}-\d{2}-\d{2}-\d{6}/)?.[0] ?? '';
const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** What the backups screen is told. */
export interface BackupsShown {
  settings: BackupSettings;
  last: LastBackup | null;
  files: BackupFile[];
  folder: string;
  limit: number;
}

/**
 * The site's backups, for the editor (ADR 0051): the clock asks `tick`, the
 * admin calls `api`, the command line calls `make` and `restore`.
 */
export function backups(
  store: Store,
  options: {
    dir: string;
    /** Where copies go; S3 unless a test gives its own. */
    remote?: (s3: S3Settings) => Remote;
    /** Takes a backup for this process, where several share one site (ADR 0044 d4). */
    claim?: (key: string, ms: number) => Promise<boolean>;
    log?: (line: string) => void;
  },
) {
  const dir = options.dir;
  const remoteFor = options.remote ?? s3Remote;
  const log = options.log ?? ((line: string) => console.log(line));
  let running: Promise<LastBackup> | null = null;

  const settings = async (): Promise<BackupSettings> => normalizeBackupSettings(await store.backupSettings());
  const last = async (): Promise<LastBackup | null> => ((await store.lastBackup()) as LastBackup | null) ?? null;

  /** Makes one now, keeps the number kept here and there, and says how it went. */
  async function make(kind = 'site', now = new Date(), spare = ''): Promise<LastBackup> {
    if (running) return running;
    running = (async (): Promise<LastBackup> => {
      const set = await settings();
      const done: LastBackup = { at: now.toISOString(), ok: false, name: '', size: 0, error: '', sent: 'none', sendError: '' };
      try {
        const file = await writeBackup(store, dir, kind, now);
        done.ok = true;
        done.name = file.name;
        done.size = file.size;
        pruneBackups(dir, set.keep, spare);
      } catch (error) {
        done.error = message(error);
        log(`The backup could not be made: ${done.error}`);
      }
      if (done.ok && set.s3) {
        try {
          const remote = remoteFor(set.s3);
          await remote.put(done.name, join(dir, done.name));
          // The newest are kept, whatever kind each is: a name says when it was made.
          const there = (await remote.names()).sort((a, b) => stamp(b).localeCompare(stamp(a)));
          for (const name of there.slice(set.keep)) await remote.remove(name);
          done.sent = 'yes';
        } catch (error) {
          done.sent = 'failed';
          done.sendError = message(error);
          log(`The backup was made but not sent to S3: ${done.sendError}`);
        }
      }
      await store.setLastBackup(done);
      return done;
    })();
    try {
      return await running;
    } finally {
      running = null;
    }
  }

  /** The clock's look: one is made when it is due, by one process. */
  async function tick(now = new Date()): Promise<LastBackup | null> {
    if (running || !isDue(await settings(), await last(), now)) return null;
    if (options.claim && !(await options.claim(`backup:${Math.floor(now.getTime() / HOUR)}`, HOUR))) return null;
    return make('site', now);
  }

  /** Puts a backup in the folder back (ADR 0051 d5), after a backup of what is there now. */
  async function restore(name: string, now = new Date()): Promise<number> {
    const path = join(dir, name);
    if (!isBackupName(name) || !existsSync(path)) throw new Error('there is no such backup');
    await backupHeader(path);
    const before = await make('before-restore', now, name);
    if (!before.ok) throw new Error(`nothing was put back: the backup of what is there now failed (${before.error})`);
    const count = await store.restoreRows(readBackup(path));
    log(`Put back ${name} (${count} rows); what was there before is in ${before.name}.`);
    return count;
  }

  const shown = async (): Promise<BackupsShown> => ({ settings: shownSettings(await settings()), last: await last(), files: listBackups(dir), folder: dir, limit: IMPORT_MAX_BYTES });
  const json = (data: unknown, status = 200): Response =>
    new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

  /** Settings saved from the admin: a secret given back as `***` keeps the one saved. */
  const withSecret = async (input: unknown): Promise<BackupSettings> => {
    const next = normalizeBackupSettings(input);
    const before = await settings();
    if (next.s3 && next.s3.secretAccessKey === HIDDEN) next.s3.secretAccessKey = before.s3?.secretAccessKey ?? '';
    return next;
  };

  /** Every call under /api/backups; the owner's only, which the server sees to. */
  async function api(request: Request, url: URL): Promise<Response> {
    const route = `${request.method} ${url.pathname}`;
    const name = url.searchParams.get('name') ?? '';
    switch (route) {
      case 'GET /api/backups':
        return json(await shown());
      case 'PUT /api/backups': {
        const body = (await request.json()) as { settings?: unknown };
        await store.setBackupSettings(await withSecret(body.settings));
        return json(await shown());
      }
      case 'POST /api/backups':
        await make();
        return json(await shown());
      case 'POST /api/backups/test': {
        const body = (await request.json()) as { settings?: unknown };
        const { s3 } = await withSecret(body.settings);
        if (!s3) return json({ test: { ok: false, error: 'give the bucket first' } });
        try {
          await remoteFor(s3).test();
          return json({ test: { ok: true, error: '' } });
        } catch (error) {
          return json({ test: { ok: false, error: message(error) } });
        }
      }
      case 'GET /api/backups/file': {
        const path = join(dir, name);
        if (!isBackupName(name) || !existsSync(path)) return json({ error: 'there is no such backup' }, 404);
        return new Response(Bun.file(path), {
          headers: { 'content-type': 'application/gzip', 'content-disposition': `attachment; filename="${name}"`, 'cache-control': 'no-store' },
        });
      }
      case 'DELETE /api/backups/file':
        if (isBackupName(name)) rmSync(join(dir, name), { force: true });
        return json(await shown());
      case 'POST /api/backups/restore':
        return json({ restored: await restore(name), ...(await shown()) });
      case 'POST /api/backups/upload': {
        if (Number(request.headers.get('content-length') ?? 0) > IMPORT_MAX_BYTES) return json({ error: 'the file is too large; put it back with uhlaka restore' }, 413);
        mkdirSync(dir, { recursive: true });
        const uploaded = backupName('uploaded', new Date());
        const path = join(dir, uploaded);
        await Bun.write(`${path}.part`, new Uint8Array(await request.arrayBuffer()));
        try {
          await backupHeader(`${path}.part`);
        } catch (error) {
          rmSync(`${path}.part`, { force: true });
          throw error;
        }
        renameSync(`${path}.part`, path);
        return json({ restored: await restore(uploaded), ...(await shown()) });
      }
      default:
        return json({ error: 'not found' }, 404);
    }
  }

  return { make, tick, restore, api, settings, last, dir };
}

export type Backups = ReturnType<typeof backups>;
