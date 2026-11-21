/**
 * What the site's processes share (ADR 0044 d4): built pages, the counters that
 * limit tries, the lock for what must run once, and who is signed in. On a
 * server it is Valkey; without one, and whenever Valkey does not answer, it is
 * kept here, in memory and on disk. Nothing stops when Valkey is down: the
 * site goes on from what is kept here, and the admin says so.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RedisClient } from 'bun';

/** How long Valkey is left alone after it did not answer, before it is asked again. */
export const RETRY_MS = 5_000;
/** How long one question to Valkey may take before the answer is looked for here. */
export const ANSWER_MS = 500;
/** How many keys are kept in memory: the oldest goes first. */
const KEPT = 20_000;

export interface SharedStatus {
  /** Valkey, or kept by this process. */
  kind: 'valkey' | 'local';
  /** Valkey's address, without its password. */
  address: string;
  /** Whether Valkey answered the last time it was asked. */
  up: boolean;
  /** What went wrong the last time, in Valkey's words. */
  error: string;
}

export interface Shared {
  get(key: string): Promise<string | null>;
  /** Keeps a value for a while. Values kept for longer than a minute are also written to disk, when there is one. */
  set(key: string, value: string, ms: number): Promise<void>;
  del(key: string): Promise<void>;
  /** Counts one more try in a window that starts with the first one, and says how many there were, this one with them. */
  hit(key: string, windowMs: number): Promise<number>;
  /** How many tries were counted, without counting one. */
  count(key: string): Promise<number>;
  /** True for the one who takes it, until it runs out: what must happen once happens once. */
  claim(key: string, ms: number): Promise<boolean>;
  status(): SharedStatus;
  close(): void;
}

/** The commands Valkey is asked; Bun's client, or the tests' own. */
export interface ValkeyClient {
  readonly connected: boolean;
  connect(): Promise<void>;
  send(command: string, args: string[]): Promise<unknown>;
  close(): void;
}

/** An address shown to the owner: the password is left out. */
export function shownAddress(address: string): string {
  try {
    const url = new URL(address);
    if (url.password) url.password = '***';
    return url.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
}

/** Whether an address is one Valkey is reached at. */
export const isValkeyAddress = (address: string): boolean => /^(redis|rediss|valkey|valkeys):\/\/[^\s]+$/.test(address);

/** Valkey's own scheme is not Bun's: valkey:// is redis://, valkeys:// is rediss://. */
const clientAddress = (address: string): string => address.replace(/^valkey(s?):\/\//, 'redis$1://');

/** What this process keeps: in memory, and on disk under `dir` when one is given. */
export function localShared(options: { dir?: string; now?: () => number } = {}): Shared {
  const now = options.now ?? Date.now;
  const kept = new Map<string, { value: string; until: number }>();
  const file = (key: string): string => join(options.dir as string, createHash('sha256').update(key).digest('hex').slice(0, 40));
  if (options.dir) mkdirSync(options.dir, { recursive: true });
  const keep = (key: string, value: string, until: number): void => {
    kept.delete(key);
    kept.set(key, { value, until });
    if (kept.size > KEPT) kept.delete(kept.keys().next().value as string);
  };
  const fresh = (key: string): string | null => {
    const found = kept.get(key);
    if (found && found.until > now()) return found.value;
    if (found) kept.delete(key);
    if (!options.dir) return null;
    try {
      const { value, until } = JSON.parse(readFileSync(file(key), 'utf8')) as { value: string; until: number };
      if (until > now()) {
        keep(key, value, until);
        return value;
      }
    } catch {
      // Not on disk, or not whole: as if it were not there.
    }
    return null;
  };
  return {
    get: async (key) => fresh(key),
    async set(key, value, ms) {
      keep(key, value, now() + ms);
      if (options.dir && ms > 60_000) {
        try {
          writeFileSync(file(key), JSON.stringify({ value, until: now() + ms }));
        } catch {
          // A full disk loses only what would have been faster.
        }
      }
    },
    async del(key) {
      kept.delete(key);
      if (options.dir) rmSync(file(key), { force: true });
    },
    async hit(key, windowMs) {
      const count = Number(fresh(key) ?? 0) + 1;
      keep(key, String(count), count === 1 ? now() + windowMs : (kept.get(key) as { until: number }).until);
      return count;
    },
    count: async (key) => Number(fresh(key) ?? 0),
    async claim(key, ms) {
      if (fresh(key) !== null) return false;
      keep(key, '1', now() + ms);
      return true;
    },
    status: () => ({ kind: 'local', address: '', up: true, error: '' }),
    close: () => {},
  };
}

/** Valkey, with what this process keeps standing in for it whenever it does not answer. */
export function valkeyShared(
  address: string,
  options: { client?: ValkeyClient; fallback?: Shared; log?: (line: string) => void; now?: () => number } = {},
): Shared {
  const now = options.now ?? Date.now;
  const log = options.log ?? ((line: string) => console.error(line));
  const fallback = options.fallback ?? localShared();
  const client: ValkeyClient =
    options.client ?? (new RedisClient(clientAddress(address), { connectionTimeout: ANSWER_MS * 4, autoReconnect: true, enableOfflineQueue: false, maxRetries: 3 }) as unknown as ValkeyClient);
  let up = true;
  let error = '';
  let failedAt = -Infinity;

  /** Valkey's answer, or the one kept here when it gives none. */
  async function ask<T>(valkey: () => Promise<T>, local: () => Promise<T>): Promise<T> {
    if (!up && now() - failedAt < RETRY_MS) return local();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (!client.connected) await client.connect();
      const answer = await Promise.race([
        valkey(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`no answer within ${ANSWER_MS} ms`)), ANSWER_MS);
        }),
      ]);
      if (!up) log(`Valkey answers again at ${shownAddress(address)}.`);
      up = true;
      error = '';
      return answer;
    } catch (failure) {
      const said = failure instanceof Error ? failure.message : String(failure);
      if (up) log(`Valkey at ${shownAddress(address)} does not answer (${said}); the site goes on from what this process keeps.`);
      up = false;
      error = said;
      failedAt = now();
      return local();
    } finally {
      clearTimeout(timer);
    }
  }

  const send = (command: string, ...args: string[]) => client.send(command, args);
  return {
    get: (key) =>
      ask(
        async () => {
          const value = await send('GET', key);
          return value === null || value === undefined ? null : String(value);
        },
        () => fallback.get(key),
      ),
    set: (key, value, ms) =>
      ask(
        async () => void (await send('SET', key, value, 'PX', String(Math.max(1, Math.round(ms))))),
        () => fallback.set(key, value, ms),
      ),
    del: (key) =>
      ask(
        async () => void (await send('DEL', key)),
        () => fallback.del(key),
      ),
    hit: (key, windowMs) =>
      ask(
        async () => {
          const count = Number(await send('INCR', key));
          if (count === 1) await send('PEXPIRE', key, String(windowMs));
          return count;
        },
        () => fallback.hit(key, windowMs),
      ),
    count: (key) =>
      ask(
        async () => Number((await send('GET', key)) ?? 0),
        () => fallback.count(key),
      ),
    claim: (key, ms) =>
      ask(
        async () => (await send('SET', key, '1', 'NX', 'PX', String(ms))) === 'OK',
        () => fallback.claim(key, ms),
      ),
    status: () => ({ kind: 'valkey', address: shownAddress(address), up, error }),
    close: () => {
      client.close();
      fallback.close();
    },
  };
}

