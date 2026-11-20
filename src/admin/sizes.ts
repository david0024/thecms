/**
 * The smaller copies of each picture (ADR 0005 d8), made here in the browser
 * so the program needs no image library: a phone is then sent the copy that
 * fits its screen, not the whole picture.
 *
 * A picture uploaded now gets them at once. One uploaded before, the first
 * time the media screen opens. A browser that cannot draw a picture leaves it
 * with one size, as it was.
 */
import { canVary, wantedWidths } from '../core/index.ts';
import { api, type MediaItem } from './api.ts';
import { shrink } from './shrink.ts';

const QUALITY = 0.82;

/** The widths this picture still lacks. */
export const missing = (item: MediaItem): number[] => (canVary(item.name) ? wantedWidths(item.width).filter((w) => !item.variants.includes(w)) : []);

async function encode(canvas: HTMLCanvasElement): Promise<Blob | null> {
  const webp = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', QUALITY));
  if (webp?.type === 'image/webp') return webp;
  // A browser that cannot write WebP writes a JPEG.
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITY));
}

/** Makes and sends the copies a picture lacks; answers with the picture as the site now knows it. */
export async function prepareSizes(item: MediaItem, source?: Blob): Promise<MediaItem> {
  const widths = missing(item);
  if (!widths.length) return item;
  try {
    const bitmap = await createImageBitmap(source ?? (await (await fetch(item.path)).blob()));
    let known = item;
    for (const width of widths) {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = Math.round((item.height * width) / item.width);
      canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await encode(canvas);
      if (blob) known = (await api.addVariant(item.name, blob)).item;
    }
    bitmap.close();
    return known;
  } catch {
    return item;
  }
}

/** Every picture that lacks copies gets them, one after another; `onstep` says how many are done. */
export async function prepareAll(items: MediaItem[], onstep: (done: number, of: number) => void = () => {}): Promise<MediaItem[]> {
  const todo = items.filter((item) => missing(item).length > 0);
  const done = new Map<string, MediaItem>();
  for (const [i, item] of todo.entries()) {
    onstep(i, todo.length);
    done.set(item.name, await prepareSizes(item));
  }
  if (todo.length) onstep(todo.length, todo.length);
  return items.map((item) => done.get(item.name) ?? item);
}

/** A picture from the author's device: made light, stored, and given its smaller copies. */
export async function uploadImage(file: File): Promise<{ item: MediaItem; media: MediaItem[] }> {
  const light = await shrink(file);
  const { item, media } = await api.upload(light, file.name);
  const sized = await prepareSizes(item, light);
  return { item: sized, media: media.map((m) => (m.name === sized.name ? sized : m)) };
}
