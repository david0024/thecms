/**
 * The site's runtime (ADR 0037 d2, ADR 0038): the published site and what
 * cannot be static, from one address. The pages are the files the export
 * writes, served from memory; what a visitor sends goes under `/_/`. A site
 * that needs nothing dynamic can still be exported to any host instead.
 */
import { timingSafeEqual } from 'node:crypto';
import type { Mailer } from './mail.ts';
import { lockOf, publishedSite } from './export.ts';
import { lockCookie, lockedPage } from './locks.ts';
import { startClock } from './clock.ts';
import { type ExtensionHostApi, extensionHost, type Spawn } from './extensions.ts';
import { startForms } from './forms.ts';
import { resultsPage, search, SEARCH_MAX_QUERY, type SearchDoc, searchIndex } from './search.ts';
import type { Store } from './store.ts';

export interface Runtime {
  url: string;
  port: number;
  fetch: (request: Request, ip?: string) => Promise<Response>;
  stop: () => void;
}

/** How long a built site is served before the store is read again: a publication shows within this. */
export const FRESH_MS = 5000;

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

/** The export's files no visitor is served: the lists a host reads, and the export's own marker. */
const HIDDEN = new Set(['_redirects', '.htaccess']);

/** The published site needs no script and loads nothing from elsewhere: the page says so to the browser. */
const HEADERS = {
  'content-security-policy': "default-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; base-uri 'none'; frame-ancestors 'none'",
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
  } = {},
): Runtime {
  const now = options.now ?? Date.now;
  // The extensions' routes, jobs and events (ADR 0041): their code runs apart, as in the editor.
  const extensions: ExtensionHostApi = extensionHost(store, { spawn: options.spawnExtension, log: options.log });
  const forms = startForms(store, { listen: false, mailer: options.mailer, to: options.to, from: options.from, log: options.log });
  let built: { at: number; files: Promise<Map<string, string | Uint8Array>> } | null = null;

  /** The published site, built again once it is older than FRESH_MS. A site with nothing published yet is no site. */
  const site = (): Promise<Map<string, string | Uint8Array>> => {
    if (!built || now() - built.at >= FRESH_MS) {
      const files = publishedSite(store).catch(() => new Map<string, string | Uint8Array>());
      built = { at: now(), files };
    }
    return built.files;
  };

  /** Passwords a visitor may try in a window: enough for a person, too few to guess one. */
  const tries = new Map<string, number[]>();
  const tooMany = (ip: string): boolean => {
    const at = now();
    const recent = (tries.get(ip) ?? []).filter((t) => at - t < 10 * 60_000);
    tries.set(ip, recent);
    if (recent.length >= 10) return true;
    recent.push(at);
    return false;
  };
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
    if (routed) return extensions.route(routed[1] as string, routed[2] as string, request);
    if (url.pathname === '/_/unlock' && request.method === 'POST') {
      // A password given for a page behind one (ADR 0043): right, and the visitor keeps its key; wrong, and they are told.
      if (Number(request.headers.get('content-length') ?? 0) > 4096) return new Response('too large\n', { status: 413 });
      const fields = new URLSearchParams((await request.text()).slice(0, 4096));
      const back = /^\/(?!\/)[^\s\\#?]*$/.test(fields.get('back') ?? '') ? (fields.get('back') as string) : '/';
      const files = await site();
      const body = files.get(back.endsWith('/') ? `${back.slice(1)}index.html` : back.slice(1));
      const slug = typeof body === 'string' ? lockOf(body) : null;
      const key = slug !== null && !tooMany(ip || 'unknown') ? await store.unlockPage(slug, fields.get('password') ?? '') : null;
      if (slug === null || key === null) return new Response(null, { status: 303, headers: { location: `${back}#locked-wrong` } });
      const secure = url.protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https';
      return new Response(null, {
        status: 303,
        headers: { location: back, 'set-cookie': `${lockCookie(slug)}=${key}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure ? '; Secure' : ''}` },
      });
    }
    if (url.pathname === '/_/search' && (request.method === 'GET' || request.method === 'HEAD')) {
      const files = await site();
      const frame = files.get('404.html');
      if (typeof frame !== 'string') return new Response('nothing is published yet\n', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
      const index = indexes.get(files) ?? searchIndex(files);
      indexes.set(files, index);
      const query = (url.searchParams.get('q') ?? '').trim().slice(0, SEARCH_MAX_QUERY);
      const language = /<html lang="([^"]+)"/.exec(frame)?.[1] ?? 'en';
      const page = file('search.html', resultsPage(frame, language, query, search(index, query)));
      page.headers.set('cache-control', 'no-store');
      return page;
    }
    if (url.pathname === '/_' || url.pathname === '/_/') return new Response('thecms runtime\n', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
    if (url.pathname.startsWith('/_/')) return new Response('not found\n', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('a page is read with GET\n', { status: 405, headers: { allow: 'GET, HEAD' } });

    const files = await site();
    let path: string;
    try {
      path = decodeURIComponent(url.pathname).slice(1);
    } catch {
      path = '\0';
    }
    if (path.split('/').some((part) => part === '..' || part.startsWith('.')) || HIDDEN.has(path)) path = '\0';
    const own = path === '' || path.endsWith('/') ? `${path}index.html` : path;
    const body = files.get(own);
    // An old address the export keeps answers here with a real 301, as Cloudflare and Apache do with its lists (ADR 0036).
    const moved = typeof body === 'string' ? /<meta http-equiv="refresh" content="0; url=([^"]+)">/.exec(body)?.[1] : undefined;
    if (moved) return new Response(null, { status: 301, headers: { location: moved.replaceAll('&amp;', '&') } });
    const locked = typeof body === 'string' ? lockOf(body) : null;
    if (locked !== null) {
      // Behind a password: shown only to a visitor holding its key, and kept by no cache in between.
      const key = await store.pageKey(locked);
      const given = Buffer.from(cookieOf(request, lockCookie(locked)));
      const opened = key !== null && given.length === key.length && timingSafeEqual(given, Buffer.from(key));
      const page = opened ? file(own, body as string) : file(own, lockedPage(String(files.get('404.html')), url.pathname), 403);
      page.headers.set('cache-control', 'private, no-store');
      return page;
    }
    if (body !== undefined) return file(own, body);
    // An address without its last slash leads to the page that has one.
    if (files.has(`${path}/index.html`)) return new Response(null, { status: 301, headers: { location: `${url.pathname}/${url.search}` } });
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
  const clock = startClock(store, { run: server !== null, log: options.log, jobs: extensions.jobs });
  const unlisten = extensions.listen();
  return {
    url: `http://${options.hostname ?? '127.0.0.1'}:${port}`,
    port,
    fetch: handle,
    stop: () => {
      clock.stop();
      unlisten();
      extensions.close();
      server?.stop(true);
    },
  };
}
