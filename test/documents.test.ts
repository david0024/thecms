/**
 * Documents, sound and video in the media library (ADR 0046): what is taken,
 * how heavy, how it is served, and that a page linking to one carries it.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileExt, linkTargets, MAX_BYTES, mediaExt, mediaKindOf, mediaNameOf, mediaSources, normalizeBlocks } from '../src/core/index.ts';
import { DEMO_PAGES, DEMO_SITE } from '../src/site/demo.ts';
import { exportSite, publishedSite } from '../src/site/export.ts';
import { startRuntime } from '../src/site/runtime.ts';
import { type EditorServer, startEditor } from '../src/site/server.ts';
import { Store } from '../src/site/store.ts';
import plain from '../themes/plain.json';

const enc = (text: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(text);
const join8 = (...parts: (Uint8Array | string)[]): Uint8Array<ArrayBuffer> => {
  const all = parts.map((p) => (typeof p === 'string' ? enc(p) : p));
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of all) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};
/** A ZIP whose first entry has this name (and, for OpenDocument, this content stored right after it). */
const zip = (first: string, stored = '', more = ''): Uint8Array<ArrayBuffer> => {
  const header = new Uint8Array(30);
  header.set([0x50, 0x4b, 0x03, 0x04]);
  header[26] = first.length;
  return join8(header, first, stored, more, ' '.repeat(20));
};

const PDF = enc('%PDF-1.7\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');
const DOCX = zip('[Content_Types].xml', '<Types/>', 'PK\x03\x04....word/document.xml');
const XLSX = zip('[Content_Types].xml', '<Types/>', 'PK\x03\x04....xl/workbook.xml');
const PPTX = zip('[Content_Types].xml', '<Types/>', 'PK\x03\x04....ppt/presentation.xml');
const ODT = zip('mimetype', 'application/vnd.oasis.opendocument.text');
const ODS = zip('mimetype', 'application/vnd.oasis.opendocument.spreadsheet');
const ZIP = zip('notes/readme.txt', 'hello');
const MP3 = join8('ID3\x04\0\0\0\0\0\0', new Uint8Array(20));
const MP3_BARE = Uint8Array.from([0xff, 0xfb, 0x90, 0x64, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const OGG = join8('OggS\0\x02', new Uint8Array(20));
const WAV = join8('RIFF\0\0\0\0WAVEfmt ', new Uint8Array(8));
const MP4 = join8('\0\0\0\x20ftypisom\0\0\x02\0', new Uint8Array(16));
const M4A = join8('\0\0\0\x20ftypM4A \0\0\x02\0', new Uint8Array(16));
const WEBM = join8(Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01]), '\x42\x82\x84webm', new Uint8Array(16));

