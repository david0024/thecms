/**
 * What ships inside the program: the themes, the language packs, the CSS
 * every page starts from. Imported, not read from a folder, so the single
 * executable (`tools/build.ts`) carries them. A test holds these lists to the
 * folders, so a file added there is not forgotten here.
 */
import plain from '../../themes/plain.json';
import studio from '../../themes/studio.json';
import ro from '../../languages/ro.json';
import baseCss from '../blocks/base.css' with { type: 'text' };
import statsPackage from '../../extensions/stats/stats.thecms-extension' with { type: 'text' };

/** The themes in `themes/`, by file name. */
export const SHIPPED_THEMES: Record<string, unknown> = { 'plain.json': plain, 'studio.json': studio };
/** The language packs in `languages/`, by file name. */
export const SHIPPED_LANGUAGES: Record<string, unknown> = { 'ro.json': ro };
/** The structure every page's CSS starts with; the theme's comes after it. */
export const BASE_CSS: string = baseCss;
/** The theme a new site starts with. */
export const DEFAULT_THEME: unknown = plain;
/**
 * The statistics, packed (ADR 0062 d8): an extension the program carries, so
 * that the Statistics screen installs it with one button. A test holds it to
 * a fresh pack of `extensions/stats`.
 */
export const SHIPPED_STATS: string = statsPackage;
