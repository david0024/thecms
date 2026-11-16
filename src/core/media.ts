/**
 * Images an author uploads (ADR 0005).
 *
 * A file is what its bytes say it is, never what its name or the browser
 * claims. Only raster formats are taken: an SVG is a document that can carry
 * script, and it would be served from the site's own address.
 */

export const MEDIA_TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
} as const;

export type MediaExt = keyof typeof MEDIA_TYPES;

/** The most one image may weigh. */
export const MEDIA_MAX_BYTES = 10 * 1024 * 1024;

const ascii = (bytes: Uint8Array, from: number, length: number): string => String.fromCharCode(...bytes.subarray(from, from + length));

/** The image format these bytes are in, or null when they are not an image we take. */
export function imageExt(bytes: Uint8Array): MediaExt | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0x89 && ascii(bytes, 1, 3) === 'PNG' && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return 'png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a') return 'gif';
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'webp';
  if (ascii(bytes, 4, 4) === 'ftyp' && (ascii(bytes, 8, 4) === 'avif' || ascii(bytes, 8, 4) === 'avis')) return 'avif';
  return null;
}

const NAME = /^[a-f0-9]{32}\.(png|jpg|gif|webp|avif)$/;

/** A stored image is named by its contents: `<hash>.<format>`. */
export const isMediaName = (v: unknown): v is string => typeof v === 'string' && NAME.test(v);

export const MEDIA_PREFIX = '/media/';

export const mediaPath = (name: string): string => `${MEDIA_PREFIX}${name}`;

/** The stored image an address points at, or null for an address elsewhere. */
export function mediaNameOf(src: string): string | null {
  if (!src.startsWith(MEDIA_PREFIX)) return null;
  const name = src.slice(MEDIA_PREFIX.length);
  return isMediaName(name) ? name : null;
}
