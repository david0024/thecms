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
import { ANSWER_SECONDS, extensionWord, cleanBlockPost, cleanRow, contentTypes, egressAllows, entryIn, entryPath, type ExtensionAction, type ExtensionEventName, pagePath, type Question, QUESTIONS, typeIn, type ExtensionManifest, extensionAsks, EXTENSION_MAX_BYTES, mediaKindOf, mediaNameOf, parseExtension, variantOf } from '../core/index.ts';
import { type FromRunner, lines, type ToRunner } from './extension-runner.ts';
import type { InstalledExtension, SiteEvent, Store } from './store.ts';
import type { AccountsLent } from './visitor-gate.ts';
import { extensionMailKey, normalizeTemplates, withoutExtension } from './site-mail.ts';
import { isCompiled, newer } from './update.ts';
import { VERSION } from './version.ts';

const sha256 = (text: string): string => new Bun.CryptoHasher('sha256').update(text).digest('hex');
/** The largest picture an extension is given (ADR 0059 d3). */
const PICTURE_MAX_BYTES = 5 * 1024 * 1024;
const FETCH_MAX_BYTES = 5 * 1024 * 1024;
/** A process nobody has asked anything for this long is stopped; the next action starts it again. */
const IDLE_MS = 5 * 60_000;
/** How long what the extensions listen to is kept before it is asked again: one installed elsewhere is heard within this. */
const LISTENING_MS = 10_000;
/** The name an extension gives a row it adds to. */
const ROW_ID = /^[A-Za-z0-9._:-]{1,40}$/;
/** What a visitor may send to an extension's route: a provider's notice, not a file. */
export const ROUTE_MAX_BYTES = 64 * 1024;
/** Headers a route's action is not given: the editor's session and key are not the extension's. */
const UNSAID = new Set(['cookie', 'x-uhlaka-token']);
/** Headers a route's answer may set. */
const SAID = ['content-type', 'location', 'cache-control'];

/**
 * Draws what a route answers as a page (ADR 0062 d6), in the site's layout and
 * the visitor's language; null when the site has nothing published to draw it in.
 */
export type DrawPage = (page: { title: unknown; blocks: unknown }, language: string) => Promise<string | null>;

