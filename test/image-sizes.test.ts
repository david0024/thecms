/**
 * Pictures at the size that fits (ADR 0005 d8): the site reads how large a
 * picture is from its bytes, keeps the smaller copies the browser makes, and
 * the export offers them with srcset and sizes that follow the layout and the
 * block's width.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canVary, imageSize, measureFor, pictureAttrs, variantName, variantOf, wantedWidths } from '../src/core/index.ts';
import { publishedSite } from '../src/site/export.ts';
import { startEditor } from '../src/site/server.ts';
import { Store } from '../src/site/store.ts';
import plain from '../themes/plain.json';

const dir = await mkdtemp(join(tmpdir(), 'thecms-sizes-'));
afterAll(() => rm(dir, { recursive: true, force: true }));

const be32 = (n: number): number[] => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const le24 = (n: number): number[] => [n & 255, (n >> 8) & 255, (n >> 16) & 255];
const text = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));

/** The start of a PNG: enough for its size, with a tag so two are not the same file. */
const png = (width: number, height: number, tag = 0): Uint8Array => Uint8Array.from([0x89, ...text('PNG'), 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, ...text('IHDR'), ...be32(width), ...be32(height), 8, 6, 0, 0, 0, tag]);
const webpX = (width: number, height: number): Uint8Array => Uint8Array.from([...text('RIFF'), 22, 0, 0, 0, ...text('WEBPVP8X'), 10, 0, 0, 0, 0, 0, 0, 0, ...le24(width - 1), ...le24(height - 1)]);
const webpLossy = (width: number, height: number): Uint8Array =>
  Uint8Array.from([...text('RIFF'), 22, 0, 0, 0, ...text('WEBPVP8 '), 10, 0, 0, 0, 0, 0, 0, 0x9d, 0x01, 0x2a, width & 255, width >> 8, height & 255, height >> 8]);
function webpLossless(width: number, height: number): Uint8Array {
  const w = width - 1;
  const h = height - 1;
  return Uint8Array.from([...text('RIFF'), 22, 0, 0, 0, ...text('WEBPVP8L'), 5, 0, 0, 0, 0x2f, w & 255, ((w >> 8) & 0x3f) | ((h & 3) << 6), (h >> 2) & 255, (h >> 10) & 0x0f, 0, 0, 0, 0, 0]);
}
const jpeg = (width: number, height: number): Uint8Array =>
  Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 6, 1, 2, 3, 4, 0xff, 0xff, 0xc0, 0, 17, 8, height >> 8, height & 255, width >> 8, width & 255, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const avif = (width: number, height: number): Uint8Array => Uint8Array.from([0, 0, 0, 24, ...text('ftypavif'), 0, 0, 0, 0, 0, 0, 0, 20, ...text('ispe'), 0, 0, 0, 0, ...be32(width), ...be32(height)]);

describe('how large a picture is', () => {
  test('is read from its bytes, in every format the site takes', () => {
    expect(imageSize(png(1000, 500))).toEqual({ width: 1000, height: 500 });
    expect(imageSize(Uint8Array.from([...text('GIF89a'), 0x20, 0x03, 0x58, 0x02, 0, 0]))).toEqual({ width: 800, height: 600 });
    expect(imageSize(webpX(1600, 900))).toEqual({ width: 1600, height: 900 });
    expect(imageSize(webpLossy(640, 480))).toEqual({ width: 640, height: 480 });
    expect(imageSize(webpLossless(300, 1201))).toEqual({ width: 300, height: 1201 });
    expect(imageSize(jpeg(1200, 800))).toEqual({ width: 1200, height: 800 });
    expect(imageSize(avif(2000, 1000))).toEqual({ width: 2000, height: 1000 });
  });

  test('is unknown when the bytes do not say', () => {
    expect(imageSize(Uint8Array.from(text('not an image at all')))).toBeNull();
    expect(imageSize(Uint8Array.from([...text('RIFF'), 0, 0, 0, 0, ...text('WEBPJUNK'), 0, 0, 0, 0]))).toBeNull();
    expect(imageSize(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 2, 0x00, 0, 0, 0, 0, 0, 0]))).toBeNull();
    expect(imageSize(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 2, 0xff, 0xd9, 0, 0, 0, 0]))).toBeNull();
    expect(imageSize(Uint8Array.from([0, 0, 0, 24, ...text('ftypavif'), 0, 0, 0, 0]))).toBeNull();
    expect(imageSize(png(0, 10))).toBeNull();
  });
});

