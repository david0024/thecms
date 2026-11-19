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
import { mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { compile } from 'svelte/compiler';
import { type ContentType, defaultTemplate, MEDIA_MAX_BYTES, MEDIA_PREFIX, normalizePage, type Page, type Post, contentTypes, listPath, type MenuList, normalizePost, parseTheme, POSTS_TYPE, reservedSlugs, type Theme, themeCss } from '../core/index.ts';
import type { EntryLists } from '../blocks/editing.ts';
import { type FetchImage, fetchImage as fetchOverNetwork, IMPORT_MAX_BYTES, type ImportReport, runImport } from '../import/run.ts';
import { type ImportPlan, planImport } from '../import/wxr.ts';
import { type MenuItem, menuOf, renderParts, renderPostParts } from './document.ts';
import type { Store } from './store.ts';

const ADMIN = new URL('../admin/', import.meta.url);
const THEMES = new URL('../../themes/', import.meta.url);
const BASE_CSS = new URL('../blocks/base.css', import.meta.url);

/**
 * The admin and the canvas script, built for a browser from their sources.
 *
 * With THECMS_COVERAGE set to a folder, the build also writes its source maps
 * there, and the Svelte compiler's own, so that what the browser ran in the
 * end-to-end tests can be counted against the source lines (tools/coverage.ts).
 */
export async function buildAdmin(coverage = process.env.THECMS_COVERAGE): Promise<Map<string, string>> {
  const svelteMaps: Record<string, unknown> = {};
  const result = await Bun.build({
    entrypoints: [new URL('main.ts', ADMIN).pathname, new URL('frame.ts', ADMIN).pathname],
    target: 'browser',
    conditions: ['browser'],
    sourcemap: coverage ? 'external' : 'none',
    plugins: [
      {
        name: 'svelte-client',
        setup(build) {
          build.onLoad({ filter: /\.svelte$/ }, async ({ path }) => {
            const source = await Bun.file(path).text();
            const { js } = compile(source, { filename: path, generate: 'client', css: 'injected', dev: false });
            if (coverage) svelteMaps[path] = js.map;
            return { contents: js.code, loader: 'js' };
          });
        },
      },
    ],
  });
  if (!result.success) throw new AggregateError(result.logs, 'the admin did not build');
  const files = new Map<string, string>();
  const maps: Record<string, unknown> = {};
  for (const output of result.outputs) {
    const name = output.path.replace(/^.*[\\/]/, '').replace(/^main\.js/, 'app.js');
    if (output.kind === 'sourcemap') maps[name.replace(/\.map$/, '')] = await output.json();
    else files.set(name, await output.text());
  }
  if (coverage) {
    await mkdir(coverage, { recursive: true });
    await Bun.write(join(coverage, 'admin-maps.json'), JSON.stringify({ root: process.cwd(), bundles: maps, svelte: svelteMaps }));
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

/** What an export file would bring, counted, for the owner to look at before anything is written. */
export interface ImportPreview {
  site: { name: string; url: string };
  pages: number;
  posts: number;
  /** The kinds of entry asked for, as content types. */
  types: { id: string; name: string; count: number }[];
  /** Kinds a plugin or theme added that could be brought as content types. */
  others: { type: string; count: number }[];
  /** Categories of posts that could each become a content type (ADR 0016). */
  categories: { nicename: string; name: string; count: number }[];
  images: number;
  redirects: number;
  menu: boolean;
  notes: string[];
}

/** Where an import started from the admin has got to. */
export type ImportProgress =
  | { status: 'idle' }
  | { status: 'running'; done: number; total: number }
  | { status: 'done'; report: ImportReport }
  | { status: 'failed'; error: string };

const preview = (plan: ImportPlan): ImportPreview => ({
  site: { name: plan.site.name, url: plan.site.url },
  pages: plan.pages.length,
  posts: plan.posts.length,
  types: plan.types.map((type) => ({ id: type.id, name: type.name, count: plan.entries[type.id]?.length ?? 0 })),
  others: plan.others,
  categories: plan.categories,
  images: plan.images.length,
  redirects: plan.redirects.length,
  menu: plan.menu !== null,
  notes: plan.notes,
});

export async function startEditor(store: Store, options: { port?: number; listen?: boolean; /** How an import fetches images; the tests give their own. */ fetchImage?: FetchImage } = {}): Promise<EditorServer> {
  const assets = await buildAdmin();
  const themes = await bundledThemes();
  const baseCss = await Bun.file(BASE_CSS).text();
  const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
  let port = options.port ?? 4321;

  const theme = async (): Promise<Theme> => {
    const current = await store.theme();
    if (!current) throw new Error('this site has no theme yet');
    return current;
  };
  type Listed = Awaited<ReturnType<Store['entries']>>;
  /** Each content type's entries, by the type's name. */
  const allEntries = async (): Promise<Record<string, Listed>> => {
    const out: Record<string, Listed> = {};
    for (const type of contentTypes(await store.site())) out[type.id] = await store.entries(type.id);
    return out;
  };
  // The menu as the editor shows it: from the drafts, with each content type as soon as it has an entry.
  const menu = async (): Promise<MenuItem[]> => {
    const site = await store.site();
    const entries = await allEntries();
    return menuOf(
      site,
      await store.pages(),
      contentTypes(site)
        .filter((type) => (entries[type.id]?.length ?? 0) > 0)
        .map((type): MenuList => ({ id: type.id, title: type.name, href: listPath(type) })),
    );
  };
  // What a block that lists entries shows in the editor: the drafts, so a post just written is there.
  const entryLists = async (): Promise<EntryLists> => {
    const out: EntryLists = {};
    for (const type of contentTypes(await store.site())) out[type.id] = { type, entries: await store.draftEntries(type.id) };
    return out;
  };
  /** Every list the admin shows: the pages, and each content type's entries by the type's name. */
  /** Each type's own page (ADR 0015): whether it has one, and whether visitors see what is being worked on. */
  const templates = async (): Promise<Record<string, { custom: boolean; published: boolean; changed: boolean }>> => {
    const out: Record<string, { custom: boolean; published: boolean; changed: boolean }> = {};
    for (const type of contentTypes(await store.site())) {
      const draft = await store.template(type.id);
      const live = await store.publishedTemplate(type.id);
      out[type.id] = { custom: draft !== null, published: live !== null || draft === null, changed: JSON.stringify(draft) !== JSON.stringify(live) };
    }
    return out;
  };
  const lists = async (): Promise<{ pages: Awaited<ReturnType<Store['pages']>>; posts: Listed; entries: Record<string, Listed>; templates: Awaited<ReturnType<typeof templates>> }> => ({
    pages: await store.pages(),
    posts: await store.posts(),
    entries: await allEntries(),
    templates: await templates(),
  });
  /** A type's page as the builder edits it: a page whose blocks are the type's page, named after the type. */
  const templateDoc = async (type: ContentType): Promise<Page> => ({
    slug: type.id,
    title: `${type.singular} page`,
    description: '',
    inMenu: false,
    blocks: (await store.template(type.id)) ?? defaultTemplate(),
  });
  /** What a type's page is drawn with in the builder: its newest entry, or an example when it has none. */
  const sampleEntry = async (type: ContentType): Promise<Post> =>
    (await store.draftEntries(type.id))[0] ??
    normalizePost(
      { slug: 'example', title: `An example ${type.singular.toLowerCase()}`, excerpt: '', blocks: [{ type: 'text', content: { body: [{ type: 'paragraph', children: [{ text: `What a ${type.singular.toLowerCase()} says goes here.` }] }] } }] },
      new Date().toISOString().slice(0, 10),
      type,
    ).post;
  const state = async (): Promise<unknown> => ({ site: await store.site(), theme: await theme(), themeChanged: await store.themeChanged(), themes, ...(await lists()) });

  /** One import at a time; it outlives the request that started it, because copying images takes minutes. */
  let importing: ImportProgress = { status: 'idle' };

  async function importApi(request: Request, url: URL): Promise<Response> {
    if (request.method === 'GET' && url.pathname === '/api/import') return json(importing);
    if (request.method === 'DELETE' && url.pathname === '/api/import') {
      // The report was read: forget it, so the screen starts clean. A running import is not stopped.
      if (importing.status !== 'running') importing = { status: 'idle' };
      return json(importing);
    }
    if (request.method !== 'POST') return json({ error: 'not found' }, 404);
    if (Number(request.headers.get('content-length') ?? 0) > IMPORT_MAX_BYTES) return json({ error: 'the export file is too large' }, 413);
    // The body is the export file itself. It is read and understood before anything is written.
    const listed = (name: string): string[] => (url.searchParams.get(name) ?? '').split(',').map((value) => value.trim()).filter(Boolean);
    const plan = planImport(await request.text(), new Date().toISOString().slice(0, 10), { types: listed('types'), categories: listed('categories') });
    if (url.pathname === '/api/import/plan') return json(preview(plan));
    if (url.pathname !== '/api/import/run') return json({ error: 'not found' }, 404);
    if (importing.status === 'running') return json({ error: 'an import is already running' }, 409);
    importing = { status: 'running', done: 0, total: plan.images.length };
    void runImport(store, plan, {
      fetchImage: url.searchParams.get('images') === '0' ? null : (options.fetchImage ?? fetchOverNetwork),
      fresh: url.searchParams.get('settings') === '1',
      onImage: (done, total) => {
        importing = { status: 'running', done, total };
      },
    }).then(
      (report) => {
        importing = { status: 'done', report };
      },
      (error: unknown) => {
        importing = { status: 'failed', error: error instanceof Error ? error.message : String(error) };
      },
    );
    return json(importing, 202);
  }

  async function api(request: Request, url: URL): Promise<Response> {
    if (url.pathname.startsWith('/api/import')) return importApi(request, url);
    if (url.pathname === '/api/messages') {
      const email = url.searchParams.get('email') ?? '';
      if (request.method === 'DELETE') {
        if (email) await store.deleteMessagesFrom(email);
        else await store.deleteMessage(url.searchParams.get('id') ?? '');
      }
      await store.forgetOldMessages();
      const keep = (await store.site()).keepMessages;
      // Asked for one address: what that visitor sent, to give them or to check before erasing.
      if (request.method === 'GET' && email) return json({ messages: await store.messages(email), keep });
      return json({ messages: await store.messages(), keep });
    }
    if (url.pathname === '/api/media') {
      if (request.method === 'GET') return json({ media: await store.media() });
      if (request.method === 'DELETE') {
        await store.deleteMedia(url.searchParams.get('name') ?? '');
        return json({ media: await store.media() });
      }
      if (request.method === 'POST') {
        // The body is the file itself. What it is, is read from its bytes.
        if (Number(request.headers.get('content-length') ?? 0) > MEDIA_MAX_BYTES) return json({ error: 'the image is too large' }, 413);
        const item = await store.addMedia(new Uint8Array(await request.arrayBuffer()), url.searchParams.get('label'));
        return json({ item, media: await store.media() });
      }
    }
    const body = request.method === 'GET' || request.method === 'DELETE' ? {} : ((await request.json()) as Record<string, unknown>);
    const slug = url.searchParams.get('slug') ?? '';
    const route = `${request.method} ${url.pathname}`;
    // An entry of a content type is edited through the same calls as a page; `kind` names its type.
    const asked = String(url.searchParams.get('kind') ?? body.kind ?? 'page');
    // A type's own page (ADR 0015) is edited through the same calls, as `template:<type>`.
    if (asked.startsWith('template:')) {
      const type = await store.type(asked.slice(9));
      switch (route) {
        case 'GET /api/page':
          return json({ page: await templateDoc(type) });
        case 'PUT /api/page': {
          const { page, issues } = normalizePage({ ...(body.page as object), title: 'template' });
          await store.setTemplate(type.id, page.blocks);
          return json({ page: await templateDoc(type), issues, ...(await lists()) });
        }
        case 'DELETE /api/page':
          // Back to the default page. Visitors keep what is published until it is published.
          await store.setTemplate(type.id, null);
          return json(await lists());
        case 'POST /api/publish':
          await store.publishTemplate(type.id);
          return json(await lists());
        case 'POST /api/render': {
          const { page } = normalizePage({ ...(body.page as object), title: 'template' });
          return json(renderPostParts(await store.site(), await theme(), await sampleEntry(type), await menu(), true, type, await entryLists(), page.blocks, true));
        }
      }
    }
    if (asked !== 'page') {
      const type = await store.type(asked === 'post' ? POSTS_TYPE : asked);
      switch (route) {
        case 'GET /api/page': {
          const post = await store.entryDraft(type.id, slug);
          return post ? json({ page: post }) : json({ error: 'no such entry' }, 404);
        }
        case 'PUT /api/page': {
          const { post, issues } = normalizePost(body.page, undefined, type);
          if (!post.title || !post.slug) return json({ error: 'an entry has a title', issues }, 400);
          if (body.create === true && (await store.entryDraft(type.id, post.slug))) return json({ error: 'an entry with this address already exists' }, 409);
          return json({ page: await store.saveEntry(type.id, body.page), issues, ...(await lists()) });
        }
        case 'DELETE /api/page':
          await store.deleteEntry(type.id, slug);
          return json(await lists());
        case 'POST /api/publish':
          await store.publishEntry(type.id, String(body.slug ?? ''));
          return json(await lists());
        case 'POST /api/render':
          return json(renderPostParts(await store.site(), await theme(), normalizePost(body.page, new Date().toISOString().slice(0, 10), type).post, await menu(), true, type, await entryLists(), await store.template(type.id)));
      }
    }
    switch (route) {
      case 'GET /api/state':
        return json(await state());
      case 'GET /api/page': {
        const page = await store.draft(slug);
        return page ? json({ page }) : json({ error: 'no such page' }, 404);
      }
      case 'PUT /api/page': {
        const { page, issues } = normalizePage(body.page);
        if (!page.title) return json({ error: 'a page has a title', issues }, 400);
        // A new page may not silently replace an existing one.
        if (body.create === true && (await store.draft(page.slug))) return json({ error: 'a page with this address already exists' }, 409);
        if (reservedSlugs(await store.site()).includes(page.slug)) return json({ error: `the address "/${page.slug}/" is used by the site itself; choose another title` }, 409);
        return json({ page: await store.savePage(page), issues, ...(await lists()) });
      }
      case 'DELETE /api/page':
        await store.deletePage(slug);
        return json(await lists());
      case 'POST /api/publish':
        await store.publish(String(body.slug ?? ''));
        return json(await lists());
      case 'POST /api/render': {
        // Drawn from what the admin holds, cleaned first: the canvas shows what would be saved.
        const { page } = normalizePage(body.page);
        return json(renderParts(await store.site(), await theme(), page, await menu(), true, await entryLists()));
      }
      case 'PUT /api/theme':
        await store.setTheme(body.theme);
        return json(await state());
      case 'POST /api/theme/publish':
        await store.publishTheme();
        return json(await state());
      case 'PUT /api/site':
        await store.setSite(body.site);
        return json(await state());
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
    if (url.pathname.startsWith(MEDIA_PREFIX)) {
      // An <img> cannot carry the token, so a stored image is read without it. Its name is the hash of its bytes.
      const file = await store.mediaFile(url.pathname.slice(MEDIA_PREFIX.length));
      return file ? new Response(file.bytes as Uint8Array<ArrayBuffer>, { headers: { 'content-type': file.type, ...SECURITY } }) : json({ error: 'not found' }, 404);
    }
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
        return html(previewPage((await store.site()).language));
      case '/assets/site.css':
        // The structure first, the theme after it: where both set the same thing, the theme wins.
        return text(`${baseCss}${themeCss(await theme())}`, 'text/css');
      default:
        return json({ error: 'not found' }, 404);
    }
  }

  const server = options.listen === false ? null : Bun.serve({ hostname: '127.0.0.1', port, fetch: handle, maxRequestBodySize: IMPORT_MAX_BYTES + 1024 * 1024 });
  if (server?.port) port = server.port;
  return {
    url: `http://127.0.0.1:${port}/admin/#token=${token}`,
    token,
    port,
    fetch: handle,
    stop: () => server?.stop(true),
  };
}
