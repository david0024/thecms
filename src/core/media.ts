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

/** How wide and high an image is, read from its bytes; null when they do not say. */
export function imageSize(bytes: Uint8Array): { width: number; height: number } | null {
  const ext = imageExt(bytes);
  const at = (i: number): number => bytes[i] ?? 0;
  const be16 = (i: number): number => (at(i) << 8) | at(i + 1);
  const be32 = (i: number): number => ((at(i) << 24) | (at(i + 1) << 16) | (at(i + 2) << 8) | at(i + 3)) >>> 0;
  const le16 = (i: number): number => at(i) | (at(i + 1) << 8);
  const le24 = (i: number): number => at(i) | (at(i + 1) << 8) | (at(i + 2) << 16);
  const size = (width: number, height: number) => (width > 0 && height > 0 ? { width, height } : null);
  switch (ext) {
    case 'png':
      return bytes.length >= 24 ? size(be32(16), be32(20)) : null;
    case 'gif':
      return size(le16(6), le16(8));
    case 'webp': {
      const chunk = ascii(bytes, 12, 4);
      if (chunk === 'VP8 ' && bytes.length >= 30) return size(le16(26) & 0x3fff, le16(28) & 0x3fff);
      if (chunk === 'VP8L' && bytes.length >= 25) return size(1 + (((at(22) & 0x3f) << 8) | at(21)), 1 + (((at(24) & 0x0f) << 10) | (at(23) << 2) | ((at(22) & 0xc0) >> 6)));
      if (chunk === 'VP8X' && bytes.length >= 30) return size(1 + le24(24), 1 + le24(27));
      return null;
    }
    case 'jpg': {
      // The frame header (SOF) holds the size; every segment before it says how long it is.
      let i = 2;
      while (i + 9 < bytes.length) {
        if (at(i) !== 0xff) return null;
        const marker = at(i + 1);
        if (marker === 0xff) {
          i++;
          continue;
        }
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return size(be16(i + 7), be16(i + 5));
        i += 2 + be16(i + 2);
      }
      return null;
    }
    case 'avif': {
      // The first 'ispe' property is the picture's own size.
      for (let i = 4; i + 16 <= bytes.length; i++) if (at(i) === 0x69 && ascii(bytes, i, 4) === 'ispe') return size(be32(i + 8), be32(i + 12));
      return null;
    }
    default:
      return null;
  }
}

/**
 * Smaller copies of a picture (ADR 0005 d8), made by the browser when it is
 * uploaded: a phone is sent the one that fits its screen. The program stays
 * one file, with no image library in it.
 */
export const VARIANT_WIDTHS = [480, 960, 1600] as const;

const VARIANT = /^([a-f0-9]{32})-(\d{2,4})\.(webp|jpg)$/;

/** A smaller copy is named after its picture and its width: `<hash>-<width>.<format>`. */
export const variantName = (name: string, width: number, ext: 'webp' | 'jpg'): string => `${name.split('.')[0]}-${width}.${ext}`;

/** The picture a smaller copy belongs to (by its hash) and how wide it is; null for any other name. */
export function variantOf(name: string): { hash: string; width: number } | null {
  const match = VARIANT.exec(name);
  return match ? { hash: match[1] as string, width: Number(match[2]) } : null;
}

/** A picture a browser can draw again without losing anything: not a GIF or an AVIF, which may move. */
export const canVary = (name: string): boolean => /\.(png|jpg|webp)$/.test(name);

/** The widths a picture this wide gets smaller copies at. */
export const wantedWidths = (width: number): number[] => VARIANT_WIDTHS.filter((w) => w < width);

/** What the site knows of a stored picture: its size, and its smaller copies by name. */
export interface MediaSize {
  width: number;
  height: number;
  variants: string[];
}

/**
 * What a page needs to offer each picture at the right size: the stored
 * pictures' sizes, and how wide the theme's widths are. Filled in to draw a
 * page for export, never kept.
 */
export interface Pictures {
  sizes: Record<string, MediaSize>;
  /** The theme's width tokens: narrow, content, wide. */
  widths: Record<string, string>;
}

/** How much of the width a picture takes where it is drawn. */
export type Share = 'full' | 'half' | 'card' | 'thumb';

/** Block types drawn wide by default (base.css), unless the layout says otherwise. */
const WIDE_BLOCKS = new Set(['hero', 'gallery', 'pricing']);

const ABSOLUTE = /^\d{1,4}(\.\d{1,4})?(rem|px|vw)$/;

/**
 * How wide the content runs, as a length a `sizes` attribute can read: from
 * the layout (ADR 0035), and from the block's own width when it sets one.
 */
export function measureFor(widths: Record<string, string>, layout: string, type = '', maxWidth?: { token: string } | { value: string }): string {
  const token = (name: string): string => (ABSOLUTE.test(widths[name] ?? '') ? (widths[name] as string) : '100vw');
  if (maxWidth) {
    const own = 'token' in maxWidth ? widths[maxWidth.token] : maxWidth.value;
    if (own && ABSOLUTE.test(own)) return own;
  }
  if (layout === 'full') return '100vw';
  if (layout === 'narrow') return token('narrow');
  if (layout === 'wide' || WIDE_BLOCKS.has(type)) return token('wide');
  return token('content');
}

/** The attributes that let a browser pick the right copy and keep the page from jumping while it loads. */
export function pictureAttrs(
  pictures: Pictures | undefined,
  src: string,
  measure: string,
  share: Share,
): { width?: number; height?: number; srcset?: string; sizes?: string } {
  const name = mediaNameOf(src);
  const known = name ? pictures?.sizes[name] : undefined;
  if (!known) return {};
  const variants = known.variants
    .map((v) => ({ v, width: variantOf(v)?.width ?? 0 }))
    .filter((c) => c.width > 0 && c.width < known.width)
    .sort((a, b) => a.width - b.width);
  if (!variants.length) return { width: known.width, height: known.height };
  const full = measure === '100vw' ? '100vw' : `min(100vw, ${measure})`;
  const sizes = { full, half: `(max-width: 40rem) 100vw, calc(${full} / 2)`, card: '(max-width: 30rem) 100vw, 20rem', thumb: '6rem' }[share];
  return {
    width: known.width,
    height: known.height,
    srcset: [...variants.map((c) => `${mediaPath(c.v)} ${c.width}w`), `${src} ${known.width}w`].join(', '),
    sizes,
  };
}
