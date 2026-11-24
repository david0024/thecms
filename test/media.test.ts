import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type Block,
  createBlock,
  depthOf,
  fits,
  findById,
  imageExt,
  imageSources,
  insertAt,
  MEDIA_MAX_BYTES,
  mediaNameOf,
  moveTo,
  normalizeBlocks,
} from '../src/core/index.ts';
import { DEMO_PAGES, DEMO_SITE } from '../src/site/demo.ts';
import { exportSite } from '../src/site/export.ts';
import { type EditorServer, startEditor } from '../src/site/server.ts';
import { Store } from '../src/site/store.ts';
import plain from '../themes/plain.json';

/** The smallest PNG there is: one transparent pixel. */
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='), (c) => c.charCodeAt(0));
const bytes = (text: string): Uint8Array => new TextEncoder().encode(text.padEnd(16, ' '));

describe('what counts as an image', () => {
  test('a file is what its bytes say', async () => {
    expect(imageExt(PNG)).toBe('png');
    expect(imageExt(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe('jpg');
    expect(imageExt(bytes('GIF89a'))).toBe('gif');
    expect(imageExt(bytes('RIFF\0\0\0\0WEBPVP8 '))).toBe('webp');
    expect(imageExt(bytes('\0\0\0\x1cftypavif'))).toBe('avif');
  });

  test('a script, an SVG and a page are not images, whatever they are called', async () => {
    for (const text of ['<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>', '<!doctype html><script>alert(1)</script>', 'GIF89', '']) {
      expect(imageExt(bytes(text))).toBeNull();
    }
  });

  test('only an address made by the store names a stored image', async () => {
    expect(mediaNameOf(`/media/${'a'.repeat(32)}.png`)).toBe(`${'a'.repeat(32)}.png`);
    for (const src of ['/media/../site.db', `/media/${'a'.repeat(32)}.svg`, `/media/${'A'.repeat(32)}.png`, `https://example.com/media/${'a'.repeat(32)}.png`, '/media/x.png']) {
      expect(mediaNameOf(src)).toBeNull();
    }
  });

  test('the images of a page are found wherever a field holds one, groups included', async () => {
    const { blocks } = normalizeBlocks([
      { type: 'hero', content: { title: 'x', image: { src: '/media/one.png', alt: '' } } },
      { type: 'group', children: [{ type: 'image', content: { image: { src: 'https://example.com/two.jpg', alt: '' } } }, { type: 'image' }] },
    ]);
    expect(imageSources(blocks)).toEqual(['/media/one.png', 'https://example.com/two.jpg']);
  });
});

describe('moving blocks without losing them', () => {
  const group = (id: string, children: Block[] = []): Block => ({ id, type: 'group', content: {}, children });
  const leaf = (id: string): Block => ({ ...createBlock('text'), id });
  // g1 > g2 > g3 > g4: as deep as a page goes.
  const tower = [group('g1', [group('g2', [group('g3', [group('g4')])])]), leaf('t'), group('pair', [group('inner', [leaf('u')])])];

  test('depth is counted from the top', async () => {
    expect(depthOf(tower, 't')).toBe(1);
    expect(depthOf(tower, 'g4')).toBe(4);
    expect(depthOf(tower, 'nope')).toBeUndefined();
  });

  test('a block fits where cleaning would keep all of it', async () => {
    expect(fits(tower, 'g3', leaf('x'))).toBe(true);
    expect(fits(tower, 'g4', leaf('x'))).toBe(false);
    expect(fits(tower, 'g2', findById(tower, 'pair') as Block)).toBe(false);
    expect(fits(tower, null, findById(tower, 'g1') as Block)).toBe(true);
  });

  test('a move too deep changes nothing, and what a refused move would have lost is real', async () => {
    expect(moveTo(tower, 't', 'g4', 0)).toBe(tower);
    expect(moveTo(tower, 'pair', 'g2', 0)).toBe(tower);
    // Forced past the check, the cleaning on save drops the block: this is what the check prevents.
    const forced = normalizeBlocks(insertAt(tower, 'g4', 0, leaf('lost'))).blocks;
    expect(findById(forced, 'lost')).toBeNull();
    const moved = moveTo(tower, 't', 'g3', 0);
    expect(findById(normalizeBlocks(moved).blocks, 't')).not.toBeNull();
  });
});

describe('images stored with the site', () => {
  let dir: string;
  let store: Store;
  let editor: EditorServer;
  const HOST = '127.0.0.1:4321';
  const call = (path: string, init: { method?: string; body?: Uint8Array; token?: string } = {}): Promise<Response> =>
    editor.fetch(new Request(`http://${HOST}${path}`, { method: init.method ?? 'GET', headers: { host: HOST, 'x-uhlaka-token': init.token ?? editor.token }, body: init.body as BodyInit | undefined }));

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'uhlaka-'));
    store = await Store.open(join(dir, 'site.db'));
    await store.setSite(DEMO_SITE);
    await store.setTheme(plain);
    await store.publishTheme();
    for (const page of DEMO_PAGES) await store.publish((await store.savePage(page)).slug);
    editor = await startEditor(store, { listen: false });
  });
  afterEach(async () => {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  });

  const show = async (src: string): Promise<void> => {
    const home = (await store.draft('')) as NonNullable<Awaited<ReturnType<Store['draft']>>>;
    await store.savePage({ ...home, blocks: [...home.blocks, { type: 'image', content: { image: { src, alt: 'A pixel' } } }] });
  };

  test('a file is renamed and a picture described in the library; deleting it forgets both (ADR 0072)', async () => {
    const item = await store.addMedia(PNG, 'IMG_2041.png');
    expect(item.alt).toBe('');
    expect(item.uploadedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const named = await store.setMediaTexts(item.name, { label: '  Workshop door  ', alt: 'The oak door of the workshop' });
    expect(named.label).toBe('Workshop door');
    expect(named.alt).toBe('The oak door of the workshop');
    expect(named.path).toBe(item.path);
    expect((await store.setMediaTexts(item.name, { alt: '' })).alt).toBe('');
    await expect(store.setMediaTexts(item.name, { label: ' ' })).rejects.toThrow('has a name');
    await expect(store.setMediaTexts('0123456789abcdef0123456789abcdef.png', { label: 'x' })).rejects.toThrow('no such file');
    await store.setMediaTexts(item.name, { alt: 'A door' });
    await store.deleteMedia(item.name);
    await store.addMedia(PNG, 'again.png');
    expect((await store.media())[0]?.alt).toBe('');
  });

  test('the admin renames and describes a file, and says where it is used', async () => {
    const item = await store.addMedia(PNG, 'pixel.png');
    const put = await editor.fetch(
      new Request(`http://${HOST}/api/media?name=${item.name}`, { method: 'PUT', headers: { host: HOST, 'x-uhlaka-token': editor.token, 'content-type': 'application/json' }, body: JSON.stringify({ label: 'Pixel', alt: 'One pixel' }) }),
    );
    expect(put.status).toBe(200);
    expect(((await put.json()) as { item: { label: string; alt: string } }).item).toMatchObject({ label: 'Pixel', alt: 'One pixel' });
    expect(((await (await call(`/api/media/used?name=${item.name}`)).json()) as { usedBy: string[] }).usedBy).toEqual([]);
    await show(item.path);
    expect(((await (await call(`/api/media/used?name=${item.name}`)).json()) as { usedBy: string[] }).usedBy).toEqual(['Home']);
  });

  test('the same picture twice is stored once, under a name made from its bytes', async () => {
    const first = await store.addMedia(PNG, 'pixel.png');
    const again = await store.addMedia(PNG, 'copy.png');
    expect(first.path).toMatch(/^\/media\/[a-f0-9]{32}\.png$/);
    expect(again.name).toBe(first.name);
    expect(await store.media()).toHaveLength(1);
    expect((await store.mediaFile(first.name))?.bytes).toEqual(PNG);
  });

  test('what is not an image, or is too heavy, is refused', async () => {
    expect(async () => await store.addMedia(bytes('<svg onload="alert(1)"/>'), 'x.png')).toThrow('not a file this site takes');
    const heavy = new Uint8Array(MEDIA_MAX_BYTES + 1);
    heavy.set(PNG);
    await expect(store.addMedia(heavy)).rejects.toThrow('at most 10 MB');
    expect(await store.media()).toHaveLength(0);
  });

  test('upload needs the token; showing does not, and says what the file is', async () => {
    expect((await call('/api/media', { method: 'POST', body: PNG, token: 'x' })).status).toBe(401);
    const response = await call('/api/media?label=pixel.png', { method: 'POST', body: PNG });
    const { item } = (await response.json()) as { item: { path: string; label: string } };
    expect(item.label).toBe('pixel.png');
    const shown = await editor.fetch(new Request(`http://${HOST}${item.path}`, { headers: { host: HOST } }));
    expect(shown.headers.get('content-type')).toBe('image/png');
    expect(shown.headers.get('x-content-type-options')).toBe('nosniff');
    expect(new Uint8Array(await shown.arrayBuffer())).toEqual(PNG);
    expect((await call('/api/media', { method: 'POST', body: bytes('<script>alert(1)</script>') })).status).toBe(400);
    expect((await editor.fetch(new Request(`http://${HOST}/media/..%2Fsite.db`, { headers: { host: HOST } }))).status).toBe(404);
  });

  test('an image a page shows cannot be deleted; one nothing shows can', async () => {
    const item = await store.addMedia(PNG);
    await show(item.path);
    const refused = await call(`/api/media?name=${item.name}`, { method: 'DELETE' });
    expect(refused.status).toBe(400);
    expect(((await refused.json()) as { error: string }).error).toContain('used on: Home');
    // Still shown by what is published, even after the draft lets go of it.
    await store.publish('');
    await store.savePage({ ...(await store.draft('') as object), blocks: [] });
    expect(await store.mediaUsedBy(item.name)).toHaveLength(1);
    await store.publish('');
    expect((await call(`/api/media?name=${item.name}`, { method: 'DELETE' })).status).toBe(200);
    expect(await store.media()).toHaveLength(0);
  });

  test('the export carries the images published pages show, and only those', async () => {
    const used = await store.addMedia(PNG);
    const unused = await store.addMedia(Uint8Array.from([...PNG, 0]));
    await show(used.path);
    const out = join(dir, 'out');
    await exportSite(store, out);
    expect(await readdir(out)).not.toContain('media');
    await store.publish('');
    const files = await exportSite(store, out);
    expect(files).toContain(used.path.slice(1));
    expect(files).not.toContain(unused.path.slice(1));
    expect(new Uint8Array(await Bun.file(join(out, used.path)).arrayBuffer())).toEqual(PNG);
    expect(await Bun.file(join(out, 'index.html')).text()).toContain(`<img src="${used.path}" width="1" height="1" alt="A pixel"`);
  });

  test('a published page whose image is gone stops the export, and says which page', async () => {
    await show(`/media/${'0'.repeat(32)}.png`);
    await store.publish('');
    await expect(exportSite(store, join(dir, 'out'))).rejects.toThrow('shows an image this site does not have');
  });
});
