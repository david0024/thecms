/** Relations between entries and the further kinds of field (ADR 0052). */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  backlinks,
  type Block,
  type ContentType,
  createBlock,
  fieldShown,
  linkedEntries,
  normalizeBlocks,
  normalizePost,
  normalizeSite,
  normalizeTypes,
  parseTheme,
  placesRelated,
  type Post,
  postsType,
  relatedIn,
  type Theme,
  typeById,
  unlinked,
} from '../src/core/index.ts';
import { buildSite } from '../src/site/export.ts';
import { renderPost } from '../src/site/document.ts';
import { type EditorServer, startEditor } from '../src/site/server.ts';
import { Store } from '../src/site/store.ts';
import plain from '../themes/plain.json';

const theme = parseTheme(plain).theme as Theme;
const TYPES = [
  {
    name: 'Projects',
    singular: 'Project',
    fields: [
      { label: 'Client', kind: 'entries', to: 'clients' },
      { label: 'Partners', kind: 'entries', to: 'clients', many: true },
      { label: 'Like it', kind: 'entries', to: 'projects', many: true },
      { label: 'Area', kind: 'number' },
      { label: 'Available', kind: 'yesno' },
      { label: 'State', kind: 'choice', options: 'New\nSold\n\nNew\n  Sold out  ' },
      { label: 'Sheet', kind: 'file' },
    ],
  },
  { name: 'Clients', singular: 'Client', fields: [] },
  { name: 'Notes', singular: 'Note', fields: [{ label: 'About', kind: 'entries', to: 'clients' }] },
  postsType(),
];
const site = normalizeSite({ name: 'S', url: 'https://example.com', types: TYPES });
const type = (id: string): ContentType => typeById(site, id) as ContentType;
const projects = type('projects');
const clients = type('clients');
const notes = type('notes');
const entry = (of: ContentType, over: Record<string, unknown>): Post => normalizePost({ blocks: [], ...over }, '2026-01-01', of).post;
const field = (of: ContentType, key: string) => of.fields.find((f) => f.key === key) as ContentType['fields'][number];

const acme = entry(clients, { title: 'Acme', cover: { src: '/media/acme.png', alt: '' } });
const zeta = entry(clients, { title: 'Zeta' });
const kitchen = entry(projects, { title: 'Kitchen', fields: { client: ['acme'], partners: ['zeta', 'acme'], like_it: ['bath'], area: '12,5', available: true, state: 'Sold' } });
const bath = entry(projects, { title: 'Bath', fields: { client: ['zeta'], like_it: ['kitchen'], available: false } });
const memo = entry(notes, { title: 'Memo', fields: { about: ['acme'] } });
const lists = { projects: { type: projects, entries: [bath, kitchen] }, clients: { type: clients, entries: [acme, zeta] }, notes: { type: notes, entries: [memo] } };