describe('smaller copies', () => {
  test('are named after their picture and their width', () => {
    expect(variantName('0123456789abcdef0123456789abcdef.png', 480, 'webp')).toBe('0123456789abcdef0123456789abcdef-480.webp');
    expect(variantOf('0123456789abcdef0123456789abcdef-960.jpg')).toEqual({ hash: '0123456789abcdef0123456789abcdef', width: 960 });
    expect(variantOf('0123456789abcdef0123456789abcdef.png')).toBeNull();
    expect(canVary('x.png') && canVary('x.jpg') && canVary('x.webp')).toBe(true);
    expect(canVary('x.gif') || canVary('x.avif')).toBe(false);
    expect(wantedWidths(1000)).toEqual([480, 960]);
    expect(wantedWidths(400)).toEqual([]);
  });

  test('are offered for the width the content runs at', () => {
    const widths = plain.tokens.width;
    expect(measureFor(widths, 'normal')).toBe('64rem');
    expect(measureFor(widths, 'normal', 'hero')).toBe('76rem');
    expect(measureFor(widths, 'narrow', 'hero')).toBe('42rem');
    expect(measureFor(widths, 'wide')).toBe('76rem');
    expect(measureFor(widths, 'full')).toBe('100vw');
    expect(measureFor(widths, 'normal', 'image', { token: 'narrow' })).toBe('42rem');
    expect(measureFor(widths, 'normal', 'image', { value: '30rem' })).toBe('30rem');
    expect(measureFor(widths, 'normal', 'image', { value: '50%' })).toBe('64rem');
    expect(measureFor({ content: 'var(--x)' }, 'normal')).toBe('100vw');

    const name = '0123456789abcdef0123456789abcdef.png';
    const pictures = { sizes: { [name]: { width: 2000, height: 1000, variants: ['0123456789abcdef0123456789abcdef-960.webp', '0123456789abcdef0123456789abcdef-480.webp'] } }, widths };
    expect(pictureAttrs(pictures, `/media/${name}`, '64rem', 'full')).toEqual({
      width: 2000,
      height: 1000,
      srcset: `/media/0123456789abcdef0123456789abcdef-480.webp 480w, /media/0123456789abcdef0123456789abcdef-960.webp 960w, /media/${name} 2000w`,
      sizes: 'min(100vw, 64rem)',
    });
    expect(pictureAttrs(pictures, `/media/${name}`, '100vw', 'half').sizes).toBe('(max-width: 40rem) 100vw, calc(100vw / 2)');
    expect(pictureAttrs(pictures, `/media/${name}`, '64rem', 'card').sizes).toBe('(max-width: 30rem) 100vw, 20rem');
    expect(pictureAttrs(pictures, `/media/${name}`, '64rem', 'thumb').sizes).toBe('6rem');
    expect(pictureAttrs({ ...pictures, sizes: { [name]: { width: 2000, height: 1000, variants: [] } } }, `/media/${name}`, '64rem', 'full')).toEqual({ width: 2000, height: 1000 });
    expect(pictureAttrs(pictures, 'https://example.com/a.png', '64rem', 'full')).toEqual({});
    expect(pictureAttrs(undefined, `/media/${name}`, '64rem', 'full')).toEqual({});
  });
});

