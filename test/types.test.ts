import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ContentType, contentTypes, normalizePost, normalizeSite, normalizeTypes, parseTheme, type Post, postsType, resolveMenu, type Theme } from '../src/core/index.ts';
import { buildSite } from '../src/site/export.ts';
import { type EditorServer, startEditor } from '../src/site/server.ts';
import { Store } from '../src/site/store.ts';
import plain from '../themes/plain.json';

const theme = parseTheme(plain).theme as Theme;
const PROJECTS = {
  name: 'Projects',
  singular: 'Project',
  categories: true,
  fields: [
    { label: 'Client', kind: 'text' },
    { label: 'Finished on', kind: 'date' },
    { label: 'Their site', kind: 'link' },
    { label: 'Plan', kind: 'image' },
    { label: 'Notes', kind: 'longtext' },
  ],
};
const projects = normalizeTypes([PROJECTS])[0] as ContentType;
const site = normalizeSite({ name: 'S', url: 'https://example.com', types: [PROJECTS, { name: 'Events', dated: true, feed: true }] });
const home = { slug: '', title: 'Home', description: '', inMenu: true, blocks: [] };
const entry = (type: ContentType, over: Record<string, unknown>): Post => normalizePost({ blocks: [], ...over }, '2026-01-01', type).post;
const text = (files: Map<string, string | Uint8Array>, path: string): string => files.get(path) as string;

describe('a content type as a document', () => {
  test('a type is a name, an address and a few choices; the rest is worked out', () => {
    expect(projects).toEqual({
      id: 'projects',
      name: 'Projects',
      singular: 'Project',
      path: 'projects',
      dated: false,
      categories: true,
      feed: false,
      fields: [
        { key: 'client', label: 'Client', kind: 'text' },
        { key: 'finished_on', label: 'Finished on', kind: 'date' },
        { key: 'their_site', label: 'Their site', kind: 'link' },
        { key: 'plan', label: 'Plan', kind: 'image' },
        { key: 'notes', label: 'Notes', kind: 'longtext' },
      ],
    });
  });

  test('two types never answer at one address, and none takes the site\'s own', () => {
    const types = normalizeTypes([
      { name: 'Team' },
      { name: 'People', path: 'team' },
      { name: 'Team' },
      { name: 'Blog' },
      { name: 'Files', path: 'media' },
      { name: 'Posts' },
      { name: 'Journal', id: 'posts', path: 'journal' },
      { name: '' },
      'nonsense',
    ]);
    expect(types.map((t) => [t.id, t.path])).toEqual([['team', 'team']]);
    expect(normalizeTypes(Array.from({ length: 30 }, (_, i) => ({ name: `Type ${i}` })))).toHaveLength(12);
  });

  test('a feed needs dates; a field keeps its key when it is renamed; a field of an unknown kind is short text', () => {
    expect(normalizeTypes([{ name: 'A', feed: true }])[0]?.feed).toBe(false);
    expect(normalizeTypes([{ name: 'A', feed: true, dated: true }])[0]?.feed).toBe(true);
    const fields = normalizeTypes([{ name: 'A', fields: [{ key: 'client', label: 'Customer' }, { label: 'Customer' }, { label: 'Client', kind: 'script' }] }])[0]?.fields;
    expect(fields).toEqual([
      { key: 'client', label: 'Customer', kind: 'text' },
      { key: 'customer', label: 'Customer', kind: 'text' },
    ]);
  });

  test('posts are always the first type, named as the site names its blog', () => {
    expect(contentTypes(normalizeSite({ blogTitle: 'Journal', types: [PROJECTS] })).map((t) => [t.id, t.name, t.path])).toEqual([
      ['posts', 'Journal', 'blog'],
      ['projects', 'Projects', 'projects'],
    ]);
  });
});

