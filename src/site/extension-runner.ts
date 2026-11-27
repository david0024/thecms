/**
 * Where an extension's code runs (ADR 0026): a process of its own, started by
 * the program with an empty environment in an empty folder. It holds no
 * database and no setting of the site. All it can do for the extension is
 * ask the program, which answers only for what the extension declared: its
 * own collections, as each action listed them, and the hosts it may call.
 *
 * It is a process boundary, not a sandbox: on one's own computer the code can
 * still read what that person can. On a server the program is installed to
 * run it under a user of its own (install.sh).
 */
import { rmSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** What goes between the program and this process. */
export type ToRunner =
  | { t: 'load'; code: string }
  | { t: 'run'; id: number; action: string; input: unknown }
  | { t: 'answer'; id: number; ok: boolean; value?: unknown; error?: string };
export type FromRunner =
  | { t: 'loaded'; error?: string; actions?: string[] }
  | { t: 'ask'; id: number; run: number; method: string; args: unknown[] }
  | { t: 'done'; id: number; ok: boolean; value?: unknown; error?: string };

/** What an action is given to reach the program. Every call is checked there. */
export interface ExtensionHost {
  collections: {
    list(collection: string): Promise<Record<string, unknown>[]>;
    read(collection: string, id: string): Promise<Record<string, unknown> | null>;
    insert(collection: string, row: Record<string, unknown>): Promise<Record<string, unknown>>;
    update(collection: string, id: string, row: Record<string, unknown>): Promise<Record<string, unknown>>;
    delete(collection: string, id: string): Promise<void>;
    /** Adds to the number fields of a row, made from `row` when there is none (ADR 0062 d5). */
    add(collection: string, id: string, numbers: Record<string, number>, row?: Record<string, unknown>): Promise<Record<string, unknown>>;
    /**
     * Takes from the number fields of a row, in one step, and refuses when one
     * would go below zero (ADR 0076 d4.6): seats, numbers in a series.
     */
    take(collection: string, id: string, numbers: Record<string, number>): Promise<Record<string, unknown>>;
    /**
     * The rows that pass a search (ADR 0076 d4.5): `where` a field equals a
     * value, or `{ ne, gt, gte, lt, lte, in, has }`; `order` a field, `-field`
     * for the largest first; `limit` up to 500 (100 when not said) and `offset`.
     * `count` is how many there are in all.
     */
    find(collection: string, query?: { where?: Record<string, unknown>; order?: string; limit?: number; offset?: number }): Promise<{ rows: Record<string, unknown>[]; count: number }>;
  };
  /**
   * Runs one of its actions declared as a job with `"once": true` (ADR 0076
   * d4.3), once, at least `minutes` from now (0 for as soon as the clock
   * ticks), with `input`. What fails is tried again later, waiting longer each
   * time, up to eight times. Gives back the id of the work queued.
   */
  later(action: string, input?: unknown, minutes?: number): Promise<string>;
  /**
   * Files it keeps for an order, for an action that declared `files` and uses
   * `orders` (ADR 0076 d4.4): an invoice's PDF, a label. The owner downloads
   * them from the order; one put with `buyer: true` is on the buyer's page of
   * the order too. `data` is the bytes in base64, at most 10 MB.
   */
  files: {
    put(file: { order: string; name: string; type: string; data: string; buyer?: boolean }): Promise<string>;
    remove(id: string): Promise<void>;
  };
  /**
   * A call to one of the hosts the extension declared. With `as: "base64"`
   * the answer's body is its bytes in base64 (ADR 0079 d6): a label's PDF.
   */
  fetch(url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; as?: 'text' | 'base64' }): Promise<{ status: number; headers: Record<string, string>; body: string }>;
  /** The site's name and languages. */
  site(): Promise<{ name: string; language: string; languages: string[] }>;
  /**
   * A picture of the site's library, by its address (`/media/…`), for an
   * action that declared `pictures` (ADR 0059 d3): its type and its bytes in
   * base64, at most 1600 pixels wide when a smaller copy is kept. Null when the
   * library has no such picture.
   */
  picture(src: string): Promise<{ type: string; data: string } | null>;
  /** The published pages and entries, newest first, for an action that declared it reads them (ADR 0062 d4). */
  published(): Promise<{ address: string; title: string; description: string; language: string; type: string; date: string }[]>;
  /**
   * The site's members, for an action that declared `members` (ADR 0064 d7):
   * a visitor whose address is confirmed, read by id or by e-mail; the levels
   * the owner named; a level given or taken. There is no list of them all.
   */
  members: {
    get(id: string): Promise<Member | null>;
    find(email: string): Promise<Member | null>;
    levels(): Promise<{ id: string; name: string }[]>;
    give(id: string, level: string): Promise<string[]>;
    take(id: string, level: string): Promise<string[]>;
  };
  /**
   * E-mail to one visitor, for an action that declared `mail` (ADR 0064 d7):
   * one of the extension's messages, or the site's welcome, through the
   * site's queue. `link` is an address of the site (`/…`) or of a host the
   * extension declared.
   */
  mail: {
    send(id: string, message: string, values?: { link?: string }): Promise<void>;
  };
  /**
   * The shop's orders, for an action that declared `orders` (ADR 0065 d9): one
   * read by its id (the id the `order.*` events carry), marked paid or
   * refunded, or given a tracking number; by a courier, marked sent with its
   * tracking number (the buyer is told) or completed (ADR 0079 d6). Marking an
   * order paid that is not waiting for payment, refunded twice, or sent or
   * completed when it is already so or past, changes nothing.
   */
  orders: {
    get(id: string): Promise<Record<string, unknown> | null>;
    paid(id: string): Promise<Record<string, unknown>>;
    refunded(id: string): Promise<Record<string, unknown>>;
    tracking(id: string, tracking: string): Promise<Record<string, unknown>>;
    sent(id: string, tracking: string): Promise<Record<string, unknown>>;
    completed(id: string): Promise<Record<string, unknown>>;
  };
}