describe('what the library takes', () => {
  test('a file is what its bytes say, whatever it is called', () => {
    const cases: [Uint8Array, string][] = [
      [PDF, 'pdf'], [DOCX, 'docx'], [XLSX, 'xlsx'], [PPTX, 'pptx'], [ODT, 'odt'], [ODS, 'ods'], [ZIP, 'zip'],
      [MP3, 'mp3'], [MP3_BARE, 'mp3'], [OGG, 'ogg'], [WAV, 'wav'], [MP4, 'mp4'], [M4A, 'm4a'], [WEBM, 'webm'],
    ];
    for (const [bytes, ext] of cases) expect(fileExt(bytes)).toBe(ext as never);
    expect(mediaKindOf('x.pdf')).toBe('document');
    expect(mediaKindOf('x.m4a')).toBe('audio');
    expect(mediaKindOf('x.webm')).toBe('video');
    expect(mediaKindOf('x.png')).toBe('image');
  });

  test('a page, a script, an SVG, plain text and a program are not taken', () => {
    for (const text of ['<!doctype html><script>alert(1)</script>', '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>', 'just some words here', '#!/bin/sh\nrm -rf /\n', 'MZ\x90\0\x03\0\0\0\x04\0\0\0']) {
      expect(mediaExt(enc(text))).toBeNull();
    }
    // A Matroska file that is not WebM, and an MP4 of a kind a browser may not play, are not taken either.
    expect(fileExt(join8(Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3]), '\x42\x82\x88matroska', new Uint8Array(16)))).toBeNull();
    expect(fileExt(join8('\0\0\0\x20ftypqt  \0\0\x02\0', new Uint8Array(16)))).toBeNull();
  });

  test('only the names the store makes are names', () => {
    expect(mediaNameOf(`/media/${'a'.repeat(32)}.pdf`)).toBe(`${'a'.repeat(32)}.pdf`);
    for (const src of [`/media/${'a'.repeat(32)}.html`, `/media/${'a'.repeat(32)}.exe`, `/media/${'a'.repeat(32)}.svg`]) expect(mediaNameOf(src)).toBeNull();
  });

  test('a page needs the files it links to, in a button or in its text', () => {
    const { blocks } = normalizeBlocks([
      { type: 'hero', content: { title: 'x', action: { label: 'The brochure', href: '/media/b.pdf' }, secondaryAction: { label: 'Elsewhere', href: 'https://example.com/' } } },
      { type: 'text', content: { body: [{ type: 'paragraph', children: [{ text: 'Read ' }, { text: 'the menu', href: '/media/m.pdf' }] }, { type: 'list', ordered: false, items: [[{ text: 'price list', href: '/media/p.xlsx' }]] }] } },
      { type: 'group', children: [{ type: 'image', content: { image: { src: '/media/i.png', alt: '' } } }] },
    ]);
    expect(linkTargets(blocks)).toEqual(['/media/b.pdf', 'https://example.com/', '/media/m.pdf', '/media/p.xlsx']);
    expect(mediaSources(blocks)).toEqual(['/media/i.png', '/media/b.pdf', '/media/m.pdf', '/media/p.xlsx']);
  });
});