describe('an entry of a type', () => {
  test('it holds what its type asks for, each value checked as its kind, and nothing else', () => {
    const cleaned = entry(projects, {
      title: 'A kitchen',
      categories: ['Homes'],
      fields: {
        client: '  The Popescu\nfamily ',
        finished_on: '2026-02-30',
        their_site: { label: 'Visit', href: 'javascript:alert(1)' },
        plan: { src: 'javascript:alert(2)', alt: 'x' },
        notes: 'Line one\nLine two',
        secret: 'not a field of this type',
      },
    });
    expect(cleaned.fields).toEqual({ client: 'The Popescu family', finished_on: '', their_site: { label: 'Visit', href: '' }, plan: null, notes: 'Line one\nLine two' });
    expect(cleaned.categories).toEqual(['Homes']);
  });

  test('a type without categories keeps none; a post has no extra fields', () => {
    const events = normalizeTypes([{ name: 'Events', dated: true }])[0] as ContentType;
    expect(entry(events, { title: 'E', categories: ['News'] }).categories).toEqual([]);
    expect(entry(postsType(), { title: 'P', fields: { client: 'x' } }).fields).toEqual({});
  });
});

describe('the store keeps every type', () => {
  let store: Store;
  beforeEach(() => {
    store = new Store(':memory:');
    store.setSite(site);
  });
  afterEach(() => store.close());

  test('entries of two types may share an address word; each type lists its own', () => {
    store.saveEntry('projects', { title: 'Opening' });
    store.saveEntry('events', { title: 'Opening', date: '2026-03-01' });
    store.savePost({ title: 'Opening' });
    expect(store.entries('projects').map((e) => e.slug)).toEqual(['opening']);
    expect(store.entries('events')).toHaveLength(1);
    expect(store.posts()).toHaveLength(1);
    store.deleteEntry('projects', 'opening');
    expect(store.entries('projects')).toEqual([]);
    expect(store.entries('events')).toHaveLength(1);
  });

  test('a type that is not dated lists by title; a dated one, newest first', () => {
    for (const title of ['Zebra', 'apple', 'Mango']) store.saveEntry('projects', { title });
    expect(store.entries('projects').map((e) => e.title)).toEqual(['apple', 'Mango', 'Zebra']);
    store.saveEntry('events', { title: 'Old', date: '2025-01-01' });
    store.saveEntry('events', { title: 'New', date: '2026-01-01' });
    expect(store.entries('events').map((e) => e.title)).toEqual(['New', 'Old']);
  });

  test('an entry of a type the site does not have is an error, not a silent post', () => {
    expect(() => store.saveEntry('recipes', { title: 'Soup' })).toThrow('no content type "recipes"');
    expect(() => store.entries('recipes')).toThrow();
  });

  test('a page and a type cannot share an address, whichever comes first', () => {
    expect(() => store.savePage({ slug: 'projects', title: 'Projects' })).toThrow('used by the site itself');
    store.savePage({ slug: 'team', title: 'Team' });
    expect(() => store.setSite({ ...site, types: [...site.types, { name: 'Team' }] })).toThrow('a page already lives at "/team/"');
    expect(store.site().types.map((t) => t.id)).toEqual(['projects', 'events']);
  });

  test('a type that still has entries is not removed', () => {
    store.saveEntry('projects', { title: 'A kitchen' });
    expect(() => store.setSite({ ...site, types: [] })).toThrow('"Projects" still has 1 entry');
    store.deleteEntry('projects', 'a-kitchen');
    expect(store.setSite({ ...site, types: [] }).types).toEqual([]);
  });

  test('an image in a field counts as used', async () => {
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='), (c) => c.charCodeAt(0));
    const image = store.addMedia(png, 'plan.png');
    store.saveEntry('projects', { title: 'A kitchen', fields: { plan: { src: image.path, alt: 'The plan' } } });
    expect(store.mediaUsedBy(image.name)).toEqual(['A kitchen']);
    expect(() => store.deleteMedia(image.name)).toThrow('A kitchen');
  });
});

