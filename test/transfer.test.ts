/**
 * A complete export (ADR 0057): the content in one open file and back, the
 * site's data as JSON beside its pages, and the published site as a ZIP.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { postsType } from '../src/core/index.ts';
import { contentPreview, isContentFile, readContentFile, runContentImport } from '../src/import/thecms.ts';
import { exportedFiles, publishedSite } from '../src/site/export.ts';
import { startRuntime } from '../src/site/runtime.ts';
import { type EditorServer, type ImportPreview, type ImportProgress, startEditor } from '../src/site/server.ts';
import { Store } from '../src/site/store.ts';
import { CONTENT_FORMAT, contentFileName, type ContentFile, exportContent } from '../src/site/transfer.ts';
import { zipFiles } from '../src/site/zip.ts';
import plain from '../themes/plain.json';

const be32 = (n: number): number[] => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const le24 = (n: number): number[] => [n & 255, (n >> 8) & 255, (n >> 16) & 255];
const text = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));
const png = (width: number, height: number, tag = 0): Uint8Array => Uint8Array.from([0x89, ...text('PNG'), 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, ...text('IHDR'), ...be32(width), ...be32(height), 8, 6, 0, 0, 0, tag]);
const webpX = (width: number, height: number): Uint8Array => Uint8Array.from([...text('RIFF'), 22, 0, 0, 0, ...text('WEBPVP8X'), 10, 0, 0, 0, 0, 0, 0, 0, ...le24(width - 1), ...le24(height - 1)]);
const paragraph = (words: string) => [{ type: 'paragraph', children: [{ text: words }] }];
const textBlock = (id: string, words: string) => ({ id, type: 'text', content: { body: paragraph(words) } });

/** A ZIP read back, the plain way: its central directory, each file inflated or as stored. */
function unzip(bytes: Uint8Array): Map<string, string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const out = new Map<string, string>();
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(at, true)).toBe(0x02014b50);
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const offset = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
    const start = offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true);
    const body = bytes.subarray(start, start + size);
    const plainBytes = method === 8 ? new Uint8Array(inflateRawSync(body)) : body;
    expect(Bun.hash.crc32(plainBytes) >>> 0).toBe(crc);
    out.set(name, new TextDecoder().decode(plainBytes));
    at += 46 + nameLength;
  }
  return out;
}

