/**
 * The editing server: `thecms edit site.db`. It serves the admin, the canvas
 * the admin edits on, and a small JSON API over the store.
 *
 * It is a tool for one person on their own computer, so it listens on
 * 127.0.0.1 only. That is not enough on its own: any web page that person has
 * open can send requests to localhost. So every API call must carry a token
 * that only the admin page was given, must name this server as its host (a
 * page that points its own domain at 127.0.0.1 does not), and must not come
 * from another origin. Accounts and sign-in arrive with the hosted server;
 * until then nothing here is reachable without the token.
 */
import { readdir } from 'node:fs/promises';
import { compile } from 'svelte/compiler';
import { normalizePage, parseTheme, type Theme, themeCss } from '../core/index.ts';
import { renderParts } from './document.ts';
import type { Store } from './store.ts';

const ADMIN = new URL('../admin/', import.meta.url);
const THEMES = new URL('../../themes/', import.meta.url);
const BASE_CSS = new URL('../blocks/base.css', import.meta.url);

/** The admin and the canvas script, built for a browser from their sources. */
export async function buildAdmin(): Promise<Map<string, string>> {
  const result = await Bun.build({
    entrypoints: [new URL('main.ts', ADMIN).pathname, new URL('frame.ts', ADMIN).pathname],
    target: 'browser',
    conditions: ['browser'],
    plugins: [
      {
        name: 'svelte-client',
        setup(build) {
          build.onLoad({ filter: /\.svelte$/ }, async ({ path }) => {
            const source = await Bun.file(path).text();
            const { js } = compile(source, { filename: path, generate: 'client', css: 'injected', dev: false });
            return { contents: js.code, loader: 'js' };
          });
        },
      },
    ],
  });
  if (!result.success) throw new AggregateError(result.logs, 'the admin did not build');
  const files = new Map<string, string>();
  for (const output of result.outputs) {
    const name = output.path.replace(/^.*[\\/]/, '').replace(/^main\.js$/, 'app.js');
    files.set(name, await output.text());
  }
  return files;
}

/** The themes that ship with the CMS, for the theme picker. */
export async function bundledThemes(): Promise<Theme[]> {
  const themes: Theme[] = [];
  for (const file of (await readdir(THEMES)).filter((f) => f.endsWith('.json')).sort()) {
    const { theme } = parseTheme(await Bun.file(new URL(file, THEMES)).json());
    if (theme) themes.push(theme);
  }
  return themes;
}

const CSP = "default-src 'self'; img-src 'self' http: https: data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'";
const SECURITY = { 'content-security-policy': CSP, 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'cache-control': 'no-store' };

const html = (body: string): Response => new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8', ...SECURITY } });
const text = (body: string, type: string): Response => new Response(body, { headers: { 'content-type': `${type}; charset=utf-8`, ...SECURITY } });
const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...SECURITY } });