describe('a site made before there were content types', () => {
  let dir: string;
  beforeEach(async () => void (dir = await mkdtemp(join(tmpdir(), 'thecms-types-'))));
  afterEach(() => rm(dir, { recursive: true, force: true }));

  test('its posts are still its posts', () => {
    const path = join(dir, 'old.db');
    const old = new Database(path, { create: true });
    old.exec('CREATE TABLE posts (slug TEXT PRIMARY KEY, draft TEXT NOT NULL, published TEXT, published_at TEXT, updated_at TEXT NOT NULL)');
    const post = JSON.stringify({ slug: 'hello', title: 'Hello', date: '2025-05-05', blocks: [] });
    old.query('INSERT INTO posts VALUES (?, ?, ?, ?, ?)').run('hello', post, post, '2025-05-05', '2025-05-05');
    old.query('INSERT INTO posts VALUES (?, ?, NULL, NULL, ?)').run('draft', JSON.stringify({ slug: 'draft', title: 'Draft', blocks: [] }), '2025-05-06');
    old.close();
    for (let opened = 0; opened < 2; opened++) {
      const store = new Store(path);
      expect(store.posts().map((p) => [p.slug, p.published])).toEqual([['hello', true], ['draft', false]]);
      expect(store.publishedPosts().map((p) => p.title)).toEqual(['Hello']);
      store.close();
    }
  });
});

describe('the exported site', () => {
  const kitchen = entry(projects, { title: 'A kitchen', categories: ['Homes'], fields: { client: 'Popescu <b>family</b>', their_site: { label: 'Visit', href: 'https://popescu.example' }, finished_on: '2026-02-03' } });
  const attic = entry(projects, { title: 'An attic' });
  const events = site.types[1] as ContentType;
  const fair = entry(events, { title: 'Spring fair', date: '2026-04-01' });
  const build = (entries: Record<string, Post[]>, of = site) => buildSite(of, theme, [home], () => null, entries);

  test('each type has a list, a page for every entry, and its categories, under its own address', async () => {
    const files = await build({ projects: [kitchen, attic], events: [fair] });
    for (const path of ['projects/index.html', 'projects/a-kitchen/index.html', 'projects/an-attic/index.html', 'projects/category/homes/index.html', 'events/index.html', 'events/spring-fair/index.html']) {
      expect(files.has(path)).toBe(true);
    }
    expect(files.has('blog/index.html')).toBe(false);
    const list = text(files, 'projects/index.html');
    expect(list).toContain('<h1>Projects</h1>');
    expect(list.indexOf('A kitchen')).toBeLessThan(list.indexOf('An attic'));
    expect(list).toContain('href="/projects/a-kitchen/"');
    expect(list).not.toContain('<time');
    expect(text(files, 'sitemap.xml')).toContain('https://example.com/projects/a-kitchen/');
  });

  test('an entry shows its fields by name; what was typed is text; an empty field is not drawn', async () => {
    const page = text(await build({ projects: [kitchen] }), 'projects/a-kitchen/index.html');
    expect(page).toContain('<dt>Client</dt>');
    expect(page).toContain('Popescu &lt;b>family&lt;/b>');
    expect(page).toContain('<a href="https://popescu.example">Visit</a>');
    expect(page).toContain('<time datetime="2026-02-03">');
    expect(page).not.toContain('<dt>Notes</dt>');
    expect(page).toContain('href="/projects/category/homes/"');
    expect(text(await build({ projects: [attic] }), 'projects/an-attic/index.html')).not.toContain('entry-fields');
  });

  test('only a type that asks for one has a feed, and a page of that type points at it', async () => {
    const files = await build({ projects: [kitchen], events: [fair] });
    expect(files.has('projects/feed.xml')).toBe(false);
    expect(text(files, 'events/feed.xml')).toContain('<link href="https://example.com/events/spring-fair/"/>');
    expect(text(files, 'events/spring-fair/index.html')).toContain('href="/events/feed.xml"');
    expect(text(files, 'projects/a-kitchen/index.html')).not.toContain('feed.xml');
  });

  test('the menu leads to a type once it has something published, and not before', async () => {
    const nav = (html: string): string => html.slice(html.indexOf('<nav'), html.indexOf('</nav>'));
    expect(nav(text(await build({ projects: [kitchen] }), 'index.html'))).toContain('<a href="/projects/">Projects</a>');
    expect(nav(text(await build({ projects: [kitchen] }), 'index.html'))).not.toContain('Events');
    const arranged = normalizeSite({ ...site, menu: [{ label: 'Our work', target: { kind: 'type', id: 'projects' } }, { label: '', target: { kind: 'type', id: 'events' } }, { label: 'Gone', target: { kind: 'type', id: 'recipes' } }] });
    expect(resolveMenu(arranged, [home], [{ id: 'projects', title: 'Projects', href: '/projects/' }]).map((l) => [l.title, l.href])).toEqual([['Our work', '/projects/']]);
  });

  test('an image in a field is exported with the site, and a missing one stops the export', async () => {
    const withPlan = entry(projects, { title: 'Plan', fields: { plan: { src: '/media/0123456789abcdef0123456789abcdef.png', alt: '' } } });
    expect(build({ projects: [withPlan] })).rejects.toThrow('shows an image this site does not have');
  });
});

