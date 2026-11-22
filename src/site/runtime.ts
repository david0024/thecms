/**
 * The site's runtime (ADR 0038, ADR 0044): the published site and what cannot
 * be static, from one address. The pages are the files the export writes,
 * built once for each version of the site and kept where the site's processes
 * share them (Valkey on a server); what a visitor sends goes under `/_/`.
 */
import { timingSafeEqual } from 'node:crypto';
import type { Mailer } from './mail.ts';
import { lockOf, publishedSite } from './export.ts';
import { mediaResponse } from './serve-media.ts';
import { EMBED_ORIGINS, mediaKindOf } from '../core/index.ts';
import { lockCookie, lockedPage } from './locks.ts';
import { startClock } from './clock.ts';
import { type Batches, batches, type DrawPage, type ExtensionHostApi, extensionHost, type Spawn } from './extensions.ts';
import { routePage } from './route-page.ts';
import { startForms } from './forms.ts';
import { localShared, type Shared } from './shared.ts';
import { resultsPage, search, SEARCH_MAX_QUERY, type SearchDoc, searchIndex } from './search.ts';
import { visits as countVisits, type Visits } from './stats.ts';
import type { Store } from './store.ts';

export interface Runtime {
  url: string;
  port: number;
  fetch: (request: Request, ip?: string) => Promise<Response>;
  /** What the runtime counts for the statistics (ADR 0053). */
  visits: Visits;
  /** What visits tell the extensions that listen, in batches (ADR 0062 d2). */
  told: Batches;
  stop: () => void;
}

/**
 * How often the store is asked whether anything visitors see has changed: a
 * publication shows within this. Nothing changed, nothing is built again: the
 * pages are served as they were made (ADR 0044).
 */
export const FRESH_MS = 1000;

/** How long a built page is kept where the processes share it: a version nobody asks for any more is gone after this. */
export const PAGE_MS = 3_600_000;

const TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  json: 'application/json; charset=utf-8',
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
};

/** What robots ask every site for, to find another software's weak spots: not worth showing the owner. */
const PROBE = /\.(php|asp|aspx|jsp|cgi|env|ini|sql|bak|ya?ml)$|^\/(wp-|\.|cgi-bin|xmlrpc|phpmyadmin|vendor\/)/i;

/** Where a visitor came from to an address not found: the page's host and path, without what follows them. */
const refererOf = (request: Request): string => {
  try {
    const from = new URL(request.headers.get('referer') ?? '');
    return `${from.host}${from.pathname}`.slice(0, 255);
  } catch {
    return '';
  }
};

/** The export's files no visitor is served: the lists a host reads, and the export's own marker. */
const HIDDEN = new Set(['_redirects', '.htaccess']);

/** The published site needs no script and loads nothing from elsewhere: the page says so to the browser. */
const HEADERS = {
  // Sound and video from the site itself; players only from the services a page may show (ADR 0047).
  'content-security-policy': `default-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; media-src 'self'; frame-src ${EMBED_ORIGINS.join(' ')}; base-uri 'none'; frame-ancestors 'none'`,
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
};

