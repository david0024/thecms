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
  };
  /** A call to one of the hosts the extension declared. */
  fetch(url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<{ status: number; headers: Record<string, string>; body: string }>;
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
