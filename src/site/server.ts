/**
 * The editing server: `thecms edit site.db`. It serves the admin, the canvas
 * the admin edits on, and a small JSON API over the store.
 *
 * It is a tool for one person on their own computer, so it listens on
 * 127.0.0.1 only. That is not enough on its own: any web page that person has
 * open can send requests to localhost. So every API call must carry a token
 * that only the admin page was given, must name this server as its host (a
 * page that points its own domain at 127.0.0.1 does not), and must not come
 * from another origin.
 *
 * Given a public address (`thecms serve`), it is a server others reach, and
 * it has accounts instead (ADR 0022, src/site/accounts.ts): a session cookie,
 * a header no other site's page can send, and calls only the owner may make.
 */
import { mediaResponse } from './serve-media.ts';
import { startClock } from './clock.ts';
import type { Mailer } from './mail.ts';
import { startRuntime } from './runtime.ts';
import { isValkeyAddress, openShared, type Shared, shownAddress, switchable, testValkey } from './shared.ts';

/** The admin's own addresses; every other is the site's (ADR 0044). */
const ADMIN_PATHS = new Set(['/admin', '/preview']);
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { compile } from 'svelte/compiler';
import { SECTION_KIND, type Block, fillSections, takeWords, withAreas, type Site, siteIn, type PlacedPage, translatedPage, cleanRow, EXTENSION_MAX_BYTES, type ExtensionManifest, extensionAsks, isObject, languageOf, normalizeBlocks, shownRow, str, type ContentType, DISPLAY_NAME, type LanguagePack, defaultTemplate, MEDIA_MAX_BYTES, MEDIA_PREFIX, UPLOAD_MAX_BYTES, normalizePage, type Page, type Post, contentTypes, listPath, type MenuList, normalizePost, parseTheme, pagesIn, POSTS_TYPE, reservedSlugs, slugProblem, type Theme, themeCss } from '../core/index.ts';
import type { EntryLists } from '../blocks/editing.ts';
import { type FetchImage, fetchImage as fetchOverNetwork, IMPORT_MAX_BYTES, type ImportReport, runImport } from '../import/run.ts';
import { type ImportPlan, planImport } from '../import/wxr.ts';
import { type MenuItem, menuOf, pageSetting, renderParts, renderPostParts } from './document.ts';
import { languages, packFor } from './languages.ts';
import { accounts, cleanPublicAddress, ownerOnly, shown } from './accounts.ts';
import { extensionHost, type Spawn } from './extensions.ts';
import { BUILT_ADMIN } from './built-admin.ts';
import { BASE_CSS, SHIPPED_THEMES } from './shipped.ts';
import type { Store, User } from './store.ts';
import { rowWrites } from '../view/index.ts';
import { fullCheck, publishedSite } from './export.ts';

const ADMIN = new URL('../admin/', import.meta.url);

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
export function bundledThemes(): Theme[] {
  return Object.keys(SHIPPED_THEMES)
    .sort()
    .flatMap((file) => parseTheme(SHIPPED_THEMES[file]).theme ?? []);
}

const CSP = "default-src 'self'; img-src 'self' http: https: data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'";
const SECURITY = { 'content-security-policy': CSP, 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'cache-control': 'no-store' };

const html = (body: string): Response => new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8', ...SECURITY } });
const text = (body: string, type: string): Response => new Response(body, { headers: { 'content-type': `${type}; charset=utf-8`, ...SECURITY } });
const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...SECURITY } });

/** The admin's page, with the words of its language in it, read before the admin starts (ADR 0021). */
const adminPage = (pack: LanguagePack | null): string => `<!doctype html>
<html lang="${(pack?.language ?? 'en').replace(/[^A-Za-z0-9-]/g, '')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${DISPLAY_NAME}</title>
</head>
<body>
<div id="app"></div>
<script type="application/json" id="cms-language">${JSON.stringify(pack).replace(/</g, '\\u003c')}</script>
<script type="module" src="/admin/app.js"></script>
</body>
</html>
`;