describe('the store, the editor and the export', () => {
  test('keep the copies the browser sends, and the export offers them', async () => {
    const store = await Store.open(join(dir, 'site.db'));
    const editor = await startEditor(store, { listen: false });
    const send = async (path: string, body: Uint8Array) => {
      const response = await editor.fetch(
        new Request(`http://127.0.0.1:4321${path}`, { method: 'POST', headers: { host: '127.0.0.1:4321', 'x-thecms-token': editor.token }, body: body as Uint8Array<ArrayBuffer> }),
      );
      return { status: response.status, data: (await response.json()) as Record<string, any> };
    };
    try {
      const wide = (await send('/api/media?label=wide.png', png(1000, 500))).data.item;
      expect(wide).toMatchObject({ width: 1000, height: 500, variants: [] });
      const small = await store.addMedia(png(300, 200, 1));
      const moving = await store.addMedia(Uint8Array.from([...text('GIF89a'), 0xe8, 0x03, 0xe8, 0x03, 0, 0]));

      // What the browser sends is checked against the picture it belongs to.
      for (const [name, body, error] of [
        ['nothing.png', webpX(480, 240), 'no such image'],
        [moving.name, webpX(480, 480), 'this image keeps one size'],
        [wide.name, png(480, 240), 'a smaller copy is a WebP or a JPEG'],
        [wide.name, webpX(500, 250), 'a smaller copy of this image is 480, 960 pixels wide'],
        [wide.name, webpX(480, 300), 'a smaller copy keeps the proportions of the image'],
      ] as const) {
        const answer = await send(`/api/media/variant?name=${name}`, body);
        expect(answer.status).toBe(400);
        expect(answer.data.error).toBe(error);
      }
      expect((await send(`/api/media/variant?name=${wide.name}`, webpX(480, 240))).data.item.variants).toEqual([480]);
      // Sent again, a copy replaces the one at that width.
      await send(`/api/media/variant?name=${wide.name}`, jpeg(480, 240));
      expect((await store.addVariant(wide.name, webpX(960, 480))).variants).toEqual([480, 960]);
      const hash = wide.name.split('.')[0];
      expect((await store.mediaFile(`${hash}-480.jpg`))?.type).toBe('image/jpeg');
      expect(await store.mediaFile(`${hash}-480.webp`)).toBeNull();
      const served = await editor.fetch(new Request(`http://127.0.0.1:4321/media/${hash}-960.webp`, { headers: { host: '127.0.0.1:4321' } }));
      expect(served.headers.get('content-type')).toBe('image/webp');

      // A picture stored before sizes were kept has its size read once.
      await store.rawForTests('DELETE FROM media_sizes WHERE name = ?', [small.name]);
      expect((await store.media()).find((m) => m.name === small.name)).toMatchObject({ width: 300, height: 200, variants: [] });

      await store.setTheme(plain);
      await store.publishTheme();
      await store.setSite({ name: 'Atelier', layouts: [{ id: 'standard', name: 'Standard', header: true, footer: true, width: 'normal', sidebar: 'none', side: '', top: '', bottom: '' }, { id: 'thin', name: 'Thin', header: true, footer: true, width: 'narrow', sidebar: 'none', side: '', top: '', bottom: '' }] });
      const image = (id: string, src: string, style?: Record<string, unknown>) => ({ id, type: 'image', content: { image: { src, alt: 'Wide' }, caption: '' }, ...(style ? { style } : {}) });
      await store.savePage({ slug: '', title: 'Home', blocks: [image('b_1', wide.path), image('b_2', wide.path, { maxWidth: { token: 'narrow' } }), image('b_3', small.path)] });
      await store.publish('');
      await store.savePage({ slug: 'thin', title: 'Thin', layout: 'thin', blocks: [image('b_4', wide.path)] });
      await store.publish('thin');

      const files = await publishedSite(store);
      const home = String(files.get('index.html'));
      const srcset = `/media/${hash}-480.jpg 480w, /media/${hash}-960.webp 960w, ${wide.path} 1000w`;
      expect(home).toContain(`<img src="${wide.path}" srcset="${srcset}" sizes="min(100vw, 64rem)" width="1000" height="500" alt="Wide"`);
      expect(home).toContain(`sizes="min(100vw, 42rem)"`);
      expect(home).toContain(`<img src="${small.path}" width="300" height="200" alt="Wide"`);
      expect(home).not.toContain('onload');
      expect(String(files.get('thin/index.html'))).toContain(`sizes="min(100vw, 42rem)"`);
      expect(files.has(`media/${hash}-480.jpg`) && files.has(`media/${hash}-960.webp`)).toBe(true);

      // Deleted with its picture.
      await store.savePage({ slug: '', title: 'Home', blocks: [] });
      await store.publish('');
      await store.savePage({ slug: 'thin', title: 'Thin', layout: 'thin', blocks: [] });
      await store.publish('thin');
      await store.deleteMedia(wide.name);
      expect(await store.mediaFile(`${hash}-960.webp`)).toBeNull();
      expect(Object.keys(await store.mediaSizes())).not.toContain(wide.name);
    } finally {
      editor.stop();
      await store.close();
    }
  });
});
