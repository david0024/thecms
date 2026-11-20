/**
 * The site's runtime (ADR 0037 d2, ADR 0038): the published site and what
 * cannot be static, from one address. The pages are the files the export
 * writes, served from memory; what a visitor sends goes under `/_/`. A site
 * that needs nothing dynamic can still be exported to any host instead.
 */
import type { Mailer } from './mail.ts';
import { publishedSite } from './export.ts';
import { startForms } from './forms.ts';
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
  options: { port?: number; listen?: boolean; hostname?: string; mailer?: Mailer | null; to?: string; from?: string; log?: (line: string) => void; now?: () => number } = {},
): Runtime {
  const now = options.now ?? Date.now;
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
    if (url.pathname === '/_/send') {
      const inner = new URL(request.url);
      inner.pathname = '/send';
      return forms.fetch(new Request(inner, request), ip);
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
  return { url: `http://${options.hostname ?? '127.0.0.1'}:${port}`, port, fetch: handle, stop: () => server?.stop(true) };
}