/** A visitor as an extension that uses `members` reads them (ADR 0064 d7). */
export interface Member {
  id: string;
  name: string;
  email: string;
  language: string;
  levels: string[];
}

export function runner(send: (message: FromRunner) => void, receive: (handler: (message: ToRunner) => void) => void): void {
  let actions: Record<string, (input: unknown, host: ExtensionHost) => unknown> = {};
  let asked = 0;
  const waiting = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  // Made when the code comes; the program may send it before this process is ready to listen.
  let folder = '';
  process.on('exit', () => folder && rmSync(folder, { recursive: true, force: true }));

  const hostFor = (run: number): ExtensionHost => {
    const ask = (method: string, ...args: unknown[]): Promise<never> =>
      new Promise((resolve, reject) => {
        const id = ++asked;
        waiting.set(id, { resolve: resolve as (value: unknown) => void, reject });
        send({ t: 'ask', id, run, method, args });
      });
    return {
      collections: {
        list: (collection) => ask('list', collection),
        read: (collection, id) => ask('read', collection, id),
        insert: (collection, row) => ask('insert', collection, row),
        update: (collection, id, row) => ask('update', collection, id, row),
        delete: (collection, id) => ask('delete', collection, id),
        add: (collection, id, numbers, row) => ask('add', collection, id, numbers, row ?? {}),
        take: (collection, id, numbers) => ask('take', collection, id, numbers),
        find: (collection, query) => ask('find', collection, query ?? {}),
      },
      later: (action, input, minutes) => ask('later', action, input ?? null, minutes ?? 0),
      files: {
        put: (file) => ask('files.put', file),
        remove: (id) => ask('files.remove', id),
      },
      fetch: (url, init) => ask('fetch', url, init ?? {}),
      site: () => ask('site'),
      picture: (src) => ask('picture', src),
      published: () => ask('published'),
      members: {
        get: (id) => ask('members.get', id),
        find: (email) => ask('members.find', email),
        levels: () => ask('members.levels'),
        give: (id, level) => ask('members.give', id, level),
        take: (id, level) => ask('members.take', id, level),
      },
      mail: {
        send: (id, message, values) => ask('mail.send', id, message, values ?? {}),
      },
      orders: {
        get: (id) => ask('orders.get', id),
        paid: (id) => ask('orders.paid', id),
        refunded: (id) => ask('orders.refunded', id),
        tracking: (id, tracking) => ask('orders.tracking', id, tracking),
        sent: (id, tracking) => ask('orders.sent', id, tracking),
        completed: (id) => ask('orders.completed', id),
      },
    };
  };
  // The network is the program's to reach, for the hosts declared: say so instead of failing somewhere else.
  globalThis.fetch = (() => Promise.reject(new Error('an extension calls out with host.fetch, to the hosts it declared'))) as unknown as typeof fetch;

  receive(async (message) => {
    if (message.t === 'answer') {
      const one = waiting.get(message.id);
      waiting.delete(message.id);
      if (message.ok) one?.resolve(message.value);
      else one?.reject(new Error(message.error));
      return;
    }
    if (message.t === 'load') {
      try {
        folder ||= await mkdtemp(join(tmpdir(), 'uhlaka-ext-'));
        const file = join(folder, `extension-${Date.now()}.mjs`);
        await writeFile(file, message.code);
        const module = (await import(file)) as { actions?: Record<string, (input: unknown, host: ExtensionHost) => unknown> };
        actions = module.actions ?? {};
        await rm(file, { force: true });
        send({ t: 'loaded', actions: Object.keys(actions) });
      } catch (error) {
        send({ t: 'loaded', error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }
    const action = actions[message.action];
    try {
      if (typeof action !== 'function') throw new Error(`the extension has no action "${message.action}"`);
      send({ t: 'done', id: message.id, ok: true, value: (await action(message.input, hostFor(message.id))) ?? null });
    } catch (error) {
      send({ t: 'done', id: message.id, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });
}

/** Messages as lines of JSON, over a stream: how a runner on a server talks over its socket. */
export function lines(onLine: (message: unknown) => void): (chunk: Uint8Array | string) => void {
  const decoder = new TextDecoder();
  let rest = '';
  return (chunk) => {
    rest += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
    let at = rest.indexOf('\n');
    while (at >= 0) {
      const line = rest.slice(0, at);
      rest = rest.slice(at + 1);
      if (line.trim()) onLine(JSON.parse(line));
      at = rest.indexOf('\n');
    }
  };
}

/** What the runner needs of its process: the program's channel, or standard input and output. */
export type RunnerIo = Pick<NodeJS.Process, 'send' | 'on' | 'exit'> & { stdin: Pick<NodeJS.ReadStream, 'on'>; stdout: Pick<NodeJS.WriteStream, 'write'>; stderr: Pick<NodeJS.WriteStream, 'write'> };

/**
 * Run as the child. Started by the program, the messages come over the
 * channel it opened. Started by systemd for a connection to its socket
 * (install.sh --server), they are lines on standard input and output.
 */
export function startRunner(io: RunnerIo = process): void {
  if (io.send) {
    const send = io.send.bind(io);
    runner(
      (message) => void send(message),
      (handler) => io.on('message', (message) => handler(message as ToRunner)),
    );
    // When the program goes, so does this.
    io.on('disconnect', () => io.exit(0));
    return;
  }
  // Standard output is the channel: what the extension prints goes to standard error instead.
  const write = io.stdout.write.bind(io.stdout);
  io.stdout.write = io.stderr.write.bind(io.stderr) as typeof io.stdout.write;
  console.log = console.error;
  runner(
    (message) => void write(`${JSON.stringify(message)}\n`),
    (handler) => {
      io.stdin.on('data', lines((message) => handler(message as ToRunner)));
      io.stdin.on('end', () => io.exit(0));
    },
  );
}

if (import.meta.main) startRunner();