/** Where a block's form sends the visitor back to: an address on this site, never elsewhere. */
const BACK = /^\/(?!\/)[^\s\\#?]*$/;

/** What the owner is shown about a package before installing it. */
export interface ExtensionOffer {
  manifest: ExtensionManifest;
  sha256: string;
  asks: ReturnType<typeof extensionAsks>;
  /** The version installed now, when this one replaces it. */
  replaces: string | null;
  /** It works with visitor accounts, and they are off (ADR 0064 d7): the owner is told before installing. */
  accountsOff: boolean;
  /** It works with the shop, and it is off (ADR 0065 d9): the owner is told before installing. */
  shopOff: boolean;
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
 * files (install.sh --server). `UHLAKA_EXTENSION_RUNNER` names the socket.
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

export function extensionHost(store: Store, options: { spawn?: Spawn; fetch?: (url: string, init: RequestInit) => Promise<Response>; log?: (line: string) => void } = {}) {
  const log = options.log ?? ((line: string) => console.error(line));
  const spawn = options.spawn ?? (process.env.UHLAKA_EXTENSION_RUNNER ? socketRunner(process.env.UHLAKA_EXTENSION_RUNNER) : spawnRunner);
  const outbound = options.fetch ?? ((url, init) => fetch(url, init));
  const running = new Map<string, Running>();
  let runs = 0;
  /** What visitor accounts lend (ADR 0064 d7), given by the runtime that serves them. */
  let accounts: AccountsLent | null = null;
  const lent = (): AccountsLent => {
    if (!accounts) throw new Error('visitor accounts are not reachable here');
    return accounts;
  };

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
    if (newer(pkg.manifest.uhlakaMinVersion, VERSION.split('-')[0] as string)) throw new Error(`${pkg.manifest.displayName} needs version ${pkg.manifest.uhlakaMinVersion} of this program; this is ${VERSION} (update it first)`);
    const before = await store.extension(pkg.manifest.name);
    const asks = extensionAsks(pkg.manifest);
    const accountsOff = asks.accounts && (await store.visitorSettings().then((v) => (v as { on?: unknown } | null)?.on !== true));
    const shopOff = asks.shop && (await store.shopSettings().then((v) => (v as { on?: unknown } | null)?.on !== true));
    return { manifest: pkg.manifest, sha256: sha256(text), asks, replaces: before?.manifest.version ?? null, accountsOff, shopOff };
  }

  /** Installs the file the owner accepted: the same bytes, or nothing. */
  async function install(text: string, accepted: string): Promise<InstalledExtension> {
    const offered = await offer(text);
    if (offered.sha256 !== accepted) throw new Error('this is not the file that was accepted; look at what it asks for again');
    stop(offered.manifest.name);
    listening = null;
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
      case 'add': {
        // Numbers added to, not written over (ADR 0062 d5): two processes counting at once lose nothing.
        const of = collectionOf(args[0], true);
        const id = String(args[1]);
        if (!ROW_ID.test(id)) throw new Error('a row added to is named by up to 40 letters, digits, ".", ":", "_" and "-"');
        const by = (args[2] ?? {}) as Record<string, unknown>;
        const numbers: Record<string, number> = {};
        for (const [key, value] of Object.entries(by)) {
          if (of.fields.find((f) => f.key === key)?.kind !== 'number') throw new Error(`"${key}" is not a number of ${of.name}`);
          if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`what is added to "${key}" is a number`);
          numbers[key] = value;
        }
        const { row, problems } = cleanRow(of, args[3] ?? {}, null);
        if (problems.length) throw new Error(problems.join('; '));
        return store.addToExtensionRow(name, of.name, id, row, numbers);
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
      case 'published': {
        // The program's data, declared (ADR 0062 d4): what visitors can read anyway, nothing behind a password.
        if (!action.uses.includes('published')) throw new Error(`the action "${action.name}" did not declare that it reads "published"`);
        return publishedFor(store);
      }
      case 'members.get':
      case 'members.find':
      case 'members.levels':
      case 'members.give':
      case 'members.take': {
        // The members, declared (ADR 0064 d7): read by one id or one address, never all of them.
        if (!action.uses.includes('members')) throw new Error(`the action "${action.name}" did not declare that it uses "members"`);
        const what = method.slice(8) as 'get' | 'find' | 'levels' | 'give' | 'take';
        if (what === 'levels') return (await lent().levels()).map((l) => ({ id: l.id, name: l.name }));
        if (what === 'get' || what === 'find') return lent()[what](String(args[0] ?? ''));
        return lent()[what](String(args[0] ?? ''), String(args[1] ?? ''));
      }
      case 'orders.get':
      case 'orders.paid':
      case 'orders.refunded':
      case 'orders.tracking': {
        // The shop's orders, declared (ADR 0065 d9): one by its id, never a list of them all.
        if (!action.uses.includes('orders')) throw new Error(`the action "${action.name}" did not declare that it uses "orders"`);
        const { shopGate } = await import('./shop-gate.ts');
        const lent = shopGate(store).lent;
        const id = String(args[0] ?? '');
        if (method === 'orders.tracking') return lent.tracking(id, String(args[1] ?? ''));
        return lent[method.slice(7) as 'get' | 'paid' | 'refunded'](id);
      }
      case 'mail.send': {
        // E-mail to one visitor, declared (ADR 0064 d7): never to an address the extension gives.
        if (!action.uses.includes('mail')) throw new Error(`the action "${action.name}" did not declare that it uses "mail"`);
        const asked = String(args[1] ?? '');
        const own = extension.manifest.mails.find((m) => m.name === asked);
        if (asked !== 'welcome' && !own) throw new Error(`"${asked.slice(0, 40)}" is not one of its messages, nor the site's welcome`);
        const values = (args[2] && typeof args[2] === 'object' ? args[2] : {}) as { link?: unknown };
        const link = await linkFor(extension, typeof values.link === 'string' ? values.link : asked === 'welcome' ? '/_/account' : '');
        const manifest = extension.manifest;
        if (!own) return lent().send(String(args[0] ?? ''), 'welcome', link);
        // The owner's words where they changed them in Settings → E-mail, else the extension's, translated.
        const key = extensionMailKey(name, own.name);
        const saved = normalizeTemplates(await store.mailTemplates());
        return lent().send(
          String(args[0] ?? ''),
          { what: key, words: (language) => saved[language]?.[key] ?? { subject: extensionWord(manifest, language, own.subject), text: extensionWord(manifest, language, own.text) } },
          link,
        );
      }
      case 'picture': {
        if (!action.pictures) throw new Error(`the action "${action.name}" did not declare that it sees the site's pictures`);
        const name = mediaNameOf(String(args[0]));
        if (!name || mediaKindOf(name) !== 'image') return null;
        // The widest smaller copy up to 1600 pixels is enough to see a picture by, and costs a model less.
        const copies = ((await store.mediaSizes())[name]?.variants ?? []).map((v) => ({ v, width: variantOf(v)?.width ?? 0 })).filter((c) => c.width > 0 && c.width <= 1600);
        const best = copies.sort((a, b) => b.width - a.width)[0]?.v;
        const file = (best ? await store.mediaFile(best) : null) ?? (await store.mediaFile(name));
        if (!file) return null;
        if (file.bytes.length > PICTURE_MAX_BYTES) throw new Error('the picture is larger than 5 MB');
        return { type: file.type, data: Buffer.from(file.bytes).toString('base64') };
      }
      default:
        throw new Error(`there is no "${method}"`);
    }
  }

  /**
   * The link a message to a visitor carries (ADR 0064 d7): an address of the
   * site, made whole with the site's own address, or one on a host the
   * extension declared. Nothing else, so a message from the site never leads
   * somewhere the owner did not accept.
   */
  async function linkFor(extension: InstalledExtension, link: string): Promise<string> {
    if (link === '') return '';
    if (link.length > 2000 || /[\s<>"]/.test(link)) throw new Error('a link is an address of the site, or of a host it declared');
    if (/^\/(?!\/)/.test(link)) {
      let origin = '';
      try {
        const own = new URL((await store.site()).url);
        if (own.protocol === 'https:' || own.protocol === 'http:') origin = own.origin;
      } catch {
        // No address set.
      }
      if (!origin) throw new Error("the site's own address is not set, so a link of the site cannot be made");
      return `${origin}${link}`;
    }
    let url: URL;
    try {
      url = new URL(link);
    } catch {
      throw new Error('a link is an address of the site, or of a host it declared');
    }
    let site = '';
    try {
      site = new URL((await store.site()).url).hostname;
    } catch {
      // No address set.
    }
    if (url.protocol !== 'https:' || !(url.hostname === site || egressAllows(extension.manifest.egress, url.hostname))) throw new Error(`a link leads to the site, or over https to a host it declared (${url.hostname})`);
    return url.href;
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

  const say = (text: string, status: number, headers: Record<string, string> = {}): Response =>
    new Response(text, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'x-content-type-options': 'nosniff', ...headers } });

  /**
   * Answers a visitor at one of an extension's public addresses (ADR 0041),
   * `/_/x/<extension>/<path>`, with what its action gives back: a text, or
   * `{ status, headers, body }`. The action is told the method, the query,
   * the headers but the session's, and the body as text.
   *
   * Sent from one of its blocks (ADR 0062 d6), it is also told which, and the
   * fields as the block declares them, checked. A robot that filled the trap
   * is sent back as if it had been heard, and nothing runs; a field that does
   * not fit sends the visitor back to the block, to `#…-failed`. An answer
   * `{ page: { title, blocks } }` is drawn in the site's layout; no answer
   * sends the visitor back to the block, to `#…-sent`.
   */
  async function route(name: string, path: string, request: Request, draw?: DrawPage): Promise<Response> {
    const extension = (await store.extension(name)) ?? null;
    const found = extension?.enabled ? extension.manifest.routes.find((r) => r.path === path.replace(/\/+$/, '')) : undefined;
    if (!extension || !found) return say('not found\n', 404);
    const method = request.method === 'HEAD' ? 'GET' : request.method;
    if (!found.methods.includes(method as 'GET' | 'POST')) return say(`this address takes ${found.methods.join(' or ')}\n`, 405, { allow: found.methods.join(', ') });
    if (Number(request.headers.get('content-length') ?? 0) > ROUTE_MAX_BYTES) return say('too large\n', 413);
    const body = method === 'POST' ? await request.text() : '';
    if (body.length > ROUTE_MAX_BYTES) return say('too large\n', 413);
    const url = new URL(request.url);
    // Sent from one of its blocks: the form says which, and the block is one that posts here.
    const form = method === 'POST' && /^application\/x-www-form-urlencoded/i.test(request.headers.get('content-type') ?? '') ? new URLSearchParams(body) : null;
    const block = form ? extension.manifest.blocks.find((b) => b.name === form.get('block') && b.route === found.path) : undefined;
    let sent: { block: string; fields: Record<string, unknown> } | null = null;
    let back = '';
    if (form && block) {
      const anchor = /^[A-Za-z0-9_-]{1,40}$/.test(form.get('form') ?? '') ? `#f-${form.get('form')}` : '';
      const to = BACK.test(form.get('back') ?? '') ? (form.get('back') as string) : '/';
      back = `${to}${anchor ? `${anchor}-sent` : ''}`;
      if (form.get('website')) return new Response(null, { status: 303, headers: { location: back } });
      const { fields, problems } = cleanBlockPost(block, form);
      if (problems.length) return new Response(null, { status: 303, headers: { location: `${to}${anchor ? `${anchor}-failed` : ''}` } });
      sent = { block: block.name, fields };
    }
    // The visitor signed in, by id and levels, never the cookie (ADR 0064 d7); null while accounts are off.
    let visitor: { id: string; levels: string[] } | null = null;
    if (accounts) {
      try {
        visitor = await accounts.visitor(request);
      } catch (error) {
        log(`Visitor accounts could not say who is signed in: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const input = {
      method,
      path: found.path,
      query: Object.fromEntries(url.searchParams),
      headers: Object.fromEntries([...request.headers].filter(([key]) => !UNSAID.has(key.toLowerCase()))),
      body,
      visitor,
      ...(sent ?? {}),
    };
    let answer: unknown;
    try {
      answer = await run(name, found.action, input);
    } catch (error) {
      log(`${extension.manifest.displayName} could not answer /_/x/${name}/${found.path}: ${error instanceof Error ? error.message : String(error)}`);
      return say('the extension could not answer\n', 502);
    }
    if (typeof answer === 'string') return say(answer, 200);
    if (sent && (answer === undefined || answer === null)) return new Response(null, { status: 303, headers: { location: back } });
    // A page, drawn in the site's layout, in the visitor's language (ADR 0062 d6).
    const page = answer && typeof answer === 'object' ? (answer as { page?: unknown }).page : undefined;
    if (page && typeof page === 'object' && draw) {
      const asked = (url.searchParams.get('l') ?? '').toLowerCase();
      const html = await draw(page as { title: unknown; blocks: unknown }, /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/.test(asked) ? asked : '');
      if (html !== null) return new Response(method === 'GET' && request.method === 'HEAD' ? null : html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
    }
    const given = (answer ?? {}) as { status?: unknown; headers?: unknown; body?: unknown };
    const status = Number.isInteger(given.status) && (given.status as number) >= 200 && (given.status as number) <= 599 ? (given.status as number) : 200;
    const asked = given.headers && typeof given.headers === 'object' ? (given.headers as Record<string, unknown>) : {};
    const headers: Record<string, string> = { 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' };
    for (const [key, value] of Object.entries(asked)) if (SAID.includes(key.toLowerCase()) && typeof value === 'string' && !/[\r\n]/.test(value)) headers[key.toLowerCase()] = value;
    const text = typeof given.body === 'string' ? given.body : given.body === undefined || given.body === null ? '' : JSON.stringify(given.body);
    headers['content-type'] ??= typeof given.body === 'string' || text === '' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8';
    return new Response(status === 204 || status === 304 ? null : text, { status, headers });
  }

  /** Runs each job that is due (ADR 0041), once across every clock on this database. What failed is said, and tried again at its next time. */
  async function jobs(now = new Date()): Promise<string[]> {
    const ran: Promise<string | null>[] = [];
    for (const extension of await store.extensions()) {
      if (!extension.enabled) continue;
      for (const job of extension.manifest.jobs) {
        if (!(await store.claimJob(extension.manifest.name, job.action, job.everyMinutes, now))) continue;
        ran.push(
          run(extension.manifest.name, job.action, { at: now.toISOString() }).then(
            () => `${extension.manifest.name}.${job.action}`,
            (error: unknown) => {
              log(`${extension.manifest.displayName} could not do "${job.action}": ${error instanceof Error ? error.message : String(error)}`);
              return null;
            },
          ),
        );
      }
    }
    return (await Promise.all(ran)).filter((x): x is string => x !== null);
  }

  /** Tells each extension that listens what happened. What one does with it is its own; a failure is said and goes no further. */
  async function deliver(event: SiteEvent): Promise<void> {
    const told: Promise<unknown>[] = [];
    for (const extension of await store.extensions()) {
      if (!extension.enabled) continue;
      for (const listener of extension.manifest.events.filter((e) => e.on === event.name)) {
        told.push(
          run(extension.manifest.name, listener.action, { event: event.name, ...event.data }).catch((error: unknown) =>
            log(`${extension.manifest.displayName} could not take ${event.name}: ${error instanceof Error ? error.message : String(error)}`),
          ),
        );
      }
    }
    await Promise.all(told);
  }

  /**
   * Asks the extensions that answer a question (ADR 0062 d3) and waits, at
   * most ANSWER_SECONDS, for each. What one does not answer, or answers with
   * what the question does not take, is said and left out: the program then
   * does what it does without it.
   */
  async function ask(question: Question, input: Record<string, unknown>): Promise<string[]> {
    const allowed: readonly string[] = QUESTIONS[question];
    const asked: Promise<string | null>[] = [];
    for (const extension of await store.extensions()) {
      if (!extension.enabled) continue;
      const answering = extension.manifest.answers.find((a) => a.question === question);
      if (!answering) continue;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const late = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(`no answer within ${ANSWER_SECONDS} seconds`)), ANSWER_SECONDS * 1000)));
      asked.push(
        Promise.race([run(extension.manifest.name, answering.action, { question, ...input }), late])
          .then((answer) => {
            if (typeof answer === 'string' && allowed.includes(answer)) return answer;
            throw new Error(`"${String(answer).slice(0, 40)}" is not one of ${allowed.join(', ')}`);
          })
          .catch((error: unknown) => {
            log(`${extension.manifest.displayName} did not answer ${question}: ${error instanceof Error ? error.message : String(error)}`);
            return null;
          })
          .finally(() => timer && clearTimeout(timer)),
      );
    }
    return (await Promise.all(asked)).filter((a): a is string => a !== null);
  }

  /** Which events an extension that is on listens to, asked at most once in LISTENING_MS. */
  let listening: { at: number; names: Promise<Set<string>> } | null = null;
  async function listens(event: ExtensionEventName): Promise<boolean> {
    if (!listening || Date.now() - listening.at >= LISTENING_MS) {
      const names = store
        .extensions()
        .then((all) => new Set(all.filter((e) => e.enabled).flatMap((e) => e.manifest.events.map((l) => l.on as string))))
        .catch(() => new Set<string>());
      listening = { at: Date.now(), names };
    }
    return (await listening.names).has(event);
  }

  return {
    offer,
    install,
    run,
    route,
    jobs,
    deliver,
    listens,
    ask,
    /** What visitor accounts lend extensions (ADR 0064 d7), from the runtime that serves them. */
    lend(given: AccountsLent): void {
      accounts = given;
    },
    /** From now on, what happens in the site is told to the extensions that listen. Returns how to stop. */
    listen(): () => void {
      return store.onEvent((event) => void deliver(event));
    },
    /** Turns an extension on or off; off, its process stops. */
    async enable(name: string, enabled: boolean): Promise<void> {
      await store.enableExtension(name, enabled);
      listening = null;
      if (!enabled) stop(name);
    },
    async uninstall(name: string): Promise<void> {
      stop(name);
      listening = null;
      await store.uninstallExtension(name);
      // The owner's words for its messages go with it, as what it kept does.
      const templates = normalizeTemplates(await store.mailTemplates());
      const left = withoutExtension(templates, name);
      if (JSON.stringify(left) !== JSON.stringify(templates)) await store.setMailTemplates(left);
    },
    /** Stops every extension's process. */
    close(): void {
      for (const name of [...running.keys()]) stop(name);
    },
  };
}

export type ExtensionHostApi = ReturnType<typeof extensionHost>;

/** At most this many items in one batch (ADR 0062 d2); more are told in more batches. */
export const BATCH_MAX = 1000;
/** What waits while a listener is still taking the last batch; beyond it, the rest is dropped and said. */
export const WAITING_MAX = 10_000;
/** How often what was gathered is told. */
export const BATCH_MS = 5_000;

/**
 * Tells the events that come with every visit in batches (ADR 0062 d2): a
 * visit does not wake an extension. Each of the site's processes gathers its
 * own; one batch of an event is told at a time, and what comes meanwhile waits.
 */
export function batches(host: Pick<ExtensionHostApi, 'deliver' | 'listens'>, options: { everyMs?: number; log?: (line: string) => void } = {}) {
  const log = options.log ?? ((line: string) => console.error(line));
  const gathered = new Map<ExtensionEventName, Record<string, unknown>[]>();
  const dropped = new Map<ExtensionEventName, number>();
  const telling = new Map<ExtensionEventName, Promise<void>>();

  async function tell(event: ExtensionEventName): Promise<void> {
    const items = gathered.get(event) ?? [];
    if (!items.length || telling.has(event)) return;
    gathered.set(event, []);
    const lost = dropped.get(event) ?? 0;
    dropped.delete(event);
    if (lost) log(`${lost} of ${event} were not told: the extensions that listen did not keep up`);
    const told = (async () => {
      for (let at = 0; at < items.length; at += BATCH_MAX) await host.deliver({ name: event, data: { items: items.slice(at, at + BATCH_MAX) } });
    })()
      .catch((error: unknown) => log(`${event} could not be told: ${error instanceof Error ? error.message : String(error)}`))
      .finally(() => telling.delete(event));
    telling.set(event, told);
    await told;
  }

  const flush = async (): Promise<void> => {
    await Promise.all([...gathered.keys()].map((event) => tell(event)));
  };
  const timer = setInterval(() => void flush(), options.everyMs ?? BATCH_MS);
  (timer as { unref?: () => void }).unref?.();

  return {
    /** Whether an extension that is on listens: while none does, nothing is worked out for it. */
    listens: (event: ExtensionEventName) => host.listens(event),
    /** Gathers one item, to be told with the next batch. */
    add(event: ExtensionEventName, item: Record<string, unknown>): void {
      const items = gathered.get(event) ?? [];
      if (items.length >= WAITING_MAX) {
        dropped.set(event, (dropped.get(event) ?? 0) + 1);
        return;
      }
      items.push(item);
      gathered.set(event, items);
    },
    flush,
    /** Tells what is left, then gathers no more by itself. */
    async stop(): Promise<void> {
      clearInterval(timer);
      await Promise.all([...telling.values()]);
      await flush();
    },
  };
}

export type Batches = ReturnType<typeof batches>;

/**
 * The published pages and entries, newest first (ADR 0062 d4): each with its
 * address, title, description, language, type and date. A page behind a
 * password or for members is not one of them; nor is anything in draft.
 */
export async function publishedFor(store: Store): Promise<{ address: string; title: string; description: string; language: string; type: string; date: string }[]> {
  const site = await store.site();
  const locked = new Set(await store.lockedPages());
  // Nor is what is only for members (ADR 0064 d4).
  const audiences = await store.audiences();
  const times = await store.publishedTimes();
  const out: { address: string; title: string; description: string; language: string; type: string; date: string }[] = [];
  for (const page of await store.published()) {
    if (locked.has(page.of) || locked.has(page.slug) || audiences.pages[page.of]) continue;
    out.push({ address: pagePath(page.slug), title: page.title, description: page.description, language: page.language, type: 'page', date: (times.pages[page.of] ?? '').slice(0, 10) });
  }
  for (const type of contentTypes(site)) {
    if (audiences.types[type.id]) continue;
    for (const entry of await store.publishedEntries(type.id)) {
      if (audiences.entries[`${type.id}/${entry.slug}`]) continue;
      for (const language of [site.language, ...site.languages.filter((l) => l !== site.language)]) {
        const shown = language === site.language ? entry : entryIn(site, type, entry, language);
        if (!shown) continue;
        out.push({ address: entryPath(typeIn(site, type, language), shown.slug), title: shown.title, description: shown.description, language, type: type.id, date: entry.date });
      }
    }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || a.address.localeCompare(b.address));
}
