import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { type Block, type ContentType, createBlock, defaultTemplate, normalizeBlocks, normalizePost, normalizeSite, parseTheme, type Post, postsType, type Theme } from '../src/core/index.ts';
import { renderPage, renderPost, renderPostParts } from '../src/site/document.ts';
import { buildSite, exportSite } from '../src/site/export.ts';
import { type EditorServer, startEditor } from '../src/site/server.ts';
import { Store } from '../src/site/store.ts';
import plain from '../themes/plain.json';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const theme = parseTheme(plain).theme as Theme;
const site = normalizeSite({ name: 'S', types: [{ name: 'Projects', fields: [{ label: 'Client', kind: 'text' }] }, postsType()] });
const projects = site.types[0] as ContentType;
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='), (c) => c.charCodeAt(0));
const blocks = (list: unknown[]): Block[] => normalizeBlocks(list).blocks;
const paragraph = (text: string) => ({ type: 'text', content: { body: [{ type: 'paragraph', children: [{ text }] }] } });
const oak: Post = normalizePost({ slug: 'oak', title: 'Oak kitchen', fields: { client: 'The Popescu family' }, blocks: [paragraph('Built in six weeks.')] }, '2026-01-01', projects).post;
const part = (name: string) => ({ type: 'entry', content: { part: name } });
const bodyOf = (html: string): string => html.slice(html.indexOf('<body'), html.indexOf('</body>'));