describe('the kinds of field a type may have', () => {
  test('a choice keeps its choices once each; a link says its type and whether it holds several', () => {
    expect(projects.fields).toEqual([
      { key: 'client', label: 'Client', kind: 'entries', to: 'clients' },
      { key: 'partners', label: 'Partners', kind: 'entries', to: 'clients', many: true },
      { key: 'like_it', label: 'Like it', kind: 'entries', to: 'projects', many: true },
      { key: 'area', label: 'Area', kind: 'number' },
      { key: 'available', label: 'Available', kind: 'yesno' },
      { key: 'state', label: 'State', kind: 'choice', options: ['New', 'Sold', 'Sold out'] },
      { key: 'sheet', label: 'Sheet', kind: 'file' },
    ]);
    const many = normalizeTypes([{ name: 'X', fields: [{ label: 'C', kind: 'choice', options: Array.from({ length: 40 }, (_, i) => `c${i}`) }] }])[0] as ContentType;
    expect(many.fields[0]?.options).toHaveLength(30);
  });

  test('a link to a type the site does not have goes with that type', () => {
    const [only] = normalizeTypes([{ name: 'Projects', fields: [{ label: 'Client', kind: 'entries', to: 'clients' }, { label: 'Notes', kind: 'text' }] }]);
    expect(only?.fields).toEqual([{ key: 'notes', label: 'Notes', kind: 'text' }]);
  });

  test('each value is cleaned as its kind', () => {
    expect(kitchen.fields).toEqual({ client: ['acme'], partners: ['zeta', 'acme'], like_it: ['bath'], area: 12.5, available: true, state: 'Sold', sheet: null });
    const odd = entry(projects, {
      title: 'Odd',
      fields: { client: ['a', 'b'], partners: ['x', 'x', '', 7, 'Y Z', ...Array.from({ length: 30 }, (_, i) => `p${i}`)], like_it: 'bath', area: 'many', available: 'yes', state: 'Gone', sheet: { src: '/media/0123456789abcdef0123456789abcdef.pdf', label: 'The sheet' } },
    });
    expect(odd.fields.client).toEqual(['a']);
    expect((odd.fields.partners as string[]).slice(0, 3)).toEqual(['x', 'y-z', 'p0']);
    expect(odd.fields.partners).toHaveLength(20);
    expect(odd.fields.like_it).toEqual([]);
    expect(odd.fields.area).toBeNull();
    expect(odd.fields.available).toBeNull();
    expect(odd.fields.state).toBe('');
    expect(odd.fields.sheet).toEqual({ src: '/media/0123456789abcdef0123456789abcdef.pdf', label: 'The sheet' });
    expect(entry(projects, { title: 'N', fields: { area: 3 } }).fields.area).toBe(3);
    expect(entry(projects, { title: 'N', fields: { area: '' } }).fields.area).toBeNull();
  });
});

describe('links between entries', () => {
  test('a link leads to the entries there to be drawn, in the order the author put them', () => {
    expect(linkedEntries(kitchen, field(projects, 'partners'), lists).map((e) => e.title)).toEqual(['Zeta', 'Acme']);
    expect(linkedEntries(entry(projects, { title: 'P', fields: { partners: ['gone', 'acme'] } }), field(projects, 'partners'), lists).map((e) => e.title)).toEqual(['Acme']);
    expect(linkedEntries(kitchen, field(projects, 'client'), {})).toEqual([]);
  });

  test('the entries that link to one, by type and field; a type with two such fields names the field', () => {
    const groups = backlinks(clients, acme, lists);
    expect(groups.map((g) => [g.type.id, g.field.key, g.named, g.entries.map((e) => e.title)])).toEqual([
      ['projects', 'client', true, ['Kitchen']],
      ['projects', 'partners', true, ['Kitchen']],
      ['notes', 'about', false, ['Memo']],
    ]);
    expect(backlinks(projects, kitchen, lists).map((g) => g.entries.map((e) => e.title))).toEqual([['Bath']]);
    // An entry that links to itself is not listed under itself.
    const self = entry(projects, { title: 'Self', fields: { like_it: ['self'] } });
    expect(backlinks(projects, self, { projects: { type: projects, entries: [self] } })).toEqual([]);
  });

  test('the entries of a list linked to one, either way, never itself', () => {
    expect(relatedIn(lists.clients, projects, kitchen).map((e) => e.title)).toEqual(['Acme', 'Zeta']);
    expect(relatedIn(lists.projects, clients, zeta).map((e) => e.title)).toEqual(['Bath', 'Kitchen']);
    expect(relatedIn(lists.projects, projects, kitchen).map((e) => e.title)).toEqual(['Bath']);
    expect(relatedIn(lists.notes, projects, kitchen)).toEqual([]);
  });

  test('a deleted entry is taken out of the links that held it', () => {
    expect(unlinked(projects, kitchen.fields, 'clients', 'acme')).toEqual({ ...kitchen.fields, client: [], partners: ['zeta'] });
    expect(unlinked(projects, kitchen.fields, 'clients', 'nobody')).toBeNull();
    expect(unlinked(projects, { client: 'acme' }, 'clients', 'acme')).toBeNull();
  });

  test('a field is drawn only when it has something to show', () => {
    const empty = entry(projects, { title: 'E' });
    for (const f of projects.fields) expect(fieldShown(f, empty, lists)).toBe(false);
    expect(fieldShown(field(projects, 'available'), bath, lists)).toBe(true);
    expect(fieldShown(field(projects, 'client'), kitchen, lists)).toBe(true);
    expect(fieldShown(field(projects, 'client'), kitchen, {})).toBe(false);
  });

  test('a type\'s page places the linked entries, or they are drawn after it', () => {
    const part = (p: string): Block => normalizeBlocks([{ type: 'entry', content: { part: p } }]).blocks[0] as Block;
    expect(placesRelated([part('body')])).toBe(false);
    expect(placesRelated(normalizeBlocks([{ type: 'group', children: [{ type: 'entry', content: { part: 'related' } }] }]).blocks)).toBe(true);
    expect(createBlock('entries').content.related).toBe(false);
  });
});