const ADMIN_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>thecms</title>
</head>
<body>
<div id="app"></div>
<script type="module" src="/admin/app.js"></script>
</body>
</html>
`;

const previewPage = (language: string): string => `<!doctype html>
<html lang="${language.replace(/[^A-Za-z0-9-]/g, '')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="/assets/site.css" id="cms-theme">
<style id="cms-own"></style>
</head>
<body>
<div id="cms-root"></div>
<script type="module" src="/admin/frame.js"></script>
</body>
</html>
`;

function sameToken(given: string | null, token: string): boolean {
  if (!given || given.length !== token.length) return false;
  let diff = 0;
  for (let i = 0; i < token.length; i++) diff |= given.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0;
}

export interface EditorServer {
  /** The address to open, token included. */
  url: string;
  token: string;
  port: number;
  /** One request, answered without a network: what the tests call. */
  fetch: (request: Request) => Promise<Response>;
  stop: () => void;
}

export async function startEditor(store: Store, options: { port?: number; listen?: boolean } = {}): Promise<EditorServer> {
  const assets = await buildAdmin();
  const themes = await bundledThemes();
  const baseCss = await Bun.file(BASE_CSS).text();
  const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
  let port = options.port ?? 4321;

  const theme = (): Theme => {
    const current = store.theme();
    if (!current) throw new Error('this site has no theme yet');
    return current;
  };
  const menu = (): { title: string; slug: string }[] =>
    store.pages().map((p) => ({ title: p.title, slug: p.slug, inMenu: store.draft(p.slug)?.inMenu !== false }))
      .filter((p) => p.inMenu)
      .map(({ title, slug }) => ({ title, slug }));
  const state = (): unknown => ({ site: store.site(), theme: theme(), themes, pages: store.pages() });

  async function api(request: Request, url: URL): Promise<Response> {
    const body = request.method === 'GET' || request.method === 'DELETE' ? {} : ((await request.json()) as Record<string, unknown>);
    const slug = url.searchParams.get('slug') ?? '';
    const route = `${request.method} ${url.pathname}`;
    switch (route) {
      case 'GET /api/state':
        return json(state());
      case 'GET /api/page': {
        const page = store.draft(slug);
        return page ? json({ page }) : json({ error: 'no such page' }, 404);
      }
      case 'PUT /api/page': {
        const { page, issues } = normalizePage(body.page);
        if (!page.title) return json({ error: 'a page has a title', issues }, 400);
        // A new page may not silently replace an existing one.
        if (body.create === true && store.draft(page.slug)) return json({ error: 'a page with this address already exists' }, 409);
        return json({ page: store.savePage(page), issues, pages: store.pages() });
      }
      case 'DELETE /api/page':
        store.deletePage(slug);
        return json({ pages: store.pages() });
      case 'POST /api/publish':
        store.publish(String(body.slug ?? ''));
        return json({ pages: store.pages() });
      case 'POST /api/render': {
        // Drawn from what the admin holds, cleaned first: the canvas shows what would be saved.
        const { page } = normalizePage(body.page);
        return json(renderParts(store.site(), theme(), page, menu(), true));
      }
      case 'PUT /api/theme':
        store.setTheme(body.theme);
        return json(state());
      case 'PUT /api/site':
        store.setSite(body.site);
        return json(state());
      default:
        return json({ error: 'not found' }, 404);
    }
  }

  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    // A page that points its own domain at 127.0.0.1 arrives with its own host name.
    const host = request.headers.get('host') ?? url.host;
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return json({ error: 'wrong host' }, 403);

    if (url.pathname.startsWith('/api/')) {
      const origin = request.headers.get('origin');
      if (origin && origin !== `http://${host}`) return json({ error: 'wrong origin' }, 403);
      if (!sameToken(request.headers.get('x-thecms-token'), token)) return json({ error: 'no token' }, 401);
      try {
        return await api(request, url);
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : String(error) }, 400);
      }
    }
    if (request.method !== 'GET') return json({ error: 'not found' }, 404);
    switch (url.pathname) {
      case '/':
      case '/admin':
        return new Response(null, { status: 302, headers: { location: '/admin/' } });
      case '/admin/':
        return html(ADMIN_PAGE);
      case '/admin/app.js':
      case '/admin/frame.js':
        return text(assets.get(url.pathname.slice(7)) ?? '', 'text/javascript');
      case '/preview':
        return html(previewPage(store.site().language));
      case '/assets/site.css':
        return text(`${themeCss(theme())}${baseCss}`, 'text/css');
      default:
        return json({ error: 'not found' }, 404);
    }
  }

  const server = options.listen === false ? null : Bun.serve({ hostname: '127.0.0.1', port, fetch: handle });
  if (server?.port) port = server.port;
  return {
    url: `http://127.0.0.1:${port}/admin/#token=${token}`,
    token,
    port,
    fetch: handle,
    stop: () => server?.stop(true),
  };
}