describe('documents, sound and video stored with the site', () => {
  let dir: string;
  let store: Store;
  let editor: EditorServer;
  const HOST = '127.0.0.1:4321';
  const call = (path: string, init: { method?: string; body?: Uint8Array; headers?: Record<string, string> } = {}): Promise<Response> =>
    editor.fetch(new Request(`http://${HOST}${path}`, { method: init.method ?? 'GET', headers: { host: HOST, 'x-uhlaka-token': editor.token, ...init.headers }, body: init.body as BodyInit | undefined }));

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

  /** The home page links to this address from its text. */
  const link = async (href: string): Promise<void> => {
    const home = (await store.draft('')) as NonNullable<Awaited<ReturnType<Store['draft']>>>;
    await store.savePage({ ...home, blocks: [...home.blocks, { type: 'text', content: { body: [{ type: 'paragraph', children: [{ text: 'The menu', href }] }] } }] });
  };

  test('each kind is stored under a name made from its bytes, and listed with its kind', async () => {
    const pdf = await store.addMedia(PDF, 'Meniu de vară.pdf');
    const video = await store.addMedia(MP4, 'clip.mp4');
    expect(pdf.path).toMatch(/^\/media\/[a-f0-9]{32}\.pdf$/);
    expect(pdf.kind).toBe('document');
    expect(pdf.type).toBe('application/pdf');
    expect(video.kind).toBe('video');
    expect(video.width).toBe(0);
    expect((await store.media()).map((m) => m.kind).sort()).toEqual(['document', 'video']);
  });

  test('each kind has its own limit, and a long film is sent to a video service', async () => {
    const heavy = (head: Uint8Array, size: number): Uint8Array => {
      const out = new Uint8Array(size);
      out.set(head);
      return out;
    };
    await expect(store.addMedia(heavy(PDF, MAX_BYTES.document + 1))).rejects.toThrow('a document is at most 25 MB');
    await expect(store.addMedia(heavy(MP3, MAX_BYTES.audio + 1))).rejects.toThrow('a sound file is at most 50 MB');
    await expect(store.addMedia(heavy(MP4, MAX_BYTES.video + 1))).rejects.toThrow('goes on a video service');
    expect((await store.addMedia(heavy(PDF, MAX_BYTES.image + 1))).kind).toBe('document');
  });

  test('a document is served under the name it was uploaded with; only a PDF opens in the browser', async () => {
    const pdf = await store.addMedia(PDF, 'Meniu de vară.pdf');
    const docx = await store.addMedia(DOCX, 'Oferta "nouă"\r\n');
    const shownPdf = await call(pdf.path);
    expect(shownPdf.headers.get('content-type')).toBe('application/pdf');
    expect(shownPdf.headers.get('content-disposition')).toBe(`inline; filename*=UTF-8''${encodeURIComponent('Meniu de vară.pdf')}`);
    expect(shownPdf.headers.get('x-content-type-options')).toBe('nosniff');
    expect(new Uint8Array(await shownPdf.arrayBuffer())).toEqual(PDF);
    const shownDocx = await call(docx.path);
    expect(shownDocx.headers.get('content-disposition')).toBe(`attachment; filename*=UTF-8''${encodeURIComponent('Oferta nouă.docx')}`);
    expect(shownDocx.headers.get('content-security-policy')).toBeTruthy();
  });

  test('a player asks for a part of a video, and gets that part', async () => {
    const video = await store.addMedia(MP4, 'clip.mp4');
    const part = await call(video.path, { headers: { range: 'bytes=4-11' } });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe(`bytes 4-11/${MP4.length}`);
    expect(new Uint8Array(await part.arrayBuffer())).toEqual(MP4.slice(4, 12));
    const tail = await call(video.path, { headers: { range: 'bytes=-4' } });
    expect(new Uint8Array(await tail.arrayBuffer())).toEqual(MP4.slice(MP4.length - 4));
    expect((await call(video.path, { headers: { range: `bytes=${MP4.length}-` } })).status).toBe(416);
    expect((await call(video.path)).headers.get('accept-ranges')).toBe('bytes');
  });

  test('a file a page links to is exported with it, cannot be deleted, and a missing one stops the export', async () => {
    const pdf = await store.addMedia(PDF, 'menu.pdf');
    await link(pdf.path);
    const refused = await call(`/api/media?name=${pdf.name}`, { method: 'DELETE' });
    expect(((await refused.json()) as { error: string }).error).toContain('this file is used on: Home');
    await store.publish('');
    const out = join(dir, 'out');
    expect(await exportSite(store, out)).toContain(pdf.path.slice(1));
    expect(new Uint8Array(await Bun.file(join(out, pdf.path)).arrayBuffer())).toEqual(PDF);
    await link(`/media/${'0'.repeat(32)}.pdf`);
    await store.publish('');
    await expect(exportSite(store, out)).rejects.toThrow('links to a file this site does not have');
  });

  test('the served site reads a video from the library when it is asked for, not when the site is built', async () => {
    const video = await store.addMedia(MP4, 'clip.mp4');
    await link(video.path);
    await store.publish('');
    expect((await publishedSite(store, true)).get(video.path.slice(1))).toEqual(new Uint8Array(0));
    const runtime = startRuntime(store, { listen: false, log: () => {} });
    try {
      const part = await runtime.fetch(new Request(`http://site${video.path}`, { headers: { range: 'bytes=0-3' } }));
      expect(part.status).toBe(206);
      expect(part.headers.get('content-type')).toBe('video/mp4');
      expect(new Uint8Array(await part.arrayBuffer())).toEqual(MP4.slice(0, 4));
      // A file nothing published links to is not served by the site.
      const other = await store.addMedia(PDF, 'draft.pdf');
      expect((await runtime.fetch(new Request(`http://site${other.path}`))).status).toBe(404);
    } finally {
      runtime.stop();
    }
  });
});
