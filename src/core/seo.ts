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