describe('the editing API', () => {
  let store: Store;
  let editor: EditorServer;
  const call = (path: string, init: RequestInit = {}): Promise<Response> =>
    editor.fetch(new Request(`http://127.0.0.1:${editor.port}${path}`, { ...init, headers: { 'x-thecms-token': editor.token, host: `127.0.0.1:${editor.port}`, 'content-type': 'application/json' } }));
  beforeEach(async () => {
    store = new Store(':memory:');
    store.setSite(site);
    store.setTheme(plain);
    store.savePage(home);
    editor = await startEditor(store, { listen: false });
  });
  afterEach(() => {
    editor.stop();
    store.close();
  });

  test('an entry of any type is made, drawn and published through the same calls as a page', async () => {
    const made = await call('/api/page', { method: 'PUT', body: JSON.stringify({ kind: 'projects', create: true, page: { title: 'A kitchen', fields: { client: 'Popescu' } } }) });
    expect(made.status).toBe(200);
    const lists = (await made.json()) as { entries: Record<string, { slug: string; published: boolean }[]> };
    expect(lists.entries.projects).toEqual([expect.objectContaining({ slug: 'a-kitchen', published: false })]);
    expect(lists.entries.posts).toEqual([]);
    const opened = (await (await call('/api/page?kind=projects&slug=a-kitchen')).json()) as { page: Post };
    expect(opened.page.fields.client).toBe('Popescu');
    const drawn = (await (await call('/api/render', { method: 'POST', body: JSON.stringify({ kind: 'projects', page: opened.page }) })).json()) as { body: string };
    expect(drawn.body).toContain('<dt>Client</dt>');
    expect(drawn.body).toContain('<a href="/projects/" aria-current="page">Projects</a>');
    await call('/api/publish', { method: 'POST', body: JSON.stringify({ kind: 'projects', slug: 'a-kitchen' }) });
    expect(store.publishedEntries('projects').map((e) => e.title)).toEqual(['A kitchen']);
    expect((await call('/api/page', { method: 'PUT', body: JSON.stringify({ kind: 'projects', create: true, page: { title: 'A kitchen' } }) })).status).toBe(409);
  });

  test('a type the site does not have is refused; a page may not take a type\'s address; a type in use is not removed', async () => {
    expect((await call('/api/page', { method: 'PUT', body: JSON.stringify({ kind: 'recipes', create: true, page: { title: 'Soup' } }) })).status).toBe(400);
    expect((await call('/api/page', { method: 'PUT', body: JSON.stringify({ create: true, page: { title: 'Projects' } }) })).status).toBe(409);
    store.saveEntry('projects', { title: 'A kitchen' });
    const refused = await call('/api/site', { method: 'PUT', body: JSON.stringify({ site: { ...site, types: [] } }) });
    expect(refused.status).toBe(400);
    expect(((await refused.json()) as { error: string }).error).toContain('still has 1 entry');
  });
});