/** Asks Valkey at an address whether it answers, as Settings → Performance does: how long it took, or what went wrong. */
export async function testValkey(address: string, client?: ValkeyClient): Promise<{ ok: boolean; ms: number; error: string }> {
  if (!isValkeyAddress(address)) return { ok: false, ms: 0, error: 'an address starts with redis:// or valkey://' };
  const asked: ValkeyClient = client ?? (new RedisClient(clientAddress(address), { connectionTimeout: ANSWER_MS * 4, autoReconnect: false, enableOfflineQueue: false }) as unknown as ValkeyClient);
  const start = performance.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      (async () => {
        await asked.connect();
        const pong = await asked.send('PING', []);
        if (pong !== 'PONG') throw new Error(`it answered ${String(pong)}`);
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`no answer within ${ANSWER_MS * 4} ms`)), ANSWER_MS * 4);
      }),
    ]);
    return { ok: true, ms: Math.round(performance.now() - start), error: '' };
  } catch (failure) {
    return { ok: false, ms: 0, error: failure instanceof Error ? failure.message : String(failure) };
  } finally {
    clearTimeout(timer);
    asked.close();
  }
}

/** Where the site's processes share what they keep: Valkey when an address is given, this process otherwise. */
export function openShared(address: string, options: { dir?: string; log?: (line: string) => void } = {}): Shared {
  const local = localShared({ dir: options.dir });
  return isValkeyAddress(address) ? valkeyShared(address, { fallback: local, log: options.log }) : local;
}

/** A Shared whose place can change while the site runs: a new address saved in Settings → Performance takes effect at once. */
export function switchable(first: Shared): Shared & { use(next: Shared): void } {
  let current = first;
  return {
    get: (key) => current.get(key),
    set: (key, value, ms) => current.set(key, value, ms),
    del: (key) => current.del(key),
    hit: (key, windowMs) => current.hit(key, windowMs),
    count: (key) => current.count(key),
    claim: (key, ms) => current.claim(key, ms),
    status: () => current.status(),
    close: () => current.close(),
    use(next) {
      const old = current;
      current = next;
      old.close();
    },
  };
}