describe('drawn on the site', () => {
  const body = (html: string): string => html.slice(html.indexOf('<body'));

  test('an entry shows its fields and the entries it links to; one linked to shows who links to it', () => {
    const html = body(renderPost(site, theme, kitchen, [], projects, lists));
    expect(html).toContain('<dt>Area</dt>');
    expect(html).toMatch(/<dd>12\.5<\/dd>|<dd>12,5<\/dd>/);
    expect(html).toContain('<dd>Yes</dd>');
    expect(html).toContain('<dd>Sold</dd>');
    expect(html).toMatch(/<a href="\/clients\/acme\/"><img src="\/media\/acme\.png"[^>]*> <span>Acme<\/span><\/a>|<a href="\/clients\/acme\/"><img src="\/media\/acme\.png"[^>]*><span>Acme<\/span><\/a>/);
    expect(html).toContain('data-related="projects/like_it"');
    const client = body(renderPost(site, theme, acme, [], clients, lists));
    expect(client).toContain('<h2>Projects · Client</h2>');
    expect(client).toContain('<h2>Projects · Partners</h2>');
    expect(client).toContain('<h2>Notes</h2>');
    expect(client).toContain('href="/notes/memo/"');
    expect(body(renderPost(site, theme, bath, [], projects, lists))).toContain('<dd>No</dd>');
  });

  test('a file field is a link to the file; the site\'s language says yes or no', () => {
    const ro = normalizeSite({ ...site, language: 'ro' });
    const sheet = entry(projects, { title: 'S', fields: { sheet: { src: '/media/0123456789abcdef0123456789abcdef.pdf', label: 'Fișa' }, available: true } });
    const html = body(renderPost(ro, theme, sheet, [], projects, {}));
    expect(html).toContain('<a href="/media/0123456789abcdef0123456789abcdef.pdf" class="entry-file">Fișa</a>');
    expect(html).toContain('<dd>Da</dd>');
  });

  test('a type\'s page draws the linked entries where its part is, and a field alone as its kind', () => {
    const page = normalizeBlocks([
      { type: 'entry', content: { part: 'related' } },
      { type: 'entry', content: { part: 'field:client' } },
      { type: 'entry', content: { part: 'field:area' } },
      { type: 'entry', content: { part: 'field:available' } },
      { type: 'entry', content: { part: 'field:sheet' } },
    ]).blocks;
    const html = body(renderPost(site, theme, kitchen, [], projects, lists, page));
    expect(html.match(/data-related=/g)).toHaveLength(1);
    expect(html).toContain('<div class="entry-related" data-related="projects/like_it">');
    expect(html).toContain('<ul class="entry-links">');
    expect(html).toMatch(/<p>12[.,]5<\/p>/);
    expect(html).toContain('<p>Yes</p>');
    const none = body(renderPost(site, theme, entry(projects, { title: 'None' }), [], projects, lists, page));
    expect(none).not.toContain('entry-links');
  });

  test('a block that lists entries may list only those linked to the entry shown', () => {
    const listing = (related: boolean): Block[] => normalizeBlocks([{ type: 'entries', content: { title: 'Linked', source: 'clients', count: 5, more: '', related } }]).blocks;
    const linked = body(renderPost(site, theme, bath, [], projects, lists, listing(true)));
    expect(linked).toContain('/clients/zeta/');
    expect(linked).not.toContain('/clients/acme/');
    const all = body(renderPost(site, theme, bath, [], projects, lists, listing(false)));
    expect(all).toContain('/clients/acme/');
  });

  test('the export draws both sides from what is published, and takes a file field\'s file along', async () => {
    const withSheet = { ...kitchen, fields: { ...kitchen.fields, sheet: { src: '/media/0123456789abcdef0123456789abcdef.pdf', label: 'Sheet' } } };
    const media = (name: string) => (name === '0123456789abcdef0123456789abcdef.pdf' || name === 'acme.png' ? new Uint8Array([1]) : null);
    const files = await buildSite(site, theme, [{ slug: '', title: 'Home', description: '', inMenu: true, blocks: [] }], media, { projects: [withSheet], clients: [acme] });
    expect(files.has('media/0123456789abcdef0123456789abcdef.pdf')).toBe(true);
    expect(files.get('clients/acme/index.html') as string).toContain('href="/projects/kitchen/"');
    // Zeta is not published: the kitchen does not lead to it.
    expect(files.get('projects/kitchen/index.html') as string).not.toContain('/clients/zeta/');
  });
});