/** A site with a little of everything a content export holds. */
async function fullSite(store: Store): Promise<void> {
  await store.setSite({
    name: 'Atelier Pop',
    url: 'https://atelier.example',
    language: 'en',
    languages: ['ro'],
    menu: [{ label: 'About', href: '/about/' }],
    types: [postsType(), { id: 'projects', name: 'Projects', singular: 'Project', path: 'work', comments: true, fields: [{ key: 'client', label: 'Client', type: 'text' }] }],
  });
  await store.setTheme(plain);
  await store.publishTheme();
  await store.setTheme({ ...plain, name: 'Plain, being changed' });
  const picture = await store.addMedia(png(1000, 500), 'workshop.png');
  await store.addVariant(picture.name, webpX(480, 240));
  await store.addMedia(png(10, 10, 7), 'unused.png');
  await store.savePage({ slug: '', title: 'Home', blocks: [textBlock('b_home', 'Welcome'), { id: 'b_pic', type: 'image', content: { image: { src: picture.path, alt: 'The workshop' } } }] });
  await store.publish('');
  await store.savePage({ slug: 'about', title: 'About', blocks: [textBlock('b_about', 'Who we are')], translations: { ro: { slug: 'despre', title: 'Despre', fields: { 'b_about.body': paragraph('Cine suntem') } } } });
  await store.publish('about');
  await store.savePage({ slug: 'about', title: 'About us', blocks: [textBlock('b_about', 'Who we are, being rewritten')] });
  await store.savePage({ slug: 'members', title: 'Members', blocks: [textBlock('b_members', 'Only for members')] });
  await store.publish('members');
  await store.lockPage('members', 'open sesame');
  await store.savePage({ slug: 'soon', title: 'Soon', blocks: [] });
  await store.schedule('page', 'soon', new Date(Date.now() + 86_400_000).toISOString());
  await store.saveSection({ slug: 'footer-note', title: 'Footer note', blocks: [textBlock('b_note', 'Made by hand')] });
  await store.publishSection('footer-note');
  await store.setForms([...(await store.forms()), { name: 'quote', title: 'Ask for a quote', fields: [{ key: 'size', label: 'Size', type: 'text' }] }]);
  await store.setRedirects([{ from: '/old-about/', to: '/about/' }]);
  const ana = await store.addUser({ email: 'ana@example.com', name: 'Ana Pop', role: 'author', password: 'a long password here' });
  await store.setProfile(ana.id, 'Ana Pop', 'Makes chairs.', picture.path);
  await store.saveEntry('projects', { slug: 'bridge', title: 'A bridge', fields: { client: 'The town' }, blocks: [textBlock('b_bridge', 'Oak, over a stream')] }, ana.id);
  await store.publishEntry('projects', 'bridge');
  await store.saveEntry('posts', { slug: 'hello', title: 'Hello', date: '2026-11-01', blocks: [textBlock('b_hello', 'First post')] });
  await store.publishPost('hello');
  await store.setTemplate('projects', [{ id: 'b_entry', type: 'entry', content: {} }]);
  await store.publishTemplate('projects');
  const comment = await store.addComment({ type: 'projects', entry: 'bridge', name: 'Ion', email: 'ion@example.com', body: 'Beautiful', consent: 'yes' });
  await store.approveComment(comment.id);
  await store.addComment({ type: 'projects', entry: 'bridge', name: 'Spam', email: 'spam@example.com', body: 'Buy now', consent: 'yes' });
  await store.addMessage({ form: 'contact', page: '/', name: 'Maria', email: 'maria@example.com', body: 'Hello', consent: 'yes' });
}