const previewPage = (language: string): string => `<!doctype html>
<html lang="${language.replace(/[^A-Za-z0-9-]/g, '')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="/admin/site.css" id="cms-theme">
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
  /** With accounts and no owner yet: the one-time link that makes the first owner. */
  setupUrl: string;
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

export async function startEditor(
  store: Store,
  options: {
    port?: number;
    listen?: boolean;
    /** How an import fetches images; the tests give their own. */
    fetchImage?: FetchImage;
    /** The admin's public address, `https://cms.example.com`: with it, people sign in with accounts (ADR 0022). */
    public?: string;
    /** Where to listen; this machine unless said otherwise. */
    hostname?: string;
    /** How an extension's process is started; the tests give their own. */
    spawnExtension?: Spawn;
    /** How the owner is told of a message or a comment (ADR 0019). */
    mailer?: Mailer | null;
    to?: string;
    from?: string;
    log?: (line: string) => void;
    /** Valkey's address from THECMS_VALKEY_URL (ADR 0044 d4): it comes before the one saved in Settings → Performance, which cannot change it. */
    valkey?: string;
    /** Where what is kept without Valkey is also written to disk. */
    cacheDir?: string;
    /** What the site's processes share, given whole; the tests give their own. */
    shared?: Shared;
  } = {},
): Promise<EditorServer> {
  const assets = BUILT_ADMIN ? new Map(Object.entries(BUILT_ADMIN)) : await buildAdmin();
  const themes = bundledThemes();
  const baseCss = BASE_CSS;
  const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
  let port = options.port ?? 4321;
  const publicAddress = options.public ? cleanPublicAddress(options.public) : '';
  if (options.public && !publicAddress) throw new Error('the public address is https://, with nothing after the host (http:// only on this machine)');
  // What the site's processes share: Valkey when an address is set, this process otherwise (ADR 0044 d4).
  const fromEnvironment = options.valkey ?? '';
  const keptAt = { dir: options.cacheDir, log: options.log };
  const shared = switchable(options.shared ?? openShared(fromEnvironment || (await store.valkeyAddress()), keptAt));
  const people = publicAddress ? accounts(store, publicAddress, shared) : null;
  /** On one's own computer, whoever has the key is the owner. */
  const LOCAL_OWNER: User = { id: 'local', email: '', name: '', role: 'owner', active: true, createdAt: '' };

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
  const menuLists = async (): Promise<MenuList[]> => {
    const entries = await allEntries();
    return contentTypes(await store.site())
      .filter((type) => (entries[type.id]?.length ?? 0) > 0)
      .map((type): MenuList => ({ id: type.id, title: type.name, href: listPath(type) }));
  };
  /** The main language's menu: entries are in it (ADR 0024). */
  const menu = async (): Promise<MenuItem[]> => {
    const site = await store.site();
    return menuOf(site, pagesIn(site, site.language, await store.pages()), await menuLists());
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
  const lists = async (): Promise<{ pages: Awaited<ReturnType<Store['pages']>>; sections: Awaited<ReturnType<Store['sections']>>; posts: Listed; entries: Record<string, Listed>; templates: Awaited<ReturnType<typeof templates>> }> => ({
    pages: await store.pages(),
    sections: await store.sections(),
    posts: await store.posts(),
    entries: await allEntries(),
    templates: await templates(),
  });
  /** Blocks as the canvas draws them: each section block with its section's drafts, in the language (ADR 0033). */
  /** The site with what its layouts' sections hold (ADR 0035), from the drafts, in its language. */
  const framed = async (site?: Site): Promise<Site> => {
    const drawn = site ?? (await store.site());
    return withAreas(drawn, await store.draftSections(), drawn.language);
  };
  const filled = async (blocks: Block[], language?: string): Promise<Block[]> => fillSections(blocks, await store.draftSections(), language ?? (await store.site()).language);
  /** A page at its address as the builder edits it: no more than a page. */
  const asPage = (p: PlacedPage): Page => ({ slug: p.slug, title: p.title, description: p.description, inMenu: p.inMenu, blocks: p.blocks });
  /** What the builder is told of a translation: the page it is of, its language, whether it is split. */
  const translationOf = (p: PlacedPage) => ({ of: p.of, language: p.language, split: p.split });
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
  const extensions = extensionHost(store, { spawn: options.spawnExtension, log: options.log });
  // The site itself, at the same address as its admin, as WordPress serves both (ADR 0044).
  const site = startRuntime(store, { listen: false, extensions, shared, mailer: options.mailer, to: options.to, from: options.from, log: options.log });
  /**
   * The extensions as the admin shows them. The owner sees each one, with what
   * it asked for and its screens; an editor sees what the ones turned on offer
   * in the editor.
   */
  const extensionsFor = async (me: User) =>
    (await store.extensions())
      .filter((e) => me.role === 'owner' || e.enabled)
      .map(({ manifest, sha256, enabled, installedAt }) => ({
        name: manifest.name,
        displayName: manifest.displayName,
        description: manifest.description,
        version: manifest.version,
        publisher: manifest.publisher,
        enabled,
        actions: manifest.actions.filter((a) => me.role === 'owner' || a.on).map(({ name, label, on, ask, each }) => ({ name, label, on, ask, each })),
        messages: manifest.messages,
        ...(me.role === 'owner' ? { sha256, installedAt, asks: extensionAsks(manifest), views: manifest.views, collections: manifest.collections } : {}),
      }));
  const state = async (me: User): Promise<unknown> => ({
    extensions: await extensionsFor(me),
    site: await store.site(),
    theme: await theme(),
    themeChanged: await store.themeChanged(),
    themes,
    languages: languages(),
    me: shown(me),
    accounts: people !== null,
    shared: shared.status(),
    ...(await lists()),
  });

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

  /**
   * A page action run for each of the site's other languages (ADR 0034): on
   * the page in that language, started when it is not there yet; what it gives
   * back fills in only the words that translation does not say. A language the
   * page is split for keeps its own blocks, and is left as it is.
   */
  async function eachLanguage(request: Request, name: string, manifest: ExtensionManifest, what: string, owner: boolean): Promise<Response> {
    const action = manifest.actions.find((a) => a.name === what && a.each === 'language');
    if (!action) return json({ error: `${manifest.displayName} has no action "${what}" for each language` }, 404);
    const body = (await request.json()) as Record<string, unknown>;
    const kind = body.kind === SECTION_KIND ? 'section' : 'page';
    if (kind === 'section' && !owner) return json({ error: 'only the owner may change this' }, 403);
    const slug = String(body.slug ?? '');
    const site = await store.site();
    const main = kind === 'page' ? await store.draft(slug) : await store.sectionDraft(slug);
    if (!main || (kind === 'page' && languageOf(site, slug) !== site.language)) return json({ error: `no ${kind} "${slug}" in the main language` }, 404);
    const given = isObject(body.ask) ? body.ask : {};
    const ask = Object.fromEntries(action.ask.map((a) => [a.key, str(given[a.key], 2000)]));
    const done: string[] = [];
    const skipped: string[] = [];
    for (const language of site.languages) {
      const had = main.translations?.[language];
      if (had?.blocks) {
        skipped.push(language);
        continue;
      }
      const shown = had ? (translatedPage(site, main, language) as PlacedPage) : await store.translate(slug, language, kind);
      const answer = (await extensions.run(name, action.name, { page: asPage(shown), language, ask, site: { name: site.name, language: site.language, languages: site.languages } })) as Record<string, unknown> | null;
      if (!isObject(answer?.page)) return json({ error: `${manifest.displayName} did not give back a page`, done }, 400);
      await store.fillTranslation(slug, language, answer.page, kind);
      done.push(language);
    }
    return json({ done, skipped, ...(await lists()) });
  }

  /** Extensions (ADR 0026): installing them is the owner's; what they offer in the editor is everyone's. */
  async function extensionsApi(request: Request, url: URL, me: User): Promise<Response> {
    const owner = me.role === 'owner';
    const [, , , name = '', part = '', what = ''] = url.pathname.split('/');
    const refused = json({ error: 'only the owner may do this' }, 403);
    if (!name) return request.method === 'GET' ? json({ extensions: await extensionsFor(me) }) : json({ error: 'not found' }, 404);
    if (name === 'offer' || name === 'install') {
      if (!owner) return refused;
      if (request.method !== 'POST') return json({ error: 'not found' }, 404);
      if (Number(request.headers.get('content-length') ?? 0) > EXTENSION_MAX_BYTES) return json({ error: 'an extension is at most 5 MB' }, 413);
      const text = await request.text();
      if (name === 'offer') return json({ offer: await extensions.offer(text) });
      await extensions.install(text, url.searchParams.get('sha256') ?? '');
      return json({ extensions: await extensionsFor(me) });
    }
    const installed = await store.extension(name);
    if (!installed) return json({ error: `no extension "${name}" is installed` }, 404);
    if (part === 'run' && request.method === 'POST') {
      const action = installed.manifest.actions.find((a) => a.name === what);
      if (!action) return json({ error: `${installed.manifest.displayName} has no action "${what}"` }, 404);
      if (!action.on && !owner) return refused;
      const body = (await request.json()) as Record<string, unknown>;
      const site = await store.site();
      const given = isObject(body.ask) ? body.ask : {};
      const ask = Object.fromEntries(action.ask.map((a) => [a.key, str(given[a.key], 2000)]));
      if (action.on === 'block') {
        const [block] = normalizeBlocks([body.block]).blocks;
        if (!block) return json({ error: 'there is no block to give it' }, 400);
        const language = languageOf(site, String(body.slug ?? ''));
        const answer = (await extensions.run(name, action.name, { block, language, ask, site: { name: site.name, language: site.language, languages: site.languages } })) as Record<string, unknown> | null;
        // What comes back is a block like any other, cleaned by the same rules, in the same place.
        const [next] = normalizeBlocks([{ ...(isObject(answer?.block) ? answer.block : {}), id: block.id }]).blocks;
        if (!next) return json({ error: `${installed.manifest.displayName} did not give back a block` }, 400);
        // On a translation, only its words change (ADR 0034).
        return json({ block: body.fixed === true ? takeWords([block], [next])[0] : next });
      }
      if (action.on === 'page') {
        const { page } = normalizePage(body.page);
        const language = languageOf(site, page.slug);
        const answer = (await extensions.run(name, action.name, { page, language, ask, site: { name: site.name, language: site.language, languages: site.languages } })) as Record<string, unknown> | null;
        if (!isObject(answer?.page)) return json({ error: `${installed.manifest.displayName} did not give back a page` }, 400);
        const next = normalizePage({ ...answer.page }).page;
        return json({ page: body.fixed === true ? { ...next, slug: page.slug, blocks: takeWords(page.blocks, next.blocks) } : next });
      }
      return json({ answer: (await extensions.run(name, action.name, body.input ?? null)) ?? null });
    }
    if (part === 'each' && request.method === 'POST') return eachLanguage(request, name, installed.manifest, what, owner);
    if (!owner) return refused;
    if (!part) {
      if (request.method === 'PUT') {
        const body = (await request.json()) as Record<string, unknown>;
        await extensions.enable(name, body.enabled === true);
      } else if (request.method === 'DELETE') await extensions.uninstall(name);
      else return json({ error: 'not found' }, 404);
      return json({ extensions: await extensionsFor(me) });
    }
    if (part !== 'rows') return json({ error: 'not found' }, 404);
    // A screen shows its collection: the owner reads and writes it through it, as its screens allow (ADR 0031).
    const may = rowWrites(installed.manifest.views, what);
    const of = installed.manifest.collections.find((c) => c.name === what);
    if (!may.read || !of) return json({ error: 'not found' }, 404);
    const rows = async () => json({ rows: (await store.extensionRows(name, of.name)).map((row) => shownRow(of, row)) });
    if (request.method === 'GET') return rows();
    if (request.method === 'DELETE') {
      if (!may.delete) return json({ error: 'no screen removes these rows' }, 403);
      await store.deleteExtensionRow(name, of.name, url.searchParams.get('id') ?? '');
      return rows();
    }
    if (request.method !== 'PUT') return json({ error: 'not found' }, 404);
    const body = (await request.json()) as Record<string, unknown>;
    const id = typeof body.id === 'string' && body.id ? body.id : null;
    if (id ? !may.edit : !may.create) return json({ error: id ? 'no screen changes these rows' : 'no screen adds these rows' }, 403);
    const before = id ? await store.extensionRow(name, of.name, id) : null;
    if (id && !before) return json({ error: 'no such row' }, 404);
    const { row, problems } = cleanRow(of, body.row, before);
    if (problems.length) return json({ error: problems.join('; ') }, 400);
    await store.saveExtensionRow(name, of.name, row, id);
    return rows();
  }

  async function api(request: Request, url: URL, me: User): Promise<Response> {
    if (url.pathname === '/api/extensions' || url.pathname.startsWith('/api/extensions/')) return extensionsApi(request, url, me);
    if (url.pathname.startsWith('/api/import')) return importApi(request, url);
    if (url.pathname === '/api/messages') {
      const email = url.searchParams.get('email') ?? '';
      if (request.method === 'DELETE') {
        if (email) await store.deleteMessagesFrom(email);
        else await store.deleteMessage(url.searchParams.get('id') ?? '');
      }
      if (request.method === 'DELETE' && email) await store.deleteCommentsFrom(email);
      await store.forgetOldMessages();
      const keep = (await store.site()).keepMessages;
      // Asked for one address: what that visitor sent, messages and comments, to give them or to check before erasing.
      if (request.method === 'GET' && email) return json({ messages: await store.messages(email), comments: await store.comments(email), keep });
      return json({ messages: await store.messages(), keep });
    }
    if (url.pathname === '/api/comments') {
      // Moderating is an editor's work too: approve what may be shown, delete the rest (ADR 0040).
      const id = url.searchParams.get('id') ?? '';
      if (request.method === 'POST') await store.approveComment(id);
      if (request.method === 'DELETE') await store.deleteComment(id);
      await store.forgetOldMessages();
      return json({ comments: await store.comments() });
    }
    if (url.pathname === '/api/media/variant' && request.method === 'POST') {
      // A smaller copy the browser made of a stored picture (ADR 0005 d8); what it is, is read from its bytes.
      if (Number(request.headers.get('content-length') ?? 0) > MEDIA_MAX_BYTES) return json({ error: 'the image is too large' }, 413);
      const item = await store.addVariant(url.searchParams.get('name') ?? '', new Uint8Array(await request.arrayBuffer()));
      return json({ item });
    }
    if (url.pathname === '/api/media') {
      if (request.method === 'GET') return json({ media: await store.media() });
      if (request.method === 'DELETE') {
        await store.deleteMedia(url.searchParams.get('name') ?? '');
        return json({ media: await store.media() });
      }
      if (request.method === 'POST') {
        // The body is the file itself. What it is, is read from its bytes.
        if (Number(request.headers.get('content-length') ?? 0) > UPLOAD_MAX_BYTES) return json({ error: `the file is too large: at most ${UPLOAD_MAX_BYTES / 1024 / 1024} MB` }, 413);
        const item = await store.addMedia(new Uint8Array(await request.arrayBuffer()), url.searchParams.get('label'));
        return json({ item, media: await store.media() });
      }
    }
    const body = request.method === 'GET' || request.method === 'DELETE' ? {} : ((await request.json()) as Record<string, unknown>);
    if (url.pathname === '/api/performance') {
      // Settings → Performance (ADR 0044 d4): where the processes share what they keep, a test, and a new address.
      const saved = await store.valkeyAddress();
      const described = () => ({ status: shared.status(), address: shownAddress(fromEnvironment || saved), fromEnvironment: fromEnvironment !== '' });
      if (request.method === 'POST') {
        const asked = String(body.address ?? '').trim();
        return json({ test: await testValkey(asked && !asked.includes('***') ? asked : fromEnvironment || saved) });
      }
      if (request.method === 'PUT') {
        if (fromEnvironment) return json({ error: 'Valkey is set by THECMS_VALKEY_URL on the server; change it there' }, 409);
        const address = String(body.address ?? '').trim();
        if (address.includes('***') && shownAddress(saved) === address) return json(described());
        if (address && !isValkeyAddress(address)) return json({ error: 'an address starts with redis:// or valkey://' }, 400);
        await store.setValkeyAddress(address);
        shared.use(openShared(address, keptAt));
        // Asked once now, so what the owner sees is whether it answers.
        await shared.count('performance:asked');
        return json({ ...described(), address: shownAddress(address) });
      }
      return json(described());
    }
    if (url.pathname === '/api/locks') {
      // Pages behind a password (ADR 0043): set, changed or taken away; the password itself is never given back.
      if (request.method === 'POST') return json({ locked: await store.lockPage(String(body.slug ?? ''), String(body.password ?? '')) });
      if (request.method === 'DELETE') return json({ locked: await store.lockPage(url.searchParams.get('slug') ?? '', null) });
      return json({ locked: await store.lockedPages() });
    }
    if (url.pathname === '/api/schedule') {
      // A page or an entry published at a set time (ADR 0039).
      if (request.method === 'POST') return json({ scheduled: await store.schedule(String(body.kind ?? 'page'), String(body.slug ?? ''), String(body.at ?? '')) });
      if (request.method === 'DELETE') return json({ scheduled: await store.unschedule(url.searchParams.get('kind') ?? 'page', url.searchParams.get('slug') ?? '') });
      return json({ scheduled: await store.scheduled() });
    }
    const slug = url.searchParams.get('slug') ?? '';
    const route = `${request.method} ${url.pathname}`;
    // An entry of a content type is edited through the same calls as a page; `kind` names its type.
    const asked = String(url.searchParams.get('kind') ?? body.kind ?? 'page');
    // A section (ADR 0033) is written through the same calls, as `_section`; its translations as a page's are.
    if (asked === SECTION_KIND) {
      switch (route) {
        case 'GET /api/page': {
          const section = await store.sectionDraft(slug);
          if (section) return json({ page: section });
          const found = await store.locateSection(slug);
          return found ? json({ page: asPage(found), translation: translationOf(found) }) : json({ error: 'no such section' }, 404);
        }
        case 'PUT /api/page': {
          if (isObject(body.translation)) {
            const found = await store.saveTranslation(String(body.translation.of ?? ''), String(body.translation.language ?? ''), body.page, 'section');
            return json({ page: asPage(found), translation: translationOf(found), issues: [], ...(await lists()) });
          }
          const { page, issues } = normalizePage(body.page);
          if (body.create === true && (await store.sectionDraft(page.slug))) return json({ error: 'a section with this name already exists' }, 409);
          return json({ page: await store.saveSection(body.page), issues, ...(await lists()) });
        }
        case 'DELETE /api/page':
          await store.deleteSection(slug);
          return json(await lists());
        case 'POST /api/publish':
          await store.publishSection(String(body.slug ?? ''));
          return json(await lists());
        case 'POST /api/translate': {
          const found = await store.translate(String(body.slug ?? ''), String(body.language ?? ''), 'section');
          return json({ page: asPage(found), translation: translationOf(found), ...(await lists()) });
        }
        case 'POST /api/split': {
          const found = await store.splitTranslation(String(body.of ?? ''), String(body.language ?? ''), 'section');
          return json({ page: asPage(found), translation: translationOf(found), ...(await lists()) });
        }
        case 'POST /api/render': {
          // A section is drawn as a page of its own, in its language, with nothing around it but the site.
          const { page } = normalizePage(body.page);
          const site = await store.site();
          const language = languageOf(site, page.slug);
          return json(renderParts(siteIn(site, language), await theme(), page, [], true, await entryLists()));
        }
        case 'GET /api/versions':
        case 'GET /api/version': {
          const found = await store.locateSection(slug);
          const name = found?.translated ? found.of : slug;
          if (route === 'GET /api/versions') return json({ versions: await store.versions('section', name) });
          const raw = await store.version('section', name, url.searchParams.get('at') ?? '');
          if (!raw) return json({ error: 'no such version' }, 404);
          const kept = normalizePage(raw).page;
          const shown = found?.translated ? translatedPage(await store.site(), kept, found.language) : null;
          return json({ page: shown ? asPage(shown) : kept });
        }
      }
    }
    // A type's own page (ADR 0015) is edited through the same calls, as `template:<type>`.
    if (asked.startsWith('template:')) {
      // How a type's page looks is the owner's; an editor sees it around what they write.
      if (me.role !== 'owner' && route !== 'GET /api/page' && route !== 'POST /api/render') return json({ error: 'only the owner may change this' }, 403);
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
          return json(renderPostParts(await framed(), await theme(), await sampleEntry(type), await menu(), true, type, await entryLists(), await filled(page.blocks), true));
        }
      }
    }
    // What was published before, kept to be brought back into the editor.
    if (route === 'GET /api/versions' || route === 'GET /api/version') {
      const type = asked === 'page' ? null : await store.type(asked === 'post' ? POSTS_TYPE : asked);
      const kind = type?.id ?? 'page';
      if (route === 'GET /api/versions') return json({ versions: await store.versions(kind, slug) });
      const raw = await store.version(kind, slug, url.searchParams.get('at') ?? '');
      if (!raw) return json({ error: 'no such version' }, 404);
      if (type) return json({ page: normalizePost(raw, undefined, type).post });
      // A translation's versions are its page's (ADR 0032 d5): shown in its language.
      const found = await store.locate(slug);
      const kept = normalizePage(raw).page;
      const shown = found?.translated ? translatedPage(await store.site(), kept, found.language) : null;
      return json({ page: shown ? asPage(shown) : kept });
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
          const post = normalizePost(body.page, new Date().toISOString().slice(0, 10), type).post;
          const template = await store.template(type.id);
          return json(renderPostParts(await framed(), await theme(), { ...post, blocks: await filled(post.blocks) }, await menu(), true, type, await entryLists(), template && (await filled(template))));
      }
    }
    switch (route) {
      case 'GET /api/state':
        return json(await state(me));
      case 'GET /api/check':
        // The published site, built as an export would build it, and read for what it would get wrong (ADR 0029).
        try {
          const files = await publishedSite(store);
          return json({ check: await fullCheck(store, files) });
        } catch (error) {
          return json({ error: error instanceof Error ? error.message : String(error) }, 409);
        }
      case 'GET /api/page': {
        const page = await store.draft(slug);
        if (page) return json({ page });
        // A translation is a page of its own address, written over its page (ADR 0032).
        const found = await store.locate(slug);
        return found ? json({ page: asPage(found), translation: translationOf(found) }) : json({ error: 'no such page' }, 404);
      }
      case 'POST /api/translate': {
        const found = await store.translate(String(body.slug ?? ''), String(body.language ?? ''));
        return json({ page: asPage(found), translation: translationOf(found), ...(await lists()) });
      }
      case 'POST /api/split': {
        const found = await store.splitTranslation(String(body.of ?? ''), String(body.language ?? ''));
        return json({ page: asPage(found), translation: translationOf(found), ...(await lists()) });
      }
      case 'PUT /api/page': {
        if (isObject(body.translation)) {
          const found = await store.saveTranslation(String(body.translation.of ?? ''), String(body.translation.language ?? ''), body.page);
          return json({ page: asPage(found), translation: translationOf(found), issues: [], ...(await lists()) });
        }
        const { page, issues } = normalizePage(body.page);
        if (!page.title) return json({ error: 'a page has a title', issues }, 400);
        // A new page may not silently replace an existing one.
        if (body.create === true && (await store.draft(page.slug))) return json({ error: 'a page with this address already exists' }, 409);
        const site = await store.site();
        const problem = slugProblem(site, page.slug, reservedSlugs(site));
        if (problem) return json({ error: problem }, 409);
        return json({ page: await store.savePage(page), issues, ...(await lists()) });
      }
      case 'DELETE /api/page':
        await store.deletePage(slug);
        return json(await lists());
      case 'POST /api/move': {
        // A page at a new address (ADR 0036): what visitors knew leads there.
        const page = await store.movePage(String(body.from ?? ''), String(body.to ?? ''));
        return json({ page, ...(await lists()), redirects: await store.redirects() });
      }
      case 'GET /api/redirects':
        return json({ redirects: await store.redirects() });
      case 'PUT /api/redirects':
        return json({ redirects: await store.setRedirects(body.redirects) });
      case 'POST /api/publish':
        await store.publish(String(body.slug ?? ''));
        return json(await lists());
      case 'POST /api/render': {
        // Drawn from what the admin holds, cleaned first: the canvas shows what would be saved.
        const { page } = normalizePage(body.page);
        // Drawn in its own language, with that language's menu and words (ADR 0024).
        const setting = pageSetting(await store.site(), page.slug, await store.pages(), await menuLists());
        return json(renderParts(await framed(setting.site), await theme(), { ...page, blocks: await filled(page.blocks, setting.site.language) }, setting.menu, true, await entryLists(), setting.alternates));
      }
      case 'PUT /api/theme':
        await store.setTheme(body.theme);
        return json(await state(me));
      case 'POST /api/theme/publish':
        await store.publishTheme();
        return json(await state(me));
      case 'PUT /api/site':
        await store.setSite(body.site);
        return json(await state(me));
      default:
        return json({ error: 'not found' }, 404);
    }
  }

  async function handle(request: Request, ip = ''): Promise<Response> {
    const url = new URL(request.url);
    // A page that points its own domain at 127.0.0.1 arrives with its own host name.
    const host = request.headers.get('host') ?? url.host;
    if (people ? host !== new URL(publicAddress).host : host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return json({ error: 'wrong host' }, 403);

    if (url.pathname.startsWith('/api/')) {
      const origin = request.headers.get('origin');
      if (origin && origin !== (people ? publicAddress : `http://${host}`)) return json({ error: 'wrong origin' }, 403);
      // Each request knows its own person: two people's calls can be answered at once.
      let me = LOCAL_OWNER;
      try {
        if (people) {
          // A page of another site cannot send this header without asking first, and nothing here answers that question.
          if (request.headers.get('x-thecms-request') !== '1') return json({ error: 'not a call from the admin' }, 403);
          const open = await people.open(request, url);
          if (open) return open;
          const user = await people.user(request);
          if (!user) return json({ error: 'sign in first', signIn: true }, 401);
          me = user;
        } else if (!sameToken(request.headers.get('x-thecms-token'), token)) return json({ error: 'no token' }, 401);
        if (ownerOnly(request.method, url.pathname) && me.role !== 'owner') return json({ error: 'only the owner may do this' }, 403);
        if (url.pathname.startsWith('/api/users')) return people ? await people.people(request, url, me) : json({ error: 'accounts are for a served admin' }, 404);
        return await api(request, url, me);
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : String(error) }, 400);
      }
    }
    if (!ADMIN_PATHS.has(url.pathname) && !url.pathname.startsWith('/admin/') && !url.pathname.startsWith(MEDIA_PREFIX)) return site.fetch(request, ip);
    if (request.method !== 'GET') return json({ error: 'not found' }, 404);
    if (url.pathname.startsWith(MEDIA_PREFIX)) {
      // An <img> cannot carry the token, so a stored file is read without it. Its name is the hash of its bytes.
      const name = url.pathname.slice(MEDIA_PREFIX.length);
      const file = await store.mediaFile(name);
      return file ? mediaResponse(request, name, file, SECURITY) : json({ error: 'not found' }, 404);
    }
    switch (url.pathname) {
      case '/admin':
        return new Response(null, { status: 302, headers: { location: '/admin/' } });
      case '/admin/': {
        const site = await store.site();
        return html(adminPage(packFor(site.adminLanguage || site.language)));
      }
      case '/admin/app.js':
      case '/admin/frame.js':
        return text(assets.get(url.pathname.slice(7)) ?? '', 'text/javascript');
      case '/preview':
        return html(previewPage((await store.site()).language));
      case '/admin/site.css':
        // The canvas's: the theme as it is being built. The structure first, the theme after it: where both set the same thing, the theme wins.
        return text(`${baseCss}${themeCss(await theme())}`, 'text/css');
      default:
        return json({ error: 'not found' }, 404);
    }
  }

  const server =
    options.listen === false
      ? null
      : Bun.serve({
          hostname: options.hostname ?? '127.0.0.1',
          port,
          fetch: (request, srv) => handle(request, request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || srv.requestIP(request)?.address || ''),
          maxRequestBodySize: Math.max(IMPORT_MAX_BYTES, UPLOAD_MAX_BYTES) + 1024 * 1024,
        });
  if (server?.port) port = server.port;
  // What was set for later is published while the editor runs (ADR 0039).
  // So are the extensions' jobs, and what happens here is told to the extensions that listen (ADR 0041).
  const clock = startClock(store, { run: server !== null, jobs: extensions.jobs, claim: (key, ms) => shared.claim(key, ms) });
  const unlisten = extensions.listen();
  return {
    url: people ? `${publicAddress}/admin/` : `http://127.0.0.1:${port}/admin/#token=${token}`,
    setupUrl: people ? await people.setupLink() : '',
    token,
    port,
    fetch: handle,
    stop: () => {
      clock.stop();
      unlisten();
      site.stop();
      extensions.close();
      shared.close();
      server?.stop(true);
    },
  };
}
