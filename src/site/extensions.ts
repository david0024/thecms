/**
 * Installing extensions and running their actions (ADR 0026).
 *
 * A package is checked before anything is kept: its format, what it asks for
 * and the version of the program it needs. The owner sees what it asks for and
 * accepts that exact file, named by its SHA-256. Its code runs in a process of
 * its own (`extension-runner.ts`), one for each extension, started when an
 * action is first run. What the code asks for is answered here, and only
 * within what the extension declared.
 */
import { join } from 'node:path';
import { cleanRow, egressAllows, type ExtensionAction, type ExtensionManifest, extensionAsks, EXTENSION_MAX_BYTES, parseExtension } from '../core/index.ts';
import { type FromRunner, lines, type ToRunner } from './extension-runner.ts';
import type { InstalledExtension, Store } from './store.ts';
import { isCompiled, newer } from './update.ts';
import { VERSION } from './version.ts';

const sha256 = (text: string): string => new Bun.CryptoHasher('sha256').update(text).digest('hex');
const FETCH_MAX_BYTES = 5 * 1024 * 1024;
/** A process nobody has asked anything for this long is stopped; the next action starts it again. */
const IDLE_MS = 5 * 60_000;

/** What the owner is shown about a package before installing it. */
export interface ExtensionOffer {
  manifest: ExtensionManifest;
  sha256: string;
  asks: ReturnType<typeof extensionAsks>;
  /** The version installed now, when this one replaces it. */
  replaces: string | null;
}

/** How a process for an extension is started: the program again, as the runner. */
export type Spawn = () => { send(message: ToRunner): void; onMessage(handler: (message: FromRunner) => void): void; onExit(handler: () => void): void; kill(): void };

export const spawnRunner: Spawn = () => {
  const command = isCompiled() ? [process.execPath, '__extension-runner'] : [process.execPath, join(import.meta.dir, 'extension-runner.ts')];
  let handler: (message: FromRunner) => void = () => {};
  const exits: (() => void)[] = [];
  const child = Bun.spawn(command, {
    // Nothing of the program's: no database address, no key, no setting.
    env: { PATH: process.env.PATH ?? '' },
    cwd: process.env.TMPDIR ?? '/tmp',
    stdio: ['ignore', 'ignore', 'inherit'],
    ipc: (message) => handler(message as FromRunner),
    serialization: 'json',
  });
  void child.exited.then(() => exits.forEach((exit) => exit()));
  return {
    send: (message) => child.send(message),
    onMessage: (next) => (handler = next),
    onExit: (exit) => void exits.push(exit),
    kill: () => child.kill(),
  };
};

/**
 * On a server, a runner is started by systemd for each connection to its
 * socket, under a user of its own with no network and no way into the site's
 * files (install.sh --server). `THECMS_EXTENSION_RUNNER` names the socket.
 */
export const socketRunner = (path: string): Spawn => () => {
  let handler: (message: FromRunner) => void = () => {};
  const exits: (() => void)[] = [];
  const queue: string[] = [];
  let socket: { write(data: string): number; end(): void } | null = null;
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    exits.forEach((exit) => exit());
  };
  const read = lines((message) => handler(message as FromRunner));
  Bun.connect({
    unix: path,
    socket: {
      open(opened) {
        socket = opened;
        for (const line of queue.splice(0)) opened.write(line);
      },
      data: (_socket, chunk) => read(chunk),
      // The runner went: its side of the connection ends.
      end: close,
      close,
      error: close,
      connectError: close,
    },
  }).catch(close);
  return {
    send: (message) => {
      const line = `${JSON.stringify(message)}\n`;
      if (socket) socket.write(line);
      else queue.push(line);
    },
    onMessage: (next) => (handler = next),
    // A connection refused at once has ended before anyone asked.
    onExit: (exit) => (closed ? queueMicrotask(exit) : void exits.push(exit)),
    kill: () => {
      socket?.end();
      close();
    },
  };
};