export function startRuntime(
  store: Store,
  options: {
    port?: number;
    listen?: boolean;
    hostname?: string;
    mailer?: Mailer | null;
    to?: string;
    from?: string;
    log?: (line: string) => void;
    now?: () => number;
    spawnExtension?: Spawn;
    /** The extensions of the editor this runtime is part of, which hears the site's events and runs their jobs itself. */
    extensions?: ExtensionHostApi;
    /** What the site's processes share (ADR 0044 d4); this process alone when not given. */
    shared?: Shared;
  } = {},
): Runtime {
  const now = options.now ?? Date.now;
  const shared = options.shared ?? localShared({ now });
  // The extensions' routes, jobs and events (ADR 0041): their code runs apart, as in the editor.
  const own = !options.extensions;
  const extensions: ExtensionHostApi = options.extensions ?? extensionHost(store, { spawn: options.spawnExtension, log: options.log });
  // The statistics (ADR 0053): a page counted as it is sent, apart from everything else here.
  // What every visit tells the extensions that listen, gathered and told in batches (ADR 0062 d2).
  const told = batches(extensions, { log: options.log });
  const visits = countVisits(store, shared, { now, log: options.log, told });
  const forms = startForms(store, { listen: false, mailer: options.mailer, to: options.to, from: options.from, log: options.log, shared, ask: extensions.ask });
  type Files = Map<string, string | Uint8Array>;
  let built: { version: string; files: Promise<Files>; ready: boolean } | null = null;
  let asked: { at: number; version: Promise<string> } | null = null;

  /** The site's version, asked at most once in FRESH_MS. */
  const version = (): Promise<string> => {
    if (!asked || now() - asked.at >= FRESH_MS) asked = { at: now(), version: store.siteVersion() };
    return asked.version;
  };

  /** The published site, built again only when what visitors see has changed. A site with nothing published yet is no site. */
  const site = async (): Promise<Files> => {
    const at = await version();
    if (!built || built.version !== at) {
      const made: { version: string; files: Promise<Files>; ready: boolean } = { version: at, files: publishedSite(store, true).catch(() => new Map() as Files), ready: false };
      built = made;
      void made.files.then(async (files) => {
        made.ready = true;
        // Kept where the other processes find it, so they serve this version without building it.
        const pages = [...files].filter((entry): entry is [string, string] => typeof entry[1] === 'string');
        for (let i = 0; i < pages.length; i += 50) await Promise.all(pages.slice(i, i + 50).map(([path, body]) => shared.set(`page:${at}:${path}`, body, PAGE_MS)));
      });
    }
    return built.files;
  };

  /** One file of the published site: from this process's build once it has one, before that from what the processes share. */
  const fileOf = async (path: string): Promise<string | Uint8Array | undefined> => {
    const at = await version();
    if (!(built?.version === at && built.ready)) {
      const kept = await shared.get(`page:${at}:${path}`);
      if (kept !== null) return kept;
    }
    return (await site()).get(path);
  };

  /** What an extension's route answers as a page (ADR 0062 d6), in the frame of the site's pages in that language. */
  const drawPage: DrawPage = async (page, language) => {
    const files = await site();
    const own = language ? files.get(`${language}/404.html`) : undefined;
    const frame = typeof own === 'string' ? own : files.get('404.html');
    const theme = await store.publishedTheme();
    if (typeof frame !== 'string' || !theme) return null;
    return routePage(frame, { ...(await store.site()), formDefs: await store.formsByName(), extensionBlocks: await store.extensionBlocks() }, theme, page);
  };

  /** Passwords a visitor may try in a window: enough for a person, too few to guess one. */
  const tooMany = async (ip: string): Promise<boolean> => (await shared.hit(`unlock:${ip}`, 10 * 60_000)) > 10;
  const cookieOf = (request: Request, name: string): string => {
    for (const part of (request.headers.get('cookie') ?? '').split(';')) {
      const [key, ...value] = part.trim().split('=');
      if (key === name) return value.join('=');
    }
    return '';
  };

  /** What search reads, made once for each build of the site. */
  const indexes = new WeakMap<Map<string, string | Uint8Array>, SearchDoc[]>();

  const file = (path: string, body: string | Uint8Array, status = 200): Response =>
    new Response(body as BodyInit, {
      status,
      headers: {
        'content-type': TYPES[path.split('.').pop() ?? ''] ?? 'application/octet-stream',
        // A stored image is named by its bytes, so it never changes; a page may change at the next publication.
        'cache-control': path.startsWith('media/') ? 'public, max-age=31536000, immutable' : 'public, max-age=0, must-revalidate',
        // The site's data is for apps and other sites to read, from wherever they run (ADR 0057 d3).
        ...(path.endsWith('.json') ? { 'access-control-allow-origin': '*' } : {}),
        ...HEADERS,
      },
    });

  async function handle(request: Request, ip = ''): Promise<Response> {
    const url = new URL(request.url);
    // What cannot be static has its own addresses, under /_/.
    if (url.pathname === '/_/send' || url.pathname === '/_/comment') {
      const inner = new URL(request.url);
      inner.pathname = url.pathname.slice(2);
      return forms.fetch(new Request(inner, request), ip);
    }
    // An extension's own addresses: /_/x/<extension>/<path>.
    const routed = /^\/_\/x\/([a-z][a-z0-9-]{1,39})\/(.+)$/.exec(url.pathname);
    if (routed) {
      const answered = await extensions.route(routed[1] as string, routed[2] as string, request, drawPage);
      // A page it answers with is a page of the site, with the site's rules (ADR 0062 d6).
      if (answered.headers.get('content-type')?.startsWith('text/html')) for (const [key, value] of Object.entries(HEADERS)) answered.headers.set(key, value);
      return answered;
    }
    if (url.pathname === '/_/unlock' && request.method === 'POST') {
      // A password given for a page behind one (ADR 0043): right, and the visitor keeps its key; wrong, and they are told.
      if (Number(request.headers.get('content-length') ?? 0) > 4096) return new Response('too large\n', { status: 413 });
      const fields = new URLSearchParams((await request.text()).slice(0, 4096));
      const back = /^\/(?!\/)[^\s\\#?]*$/.test(fields.get('back') ?? '') ? (fields.get('back') as string) : '/';
      const body = await fileOf(back.endsWith('/') ? `${back.slice(1)}index.html` : back.slice(1));
      const slug = typeof body === 'string' ? lockOf(body) : null;
      const key = slug !== null && !(await tooMany(ip || 'unknown')) ? await store.unlockPage(slug, fields.get('password') ?? '') : null;
      if (slug === null || key === null) return new Response(null, { status: 303, headers: { location: `${back}#locked-wrong` } });
      const secure = url.protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https';
      return new Response(null, {
        status: 303,
        headers: { location: back, 'set-cookie': `${lockCookie(slug)}=${key}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure ? '; Secure' : ''}` },
      });
    }
    if (url.pathname === '/_/search' && (request.method === 'GET' || request.method === 'HEAD')) {
      const files = await site();
      const main = files.get('404.html');
      if (typeof main !== 'string') return new Response('nothing is published yet\n', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
      const index = indexes.get(files) ?? searchIndex(files);
      indexes.set(files, index);
      const query = (url.searchParams.get('q') ?? '').trim().slice(0, SEARCH_MAX_QUERY);
      void visits.searched(request, query).catch(() => {});
      // Asked from a page in another language: answered in it, with its pages, in its frame (ADR 0054).
      const asked = (url.searchParams.get('l') ?? '').toLowerCase();
      const own = /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/.test(asked) ? files.get(`${asked}/404.html`) : undefined;
      const frame = typeof own === 'string' ? own : main;
      const language = /<html lang="([^"]+)"/.exec(frame)?.[1] ?? 'en';
      const page = file('search.html', resultsPage(frame, language, query, search(index.filter((doc) => doc.language === language), query), typeof own === 'string' ? asked : ''));
      page.headers.set('cache-control', 'no-store');
      return page;
    }
    if (url.pathname === '/_' || url.pathname === '/_/') return new Response('thecms runtime\n', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
    if (url.pathname.startsWith('/_/')) return new Response('not found\n', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('a page is read with GET\n', { status: 405, headers: { allow: 'GET, HEAD' } });

    let path: string;
    try {
      path = decodeURIComponent(url.pathname).slice(1);
    } catch {
      path = '\0';
    }
    if (path.split('/').some((part) => part === '..' || part.startsWith('.')) || HIDDEN.has(path)) path = '\0';
    const own = path === '' || path.endsWith('/') ? `${path}index.html` : path;
    const body = await fileOf(own);
    // An old address the export keeps answers here with a real 301, as Cloudflare and Apache do with its lists (ADR 0036).
    const moved = typeof body === 'string' ? /<meta http-equiv="refresh" content="0; url=([^"]+)">/.exec(body)?.[1] : undefined;
    if (moved) return new Response(null, { status: 301, headers: { location: moved.replaceAll('&amp;', '&') } });
    const locked = typeof body === 'string' ? lockOf(body) : null;
    if (locked !== null) {
      // Behind a password: shown only to a visitor holding its key, and kept by no cache in between.
      const key = await store.pageKey(locked);
      const given = Buffer.from(cookieOf(request, lockCookie(locked)));
      const opened = key !== null && given.length === key.length && timingSafeEqual(given, Buffer.from(key));
      const page = opened ? file(own, body as string) : file(own, lockedPage(String(await fileOf('404.html')), url.pathname), 403);
      if (opened) void visits.seen(request, ip, url.pathname).catch(() => {});
      page.headers.set('cache-control', 'private, no-store');
      return page;
    }
    // A document, sound or video is read from the library when it is asked for, in the part a player asks for (ADR 0046).
    const stored = /^media\/([^/]+)$/.exec(own)?.[1];
    if (stored && body !== undefined && mediaKindOf(stored) !== 'image') {
      const kept = await store.mediaFile(stored);
      if (kept) return mediaResponse(request, stored, kept, { ...HEADERS, 'cache-control': 'public, max-age=31536000, immutable' });
    }
    if (body !== undefined) {
      if (own.endsWith('.html')) void visits.seen(request, ip, url.pathname).catch(() => {});
      return file(own, body);
    }
    const files = await site();
    // An address without its last slash leads to the page that has one.
    if (files.has(`${path}/index.html`)) return new Response(null, { status: 301, headers: { location: `${url.pathname}/${url.search}` } });
    // The key that proves to IndexNow the site is the one telling it (ADR 0063 d2), only while the owner asks for that.
    const asked = /^\/([a-zA-Z0-9-]{8,128})\.txt$/.exec(url.pathname)?.[1];
    if (asked && (await store.site()).indexNow && asked === (await store.indexNowKey())) return new Response(asked, { headers: { 'content-type': 'text/plain; charset=utf-8', ...HEADERS } });
    // An address the site does not have is noted for the owner, unless it is a robot looking for another software's files (ADR 0063 d1).
    if (request.method === 'GET' && !PROBE.test(url.pathname)) void store.addNotFound(url.pathname, refererOf(request)).catch(() => {});
    const missing = files.get('404.html');
    return missing === undefined ? new Response('nothing is published yet\n', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } }) : file('404.html', missing, 404);
  }

  let port = options.port ?? 4323;
  const server =
    options.listen === false
      ? null
      : Bun.serve({
          hostname: options.hostname ?? '127.0.0.1',
          port,
          fetch: (request, srv) => handle(request, request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || srv.requestIP(request)?.address || ''),
        });
  if (server?.port) port = server.port;
  // The site's clock runs here too: on a server with no editor running, what was set for later is still published (ADR 0039).
  const clock = startClock(store, { run: server !== null, log: options.log, jobs: extensions.jobs, claim: (key, ms) => shared.claim(key, ms) });
  const unlisten = own ? extensions.listen() : () => {};
  return {
    url: `http://${options.hostname ?? '127.0.0.1'}:${port}`,
    port,
    fetch: handle,
    visits,
    told,
    stop: () => {
      void visits.stop().then(() => told.stop());
      clock.stop();
      unlisten();
      if (own) extensions.close();
      server?.stop(true);
    },
  };
}