describe('a part of the entry', () => {
  test('names one of the parts an entry has, or one field; anything else is the header', () => {
    expect(createBlock('entry').content).toEqual({ part: 'header' });
    expect(blocks([part('body'), part('field:client'), part('field:Not A Key!'), part('script'), { type: 'entry' }]).map((b) => b.content.part)).toEqual([
      'body',
      'field:client',
      'header',
      'header',
      'header',
    ]);
    expect(defaultTemplate().map((b) => b.content.part)).toEqual(['header', 'body']);
  });

  test("a type's page puts the entry's parts where it says, with any block around them", () => {
    const template = blocks([{ type: 'hero', content: { title: 'Our work' } }, part('field:client'), part('title'), part('body'), { type: 'contact', content: { title: 'Want one?' } }]);
    const html = bodyOf(renderPost(site, theme, oak, [], projects, {}, template));
    const order = ['Our work', 'The Popescu family', '<h1>Oak kitchen</h1>', 'Built in six weeks.', 'Want one?'].map((s) => html.indexOf(s));
    expect(order.every((at) => at > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).not.toMatch(/data-frozen|data-live|data-type=/);
  });

  test('without a page of its own, an entry is drawn exactly as before', () => {
    expect(renderPost(site, theme, oak, [], projects, {}, null)).toBe(renderPost(site, theme, oak, [], projects, {}));
    expect(bodyOf(renderPost(site, theme, oak, [], projects))).toContain('<header class="b post-head">');
  });

  test('draws nothing on an ordinary page, nor inside the entry it shows', () => {
    const page = { slug: 'x', title: 'X', description: '', inMenu: false, blocks: blocks([part('title'), part('body')]) };
    expect(bodyOf(renderPage(site, theme, page, []))).not.toMatch(/<h1>|entry-body/);
    // An entry that holds a part of itself does not hold itself forever.
    const loop = normalizePost({ slug: 'loop', title: 'Loop', blocks: [part('body'), part('title'), paragraph('Once.')] }, '2026-01-01', projects).post;
    const html = bodyOf(renderPost(site, theme, loop, [], projects, {}, blocks([part('body')])));
    expect(html.match(/Once\./g)).toHaveLength(1);
    expect(html).not.toContain('<h1>Loop</h1>');
  });

  test("a field the entry left empty is not drawn, and what was typed is text", () => {
    const empty = normalizePost({ slug: 'e', title: '<b>bold</b>', blocks: [] }, '2026-01-01', projects).post;
    const html = bodyOf(renderPost(site, theme, empty, [], projects, {}, blocks([part('field:client'), part('title')])));
    expect(html).toContain('<h1>&lt;b>bold&lt;/b></h1>');
    expect(html).not.toContain('<p></p>');
  });
});

describe('in the editor', () => {
  const template = blocks([{ type: 'hero', content: { title: 'Our work' } }, part('body')]);

  test("typing into an entry: the type's page around it cannot be selected or typed into", () => {
    const { body } = renderPostParts(site, theme, oak, [], true, projects, {}, template);
    const frozen = body.slice(body.indexOf('data-frozen'), body.indexOf('data-live'));
    const live = body.slice(body.indexOf('data-live'));
    expect(frozen).toContain('Our work');
    expect(frozen).not.toMatch(/data-edit|data-type=/);
    expect(live).toContain('data-type="text"');
    expect(live).toContain('data-edit-rich');
  });

  test("designing the type's page: the example entry inside it cannot be typed into", () => {
    const { body } = renderPostParts(site, theme, oak, [], true, projects, {}, template, true);
    expect(body).toContain('data-type="hero"');
    expect(body).toContain('data-type="entry"');
    const example = body.slice(body.indexOf('data-frozen'));
    expect(example).toContain('Built in six weeks.');
    expect(example).not.toMatch(/data-edit|data-type=/);
    expect(body).not.toContain('data-live');
  });

  test("a block's own style on the type's page reaches the page", () => {
    const styled = blocks([{ type: 'hero', content: { title: 'Styled' }, style: { paddingBlock: { value: '7rem' } } }, part('body')]);
    expect(renderPostParts(site, theme, oak, [], false, projects, {}, styled).css).toContain(`[data-b="${styled[0]?.id}"]`);
  });
});

describe("a type's page in the store, the export and the editing API", () => {
  let dir: string;
  let store: Store;
  let editor: EditorServer;
  const HOST = '127.0.0.1:4321';
  const call = (path: string, method = 'GET', body?: unknown): Promise<Response> =>
    editor.fetch(
      new Request(`http://${HOST}${path}`, {
        method,
        headers: { host: HOST, 'x-thecms-token': editor.token, ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      }),
    );

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'thecms-tpl-'));
    store = await Store.open(join(dir, 'site.db'));
    await store.setSite(site);
    await store.setTheme(plain);
    await store.publishTheme();
    await store.publish((await store.savePage({ slug: '', title: 'Home', blocks: [] })).slug);
    await store.publishEntry('projects', (await store.saveEntry('projects', oak)).slug);
    editor = await startEditor(store, { listen: false });
  });
  afterEach(async () => {
    editor.stop();
    await store.close();
    await rm(dir, { recursive: true, force: true });
  });

  test('is a draft until published; visitors keep the old page meanwhile; going back to the default is published too', async () => {
    expect(await store.template('projects')).toBeNull();
    await store.setTemplate('projects', [{ type: 'hero', content: { title: 'Our work' } }, part('body')]);
    const out = join(dir, 'out');
    await exportSite(store, out);
    expect(await Bun.file(join(out, 'projects/oak/index.html')).text()).not.toContain('Our work');
    expect(await store.templateChanged('projects')).toBe(true);
    await store.publishTemplate('projects');
    await exportSite(store, out);
    expect(await Bun.file(join(out, 'projects/oak/index.html')).text()).toContain('Our work');
    await store.setTemplate('projects', null);
    await exportSite(store, out);
    expect(await Bun.file(join(out, 'projects/oak/index.html')).text()).toContain('Our work');
    await store.publishTemplate('projects');
    await exportSite(store, out);
    expect(await Bun.file(join(out, 'projects/oak/index.html')).text()).not.toContain('Our work');
    await expect(store.setTemplate('nothing', [])).rejects.toThrow('no content type');
  });

  test("an image on a type's page is exported, and is not deleted while the page shows it", async () => {
    const image = await store.addMedia(PNG, 'p.png');
    await store.setTemplate('projects', [{ type: 'image', content: { image: { src: image.path, alt: '' } } }, part('body')]);
    await store.publishTemplate('projects');
    await expect(store.deleteMedia(image.name)).rejects.toThrow('the page of "Projects"');
    const files = await exportSite(store, join(dir, 'out'));
    expect(files).toContain(image.path.slice(1));
  });

  test('the builder opens it as a page, starting from the default one, and saves, draws and publishes it', async () => {
    const opened = (await (await call('/api/page?kind=template:projects&slug=projects')).json()) as { page: { title: string; blocks: Block[] } };
    expect(opened.page.title).toBe(`${projects.singular} page`);
    expect(opened.page.blocks.map((b) => b.content.part)).toEqual(['header', 'body']);
    const page = { ...opened.page, blocks: [{ type: 'hero', content: { title: 'Our work' } }, ...opened.page.blocks] };
    const saved = (await (await call('/api/page', 'PUT', { page, kind: 'template:projects' })).json()) as { templates: Record<string, unknown> };
    expect(saved.templates.projects).toEqual({ custom: true, published: false, changed: true });
    const drawn = (await (await call('/api/render', 'POST', { page, kind: 'template:projects' })).json()) as { body: string };
    expect(drawn.body).toContain('Our work');
    // The newest entry is the example.
    expect(drawn.body).toContain('Built in six weeks.');
    // An entry being edited is drawn inside the type's page as it is being worked on.
    const entry = (await (await call('/api/render', 'POST', { page: oak, kind: 'projects' })).json()) as { body: string };
    expect(entry.body).toContain('Our work');
    expect(entry.body).toContain('data-live');
    const published = (await (await call('/api/publish', 'POST', { slug: 'projects', kind: 'template:projects' })).json()) as { templates: Record<string, unknown> };
    expect(published.templates.projects).toEqual({ custom: true, published: true, changed: false });
    const reset = (await (await call('/api/page?kind=template:projects&slug=projects', 'DELETE')).json()) as { templates: Record<string, unknown> };
    expect(reset.templates.projects).toEqual({ custom: false, published: true, changed: true });
  });

  test('a type with no entries is designed around an example', async () => {
    await store.setSite({ ...site, types: [...site.types, { name: 'Team', singular: 'Person' }] });
    const drawn = (await (await call('/api/render', 'POST', { page: { blocks: defaultTemplate() }, kind: 'template:team' })).json()) as { body: string };
    expect(drawn.body).toContain('An example person');
    expect(await store.entries('team')).toEqual([]);
  });
});

test('a site exported with no pages of its own for its types is unchanged by them', async () => {
  const withNone = await buildSite(site, theme, [{ slug: '', title: 'Home', description: '', inMenu: true, blocks: [] }], () => null, { projects: [oak] });
  const withNulls = await buildSite(site, theme, [{ slug: '', title: 'Home', description: '', inMenu: true, blocks: [] }], () => null, { projects: [oak] }, [], { projects: null, posts: null });
  expect([...withNulls.entries()]).toEqual([...withNone.entries()]);
});