interface Running {
  process: ReturnType<Spawn>;
  loaded: Promise<void>;
  runs: Map<number, { action: ExtensionAction; resolve: (value: unknown) => void; reject: (error: Error) => void }>;
  idle: ReturnType<typeof setTimeout> | null;
}

export function extensionHost(store: Store, options: { spawn?: Spawn; fetch?: (url: string, init: RequestInit) => Promise<Response> } = {}) {
  const spawn = options.spawn ?? (process.env.THECMS_EXTENSION_RUNNER ? socketRunner(process.env.THECMS_EXTENSION_RUNNER) : spawnRunner);
  const outbound = options.fetch ?? ((url, init) => fetch(url, init));
  const running = new Map<string, Running>();
  let runs = 0;

  /** Reads a package file and says what it asks for. Nothing is kept. */
  async function offer(text: string): Promise<ExtensionOffer> {
    if (text.length > EXTENSION_MAX_BYTES) throw new Error('an extension is at most 5 MB');
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new Error('this is not an extension file');
    }
    const { pkg, problems } = parseExtension(raw);
    if (!pkg) throw new Error(problems.join('; '));
    if (newer(pkg.manifest.thecmsMinVersion, VERSION)) throw new Error(`${pkg.manifest.displayName} needs version ${pkg.manifest.thecmsMinVersion} of this program; this is ${VERSION} (update it first)`);
    const before = await store.extension(pkg.manifest.name);
    return { manifest: pkg.manifest, sha256: sha256(text), asks: extensionAsks(pkg.manifest), replaces: before?.manifest.version ?? null };
  }

  /** Installs the file the owner accepted: the same bytes, or nothing. */
  async function install(text: string, accepted: string): Promise<InstalledExtension> {
    const offered = await offer(text);
    if (offered.sha256 !== accepted) throw new Error('this is not the file that was accepted; look at what it asks for again');
    stop(offered.manifest.name);
    return store.installExtension(JSON.parse(text), offered.sha256);
  }

  function stop(name: string): void {
    const one = running.get(name);
    if (!one) return;
    running.delete(name);
    if (one.idle) clearTimeout(one.idle);
    for (const run of one.runs.values()) run.reject(new Error('the extension was stopped'));
    one.process.kill();
  }

  /** Answers what the code asked for, if its action declared it. */
  async function answer(extension: InstalledExtension, action: ExtensionAction, method: string, args: unknown[]): Promise<unknown> {
    const name = extension.manifest.name;
    const collectionOf = (value: unknown, write: boolean) => {
      const wanted = String(value);
      if (!(write ? action.writes : action.reads).includes(wanted)) throw new Error(`the action "${action.name}" did not declare that it ${write ? 'writes' : 'reads'} "${wanted}"`);
      return extension.manifest.collections.find((c) => c.name === wanted) as ExtensionManifest['collections'][number];
    };
    switch (method) {
      case 'list':
        return store.extensionRows(name, collectionOf(args[0], false).name);
      case 'read':
        return store.extensionRow(name, collectionOf(args[0], false).name, String(args[1]));
      case 'insert':
      case 'update': {
        const of = collectionOf(args[0], true);
        const id = method === 'update' ? String(args[1]) : null;
        const before = id === null ? null : await store.extensionRow(name, of.name, id);
        if (id !== null && !before) throw new Error('no such row');
        const { row, problems } = cleanRow(of, args[method === 'update' ? 2 : 1], before);
        if (problems.length) throw new Error(problems.join('; '));
        return store.saveExtensionRow(name, of.name, row, id);
      }
      case 'delete':
        return store.deleteExtensionRow(name, collectionOf(args[0], true).name, String(args[1]));
      case 'site': {
        const site = await store.site();
        return { name: site.name, language: site.language, languages: site.languages };
      }
      case 'fetch': {
        const url = new URL(String(args[0]));
        const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
        if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) throw new Error('an extension calls out over https');
        if (!egressAllows(extension.manifest.egress, url.hostname)) throw new Error(`${extension.manifest.displayName} did not declare that it calls ${url.hostname}`);
        const init = (args[1] ?? {}) as { method?: string; headers?: Record<string, string>; body?: string };
        // A redirect could lead anywhere: it is answered as it came, not followed.
        const response = await outbound(url.href, { method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body, redirect: 'manual', signal: AbortSignal.timeout(action.timeoutSeconds * 1000) });
        const body = await response.text();
        if (body.length > FETCH_MAX_BYTES) throw new Error('the answer is larger than 5 MB');
        return { status: response.status, headers: Object.fromEntries(response.headers), body };
      }
      default:
        throw new Error(`there is no "${method}"`);
    }
  }

  function start(extension: InstalledExtension): Running {
    const process = spawn();
    let ready: () => void = () => {};
    let failed: (error: Error) => void = () => {};
    const one: Running = { process, runs: new Map(), idle: null, loaded: new Promise((resolve, reject) => ((ready = resolve), (failed = reject))) };
    process.onMessage((message) => {
      if (message.t === 'loaded') return message.error ? failed(new Error(`${extension.manifest.displayName} did not start: ${message.error}`)) : ready();
      const run = one.runs.get(message.t === 'ask' ? message.run : message.id);
      if (message.t === 'done') {
        one.runs.delete(message.id);
        return message.ok ? run?.resolve(message.value) : run?.reject(new Error(message.error));
      }
      if (!run) return process.send({ t: 'answer', id: message.id, ok: false, error: 'that action has ended' });
      answer(extension, run.action, message.method, message.args).then(
        (value) => process.send({ t: 'answer', id: message.id, ok: true, value: value ?? null }),
        (error: unknown) => process.send({ t: 'answer', id: message.id, ok: false, error: error instanceof Error ? error.message : String(error) }),
      );
    });
    process.onExit(() => {
      if (running.get(extension.manifest.name) !== one) return;
      running.delete(extension.manifest.name);
      failed(new Error(`${extension.manifest.displayName} stopped`));
      for (const run of one.runs.values()) run.reject(new Error(`${extension.manifest.displayName} stopped while it worked`));
    });
    process.send({ t: 'load', code: extension.code });
    running.set(extension.manifest.name, one);
    return one;
  }

  /** Runs one of an extension's actions and gives back what it answered. */
  async function run(name: string, actionName: string, input: unknown): Promise<unknown> {
    const extension = await store.extension(name);
    if (!extension) throw new Error(`no extension "${name}" is installed`);
    if (!extension.enabled) throw new Error(`${extension.manifest.displayName} is turned off`);
    const action = extension.manifest.actions.find((a) => a.name === actionName);
    if (!action) throw new Error(`${extension.manifest.displayName} has no action "${actionName}"`);
    const one = running.get(name) ?? start(extension);
    if (one.idle) clearTimeout(one.idle);
    await one.loaded;
    const id = ++runs;
    const answered = new Promise<unknown>((resolve, reject) => {
      one.runs.set(id, { action, resolve, reject });
      one.process.send({ t: 'run', id, action: action.name, input });
    });
    let timer: ReturnType<typeof setTimeout> | null = null;
    const late = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        // Code that does not answer may never: its process goes, and with it whatever else it was doing.
        reject(new Error(`${extension.manifest.displayName} did not answer within ${action.timeoutSeconds} seconds`));
        stop(name);
      }, action.timeoutSeconds * 1000);
    });
    try {
      return await Promise.race([answered, late]);
    } finally {
      if (timer) clearTimeout(timer);
      if (running.get(name) === one && one.runs.size === 0) one.idle = setTimeout(() => stop(name), IDLE_MS);
    }
  }

  return {
    offer,
    install,
    run,
    /** Turns an extension on or off; off, its process stops. */
    async enable(name: string, enabled: boolean): Promise<void> {
      await store.enableExtension(name, enabled);
      if (!enabled) stop(name);
    },
    async uninstall(name: string): Promise<void> {
      stop(name);
      await store.uninstallExtension(name);
    },
    /** Stops every extension's process. */
    close(): void {
      for (const name of [...running.keys()]) stop(name);
    },
  };
}

export type ExtensionHostApi = ReturnType<typeof extensionHost>;