describe('the content in one file (ADR 0057 d1)', () => {
  let store: Store;
  beforeEach(async () => {
    store = await Store.open(':memory:');
    await fullSite(store);
  });
  afterEach(async () => await store.close());

  test('holds the content, and never the accounts, the messages, a waiting comment or a password', async () => {
    const file = await exportContent(store, [], new Date('2026-11-22T10:00:00Z'));
    expect(file).toMatchObject({ format: CONTENT_FORMAT, madeAt: '2026-11-22T10:00:00.000Z', parts: ['pages', 'type:posts', 'type:projects', 'sections', 'forms', 'design'], from: { name: 'Atelier Pop', language: 'en', languages: ['ro'] } });
    expect(file.program).toStartWith('thecms ');
    expect(file.pages?.map((p) => p.slug)).toEqual(['', 'about', 'members', 'soon']);
    const about = file.pages?.find((p) => p.slug === 'about');
    expect(about?.draft).toMatchObject({ title: 'About us' });
    expect(about?.published).toMatchObject({ title: 'About', translations: { ro: { title: 'Despre' } } });
    expect(file.pages?.find((p) => p.slug === 'members')?.locked).toBe(true);
    expect(file.pages?.find((p) => p.slug === 'soon')).toMatchObject({ published: null, scheduled: expect.any(String) });
    expect(file.sections?.map((s) => s.slug)).toEqual(['footer-note']);
    expect(file.forms?.map((f) => f.name)).toEqual(['contact', 'quote']);
    expect(file.settings?.menu).toMatchObject([{ label: 'About' }]);
    expect(file.theme?.published?.name).toBe('Plain');
    expect(file.theme?.draft?.name).toBe('Plain, being changed');
    expect(file.redirects).toEqual([{ from: '/old-about/', to: '/about/' }]);
    const projects = file.types.find((t) => t.type.id === 'projects');
    expect(projects?.template.published).toHaveLength(1);
    expect(projects?.entries).toEqual([expect.objectContaining({ slug: 'bridge', author: expect.any(String) })]);
    expect(file.people).toEqual([{ key: projects?.entries[0]?.author as string, email: 'ana@example.com', name: 'Ana Pop', bio: 'Makes chairs.', picture: expect.stringMatching(/^\/media\//) }]);
    expect(file.comments).toEqual([{ type: 'projects', entry: 'bridge', name: 'Ion', body: 'Beautiful', at: expect.any(String) }]);
    // The whole site carries its whole library, each picture with its smaller copies.
    expect(file.media.map((m) => m.label).sort()).toEqual(['unused.png', 'workshop.png']);
    expect(file.media.find((m) => m.label === 'workshop.png')?.variants).toHaveLength(1);
    const words = JSON.stringify(file);
    for (const kept of ['ion@example.com', 'spam@example.com', 'Buy now', 'maria@example.com', 'open sesame', 'argon2', 'a long password here']) expect(words).not.toContain(kept);
  });

  test('a part carries only the files it shows; nothing chosen is refused', async () => {
    const pages = await exportContent(store, ['pages']);
    expect(pages.parts).toEqual(['pages']);
    expect(pages).not.toHaveProperty('settings');
    expect(pages).not.toHaveProperty('sections');
    expect(pages.types).toEqual([]);
    expect(pages.media.map((m) => m.label)).toEqual(['workshop.png']);
    const posts = await exportContent(store, ['type:posts']);
    expect(posts.types.map((t) => t.type.id)).toEqual(['posts']);
    expect(posts.media).toEqual([]);
    expect(posts.people).toEqual([]);
    await expect(exportContent(store, ['nothing'])).rejects.toThrow('choose what to export: pages, type:posts, type:projects, sections, forms, design');
    expect(contentFileName({ name: 'Atelier Pop, Brașov!' }, new Date('2026-11-22T10:00:00Z'))).toBe('atelier-pop-brasov-2026-11-22.thecms.json');
    expect(contentFileName({ name: '***' }, new Date('2026-11-22T10:00:00Z'))).toBe('site-2026-11-22.thecms.json');
  });

  test('is read back only when it is one, and is shown counted first', async () => {
    const file = await exportContent(store);
    const words = JSON.stringify(file);
    expect(isContentFile(words)).toBe(true);
    expect(isContentFile('<?xml version="1.0"?><rss></rss>')).toBe(false);
    expect(() => readContentFile('{ "format": "thecms.content/1", ')).toThrow('it is not JSON that can be read');
    expect(() => readContentFile('{"format":"thecms.backup/1"}')).toThrow('this file is not a thecms content export (thecms.content/1)');
    // What does not have the shape is left out, not trusted.
    const odd = readContentFile(JSON.stringify({ format: CONTENT_FORMAT, pages: [{ slug: 'x' }, 'no', { slug: 'y', draft: { title: 'Y' }, published: 'no' }], types: [{ type: { nope: 1 } }, 'x'], people: ['x'], comments: [3], media: [{ name: 'a' }] }));
    expect(odd.pages).toEqual([{ slug: 'y', draft: { title: 'Y' }, published: null }]);
    expect(odd).toMatchObject({ program: '', madeAt: '', parts: [], from: { name: '', url: '', language: '', languages: [] }, types: [], people: [], comments: [], media: [] });
    const preview = contentPreview(readContentFile(words));
    expect(preview).toMatchObject({ kind: 'thecms', site: { name: 'Atelier Pop', url: 'https://atelier.example' }, pages: 4, posts: 1, types: [{ id: 'projects', name: 'Projects', count: 1 }], images: 2, redirects: 1, menu: true, sections: 1, forms: 2 });
    expect(preview.notes.join(' ')).toContain('One page was behind a password there');
    const two = contentPreview({ ...readContentFile(words), pages: [{ slug: 'a', draft: {}, published: null, locked: true }, { slug: 'b', draft: {}, published: null, locked: true }], settings: undefined, redirects: undefined, sections: undefined, forms: undefined });
    expect(two).toMatchObject({ pages: 2, menu: false, redirects: 0, sections: 0, forms: 0 });
    expect(two.notes.join(' ')).toContain('2 pages were behind a password there');
  });

  test('brought into a new site, it is the same site visitors saw', async () => {
    const file = readContentFile(JSON.stringify(await exportContent(store)));
    const other = await Store.open(':memory:');
    try {
      const steps: number[] = [];
      const report = await runContentImport(other, file, { fresh: true, onImage: (done) => steps.push(done) });
      expect(steps).toEqual([1, 2]);
      expect(report).toMatchObject({ pages: 4, posts: 1, entries: 1, images: 2, redirects: 1, menu: true });
      // Soon was never published; Members comes back as a draft until it has a password again.
      expect(report.drafts).toBe(2);
      expect(report.notes.join(' ')).toContain('One comment came with the entries');
      expect(report.notes.join(' ')).toContain('One person who wrote there was added under People');
      const lockedBefore = new Set(await store.lockedPages());
      const before = await publishedSite(store);
      const after = await publishedSite(other);
      const shown = (files: Map<string, string | Uint8Array>) => [...files.keys()].filter((path) => !path.startsWith('members/')).sort();
      expect(shown(after)).toEqual(shown(before));
      expect(lockedBefore.has('members')).toBe(true);
      expect(after.has('members/index.html')).toBe(false);
      const same = (html: unknown) => String(html).replace(/comment-[0-9a-f-]+/g, 'comment');
      expect(same(after.get('work/bridge/index.html'))).toBe(same(before.get('work/bridge/index.html')));
      expect(after.get('ro/despre/index.html')).toEqual(before.get('ro/despre/index.html'));
      expect(String(after.get('work/bridge/index.html'))).toContain('Beautiful');
      // What was being written comes as it was, apart from what visitors see.
      expect((await other.draft('about'))?.title).toBe('About us');
      expect((await other.theme())?.name).toBe('Plain, being changed');
      expect((await other.scheduled()).map((s) => s.slug)).toEqual(['soon']);
      expect((await other.users()).map((u) => [u.email, u.role, u.active, u.bio])).toEqual([['ana@example.com', 'author', false, 'Makes chairs.']]);
      expect((await other.comments()).map((c) => [c.name, c.email, c.approved])).toEqual([['Ion', '', true]]);
      expect((await other.media()).find((m) => m.label === 'workshop.png')?.variants).toEqual([480]);
      expect(await other.messages()).toEqual([]);

      // Brought again, nothing is replaced, and each thing left alone is named.
      const again = await runContentImport(other, file, { fresh: false });
      expect(again).toMatchObject({ pages: 0, posts: 0, entries: 0, menu: false });
      const notes = again.notes.join(' ');
      expect(notes).toContain('The site already had its settings');
      expect(notes).toContain('the page "Home"');
      expect(notes).toContain('the section "footer-note"');
      expect(notes).toContain('the form "quote"');
      expect(notes).toContain('"A bridge" (Projects)');
      expect((await other.users())).toHaveLength(1);
    } finally {
      await other.close();
    }
  });

  test('into a site that has its own: added beside, translations into a language it lacks stay behind', async () => {
    const file = readContentFile(JSON.stringify(await exportContent(store)));
    const other = await Store.open(':memory:');
    try {
      // A page lives where the projects would go, and the comment and the people find a way.
      await other.setSite({ name: 'Mine', types: [postsType()] });
      await other.savePage({ slug: 'work', title: 'Work', blocks: [] });
      await other.addUser({ email: 'ana@example.com', name: 'Ana', role: 'editor' });
      const report = await runContentImport(other, { ...file, media: [...file.media, { name: 'x.png', label: 'broken.txt', data: btoa('not a picture'), variants: [] }] }, { fresh: false });
      const notes = report.notes.join(' ');
      expect(notes).toContain('The content type "Projects" was not added, and its entries were not brought');
      expect(notes).toContain('This site does not have ro, so the translations into it stayed behind');
      expect(notes).toContain('the file "broken.txt"');
      expect(notes).not.toContain('added under People');
      expect((await other.site()).name).toBe('Mine');
      expect((await other.draft('about'))?.translations).toEqual({});
      expect(report.posts).toBe(1);
      expect(await other.comments()).toEqual([]);
    } finally {
      await other.close();
    }
  });

  test('a file of only some parts, and one that cannot be written, say so', async () => {
    const file = readContentFile(JSON.stringify(await exportContent(store, ['type:projects'])));
    const other = await Store.open(':memory:');
    try {
      const report = await runContentImport(other, file, { fresh: true });
      expect(report).toMatchObject({ pages: 0, entries: 1, menu: false });
      expect((await other.site()).types.map((t) => t.id)).toContain('projects');
      // The person's picture came with the entry.
      expect((await other.users())[0]?.picture).toStartWith('/media/');
      const broken: ContentFile = {
        ...file,
        settings: { ...(await store.site()), types: [{ id: 'x', name: 'X', singular: 'X', path: 'taken' }] } as never,
        theme: { draft: { nope: true } as never, published: null },
        layouts: [{ id: 'wide', name: 'Wide' } as never],
        pages: [{ slug: '', draft: { blocks: [] }, published: null }],
        sections: [{ slug: 'bad', draft: { title: '' }, published: null }],
        forms: [{ name: 'contact' } as never],
        types: [{ type: { ...file.types[0]!.type }, template: { draft: null, published: null }, entries: [{ slug: 'x', draft: { title: '' }, published: null }] }],
        comments: [{ type: 'projects', entry: 'nowhere', name: 'N', body: 'B', at: 'not a date' }],
        people: [{ key: 'k', email: 'not an address', name: 'N', bio: '', picture: '' }],
      };
      await other.savePage({ slug: 'taken', title: 'Taken', blocks: [] });
      const bad = await runContentImport(other, broken, { fresh: true });
      const notes = bad.notes.join(' ');
      expect(notes).toContain('The old site\'s settings were not taken: a page already lives at "/taken/"');
      expect(notes).toContain("The old site's theme was not taken");
      expect(notes).toContain('the page "" (a page has a title)');
      expect(notes).toContain('the section "bad" (a section has a title)');
      expect(notes).toContain('(Projects: an entry has a title)');
    } finally {
      await other.close();
    }
  });

  test('a comment kept from elsewhere keeps its time and language, or gets one', async () => {
    await store.keepShownComment({ type: 'projects', entry: 'bridge', name: 'Elena', body: 'Frumos', at: '2026-01-02T03:04:05.000Z', language: 'ro' });
    await store.keepShownComment({ type: 'projects', entry: 'bridge', name: 'Dan', body: 'Nice', at: 'never' });
    const kept = (await store.comments()).filter((c) => c.email === '');
    expect(kept.map((c) => [c.name, c.approved, c.language ?? ''])).toEqual(expect.arrayContaining([['Elena', true, 'ro'], ['Dan', true, '']]));
    expect(kept.find((c) => c.name === 'Elena')?.at).toBe('2026-01-02T03:04:05.000Z');
  });
});

describe('the site\'s data as JSON (ADR 0057 d3)', () => {
  let store: Store;
  beforeEach(async () => {
    store = await Store.open(':memory:');
    await fullSite(store);
  });
  afterEach(async () => await store.close());

  const json = (files: Map<string, string | Uint8Array>, path: string) => JSON.parse(String(files.get(path)));

  test('each page, entry and list beside its HTML, and site.json naming them, never a page behind a password', async () => {
    const files = await publishedSite(store);
    expect(json(files, 'about/index.json')).toMatchObject({ format: 'thecms.data/1', kind: 'page', path: '/about/', language: 'en', title: 'About', blocks: [{ type: 'text' }] });
    expect(json(files, 'about/index.json').html).toContain('Who we are');
    expect(json(files, 'about/index.json').html).not.toContain('<header');
    expect(json(files, 'ro/despre/index.json')).toMatchObject({ language: 'ro', title: 'Despre' });
    expect(json(files, 'work/bridge/index.json')).toMatchObject({ kind: 'entry', type: 'projects', title: 'A bridge', fields: { client: 'The town' }, author: { name: 'Ana Pop', slug: 'ana-pop' } });
    expect(json(files, 'work/bridge/index.json')).not.toHaveProperty('comments');
    const list = json(files, 'work/index.json');
    expect(list).toMatchObject({ kind: 'list', path: '/work/', type: { id: 'projects', name: 'Projects' }, entries: [{ path: '/work/bridge/', title: 'A bridge', data: '/work/bridge/index.json' }] });
    expect(list.entries[0]).not.toHaveProperty('html');
    const site = json(files, 'site.json');
    expect(site).toMatchObject({ kind: 'site', name: 'Atelier Pop', url: 'https://atelier.example', language: 'en', languages: ['ro'] });
    expect(site.pages.map((p: { path: string }) => p.path)).toEqual(['/', '/about/', '/ro/despre/']);
    expect(site.types.map((t: { path: string }) => t.path)).toEqual(['/blog/', '/work/']);
    expect(files.has('members/index.json')).toBe(false);
    expect(String(files.get('site.json'))).not.toContain('members');

    // Turned off in the settings, none of it is written.
    await store.setSite({ ...(await store.site()), data: false });
    expect((await store.site()).data).toBe(false);
    const off = await publishedSite(store);
    expect([...off.keys()].filter((path) => path.endsWith('.json'))).toEqual([]);
  });

  test('the runtime serves it to an app on any address', async () => {
    const runtime = startRuntime(store, { listen: false });
    try {
      const response = await runtime.fetch(new Request('http://127.0.0.1:4323/work/bridge/index.json'));
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
      expect(response.headers.get('access-control-allow-origin')).toBe('*');
      expect(((await response.json()) as { title: string }).title).toBe('A bridge');
      const page = await runtime.fetch(new Request('http://127.0.0.1:4323/about/'));
      expect(page.headers.get('access-control-allow-origin')).toBeNull();
      expect((await runtime.fetch(new Request('http://127.0.0.1:4323/members/index.json'))).status).toBe(404);
    } finally {
      runtime.stop();
    }
  });
});

describe('the site as files in a ZIP (ADR 0057 d4)', () => {
  test('every file, compressed where that helps, read back the same', () => {
    const files = new Map<string, string | Uint8Array>([
      ['index.html', '<h1>Hello</h1>'.repeat(50)],
      ['media/a.png', png(4, 4)],
      ['ș/î.txt', 'ăâ'],
    ]);
    const back = unzip(zipFiles(files, new Date(2026, 10, 22, 10, 30, 12)));
    expect([...back.keys()]).toEqual(['index.html', 'media/a.png', 'ș/î.txt']);
    expect(back.get('index.html')).toBe('<h1>Hello</h1>'.repeat(50));
    expect(back.get('ș/î.txt')).toBe('ăâ');
    expect(unzip(zipFiles(new Map())).size).toBe(0);
  });

  test('the export as files leaves a page behind a password out, and stops at a broken link', async () => {
    const store = await Store.open(':memory:');
    try {
      await fullSite(store);
      const files = await exportedFiles(store);
      expect(String(files.get('members/index.html'))).not.toContain('Only for members');
      await store.savePage({ slug: 'about', title: 'About', blocks: [{ id: 'b_l', type: 'text', content: { body: [{ type: 'paragraph', children: [{ text: 'gone', href: '/nowhere/' }] }] } }] });
      await store.publish('about');
      await expect(exportedFiles(store)).rejects.toThrow('Nothing was exported. A link leads to an address the site does not have');
    } finally {
      await store.close();
    }
  });
});

describe('from the admin (ADR 0057)', () => {
  const PUBLIC = 'https://cms.example.com';
  let store: Store;
  let editor: EditorServer;
  let dir: string;
  const cookies: Record<string, string> = {};

  const call = (who: string, method: string, path: string, body?: string) =>
    editor.fetch(new Request(`${PUBLIC}${path}`, { method, headers: { host: 'cms.example.com', origin: PUBLIC, 'x-thecms-request': '1', cookie: cookies[who] ?? '' }, body }));

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'thecms-transfer-'));
    store = await Store.open(join(dir, 'site.db'));
    await fullSite(store);
    editor = await startEditor(store, { listen: false, public: PUBLIC });
    for (const [who, role] of [
      ['owner', 'owner'],
      ['editor', 'editor'],
    ] as const) {
      const user = await store.addUser({ email: `${who}@example.com`, role, password: 'a long password here' });
      cookies[who] = `thecms_session=${await store.startSession(user.id)}`;
    }
  });
  afterEach(async () => {
    editor.stop();
    await store.close();
    await rm(dir, { recursive: true, force: true });
  });

  test('the owner downloads the content, or the site as a ZIP; an editor does not', async () => {
    const parts = (await (await call('owner', 'GET', '/api/export/parts')).json()) as { parts: { id: string; name: string }[] };
    expect(parts.parts.map((p) => p.id)).toEqual(['pages', 'type:posts', 'type:projects', 'sections', 'forms', 'design']);
    const content = await call('owner', 'GET', '/api/export/content?parts=pages,forms');
    expect(content.status).toBe(200);
    expect(content.headers.get('content-disposition')).toMatch(/^attachment; filename="atelier-pop-\d{4}-\d{2}-\d{2}\.thecms\.json"$/);
    expect(((await content.json()) as ContentFile).parts).toEqual(['pages', 'forms']);
    expect((await call('owner', 'GET', '/api/export/content?parts=none')).status).toBe(400);
    const zip = await call('owner', 'GET', '/api/export/files');
    expect(zip.headers.get('content-type')).toBe('application/zip');
    const inside = unzip(new Uint8Array(await zip.arrayBuffer()));
    expect(inside.get('about/index.html')).toContain('Who we are');
    expect(inside.has('site.json')).toBe(true);
    expect((await call('owner', 'GET', '/api/export/elsewhere')).status).toBe(404);
    for (const path of ['/api/export/parts', '/api/export/content', '/api/export/files']) expect((await call('editor', 'GET', path)).status).toBe(403);

    // A link that leads nowhere is said, and no ZIP is made.
    await store.savePage({ slug: 'about', title: 'About', blocks: [{ id: 'b_l', type: 'text', content: { body: [{ type: 'paragraph', children: [{ text: 'gone', href: '/nowhere/' }] }] } }] });
    await store.publish('about');
    const refused = await call('owner', 'GET', '/api/export/files');
    expect(refused.status).toBe(400);
    expect(((await refused.json()) as { error: string }).error).toContain('/nowhere/');
  });

  test('a content file is read, shown, and brought in by the import screen', async () => {
    const words = JSON.stringify(await exportContent(store));
    const other = await Store.open(join(dir, 'other.db'));
    const there = await startEditor(other, { listen: false });
    const ask = (path: string, method = 'GET', body?: string) => there.fetch(new Request(`http://127.0.0.1:4321${path}`, { method, headers: { host: '127.0.0.1:4321', 'x-thecms-token': there.token }, body }));
    try {
      const preview = (await (await ask('/api/import/plan', 'POST', words)).json()) as ImportPreview;
      expect(preview).toMatchObject({ kind: 'thecms', pages: 4, sections: 1, forms: 2 });
      expect((await ask('/api/import/elsewhere', 'POST', words)).status).toBe(404);
      expect((await ask('/api/import/run?settings=1', 'POST', words)).status).toBe(202);
      expect((await ask('/api/import/run', 'POST', words)).status).toBe(409);
      let progress: ImportProgress = { status: 'running', done: 0, total: 0 };
      for (let i = 0; i < 200 && progress.status === 'running'; i++) {
        await Bun.sleep(5);
        progress = (await (await ask('/api/import')).json()) as ImportProgress;
      }
      expect(progress).toMatchObject({ status: 'done', report: { pages: 4, entries: 1, menu: true } });
      expect((await other.site()).name).toBe('Atelier Pop');
      const failed = await ask('/api/import/run', 'POST', '{"format":"thecms.content/1", "media": [{"data": 5}], "types": [{"type": {"id": "x"}}], "pages": "x"}');
      expect(failed.status).toBe(202);
      for (let i = 0; i < 200 && progress.status !== 'idle'; i++) {
        await Bun.sleep(5);
        progress = (await (await ask('/api/import')).json()) as ImportProgress;
        if (progress.status === 'done' || progress.status === 'failed') break;
      }
      expect(['done', 'failed']).toContain(progress.status);
    } finally {
      there.stop();
      await other.close();
    }
  });
});