describe('the store and the editor keep links whole', () => {
  let store: Store;
  let editor: EditorServer;
  const call = (path: string, init: RequestInit = {}): Promise<Response> =>
    editor.fetch(new Request(`http://127.0.0.1:${editor.port}${path}`, { ...init, headers: { 'x-thecms-token': editor.token, host: `127.0.0.1:${editor.port}`, 'content-type': 'application/json' } }));
  beforeEach(async () => {
    store = await Store.open(':memory:');
    await store.setSite(site);
    await store.setTheme(plain);
    await store.savePage({ slug: '', title: 'Home', description: '', inMenu: true, blocks: [] });
    editor = await startEditor(store, { listen: false });
  });
  afterEach(async () => {
    editor.stop();
    await store.close();
  });

  test('an entry says which link to it; deleting it takes it out of them, drafts and published alike', async () => {
    await store.saveEntry('clients', { title: 'Acme' });
    await store.saveEntry('clients', { title: 'Zeta' });
    await store.saveEntry('projects', { title: 'Kitchen', fields: { client: ['acme'], partners: ['acme', 'zeta'] } });
    await store.publishEntry('projects', 'kitchen');
    await store.saveEntry('projects', { title: 'Bath', fields: { partners: ['acme'] } });
    await store.saveEntry('notes', { title: 'Memo', fields: { about: ['zeta'] } });
    const state = (await (await call('/api/state')).json()) as { entries: Record<string, { slug: string; usedBy?: string[] }[]> };
    expect(state.entries.clients).toEqual([expect.objectContaining({ slug: 'acme', usedBy: ['Bath', 'Kitchen'] }), expect.objectContaining({ slug: 'zeta', usedBy: ['Kitchen', 'Memo'] })]);
    expect(state.entries.projects?.[0]?.usedBy).toBeUndefined();

    const after = (await (await call('/api/page?kind=clients&slug=acme', { method: 'DELETE' })).json()) as { entries: Record<string, { slug: string; usedBy?: string[]; changed: boolean }[]> };
    expect(after.entries.clients?.map((e) => e.slug)).toEqual(['zeta']);
    expect((await store.entryDraft('projects', 'kitchen'))?.fields).toMatchObject({ client: [], partners: ['zeta'] });
    expect((await store.publishedEntries('projects'))[0]?.fields).toMatchObject({ client: [], partners: ['zeta'] });
    // What was published and the draft were the same, and still are.
    expect(after.entries.projects?.find((e) => e.slug === 'kitchen')?.changed).toBe(false);
    expect((await store.entryDraft('projects', 'bath'))?.fields.partners).toEqual([]);
    expect((await store.entryDraft('notes', 'memo'))?.fields.about).toEqual(['zeta']);
    // A new entry at the old address is linked by nobody.
    await store.saveEntry('clients', { title: 'Acme' });
    expect((await store.linkedFrom()).get('clients/acme')).toBeUndefined();
  });

  test('the editor draws the links from the drafts', async () => {
    await store.saveEntry('clients', { title: 'Acme' });
    const page = { title: 'Kitchen', slug: 'kitchen', fields: { client: ['acme'] } };
    const drawn = (await (await call('/api/render', { method: 'POST', body: JSON.stringify({ kind: 'projects', page }) })).json()) as { body: string };
    expect(drawn.body).toContain('<span>Acme</span>');
  });
});
