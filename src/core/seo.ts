/**
 * Search engines and sharing (ADR 0050): what a page or an entry says to them
 * besides its title and description. The breadcrumbs are made in `post.ts`.
 */
import { cleanImage, type ImageValue } from './blocks.ts';
import { isObject, str } from './util.ts';

/** What a page or an entry may say to search engines and link previews. Each part is absent until it is set. */
export interface Seo {
  /** The whole title of the tab, the result and the preview, in place of the page's own (d1). */
  seoTitle?: string;
  /** The picture of a link preview (d1). */
  shareImage?: ImageValue;
  /** Kept out of search engines, the sitemap and the site's search (d3). */
  noindex?: true;
}

/** A title for search engines keeps at most this many letters. */
export const MAX_SEO_TITLE = 70;
/** Longer, a search engine cuts it: the site check says so (d5). */
export const LONG_TITLE = 60;

/** The parts of `raw` that are set, cleaned; what is not set is left out. */
export function cleanSeo(raw: unknown): Seo {
  const given = isObject(raw) ? raw : {};
  const seoTitle = str(given.seoTitle, MAX_SEO_TITLE).trim();
  const shareImage = cleanImage(given.shareImage);
  return {
    ...(seoTitle ? { seoTitle } : {}),
    ...(shareImage ? { shareImage } : {}),
    ...(given.noindex === true ? { noindex: true as const } : {}),
  };
}

/**
 * Words for a picture from its file's name, offered when it is uploaded or
 * picked and its place has none (ADR 0058 d2): `sala-de-nunti_2.jpg` is
 * "Sala de nunti". A name a camera or a phone gave (`IMG_1234`, `DSC0042`,
 * `PXL_20241102_…`, `Screenshot …`) or one made only of digits says nothing,
 * and gives nothing.
 */
export function altFromName(name: string): string {
  const base = (name.split(/[\\/]/).pop() ?? '')
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    // The sizes a program adds (`-1024x768`, `@2x`), and a copy's number (`-1`, ` (2)`).
    .replace(/[-_ ]?\d{2,5}x\d{2,5}$/i, '')
    .replace(/@\dx$/i, '')
    .replace(/(?:[-_ ]\d{1,2}| \(\d+\))$/, '');
  const spaced = base.replace(/[-_]/g, ' ');
  if (/^(img|dsc|dscn|dscf|pxl|mvimg|screenshot|captur[ae]|whatsapp|signal|untitled)(?!\p{L})/iu.test(spaced)) return '';
  // "photo 3", "image-12": a word that says only that it is a picture.
  if (/^(photo|image|picture|pic|foto|poza|imagine)[\s\d]*$/iu.test(spaced)) return '';
  const words = base.replace(/[-_.+]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!/\p{L}{2}/u.test(words) || /^[\d\s]+$/.test(words)) return '';
  // A long run of letters and digits is a generated id, not words.
  if (words.split(' ').some((word) => word.length > 20 || (/\d/.test(word) && /\p{L}/u.test(word) && word.length > 8))) return '';
  return `${words[0]?.toLocaleUpperCase() ?? ''}${words.slice(1)}`.slice(0, 300);
}
