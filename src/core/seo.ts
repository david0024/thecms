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

/** The days of a week, as schema.org names them, from Monday. */
export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

/**
 * The kinds of local business search engines know, the most asked for: the
 * owner picks one, and "LocalBusiness" says only that it is a place to go to.
 */
export const BUSINESS_KINDS = [
  'LocalBusiness',
  'Store',
  'Restaurant',
  'CafeOrCoffeeShop',
  'Bakery',
  'BarOrPub',
  'BeautySalon',
  'HairSalon',
  'HealthAndBeautyBusiness',
  'Dentist',
  'MedicalClinic',
  'Physician',
  'LegalService',
  'AccountingService',
  'RealEstateAgent',
  'AutoRepair',
  'HomeAndConstructionBusiness',
  'LodgingBusiness',
  'SportsActivityLocation',
  'EducationalOrganization',
  'ProfessionalService',
] as const;
export type BusinessKind = (typeof BUSINESS_KINDS)[number];

/** The business behind the site as a place people come to (ADR 0061 d2): each part absent until written. */
export interface Business {
  kind?: BusinessKind;
  street?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  /** Two letters: `RO`. */
  country?: string;
  phone?: string;
  email?: string;
  /** `$$`, or "50–200 lei". */
  priceRange?: string;
  /** Each day's hours, Monday first: `09:00-13:00, 14:00-18:00`; empty: closed. */
  hours?: string[];
  /** The currency of the site's prices, three letters: `RON`. */
  currency?: string;
}

/**
 * One day's hours as written, in the form schema.org takes: `9-18`,
 * `09:00–18:00` or `9:30 - 13, 14 - 18` give `09:00-18:00` and the like. What
 * is not a time is dropped; nothing left means closed.
 */
export function cleanHours(raw: unknown): string {
  const time = (h: string, m = '0'): string | null => (Number(h) <= 24 && Number(m) < 60 ? `${h.padStart(2, '0')}:${m.padStart(2, '0')}` : null);
  const out: string[] = [];
  for (const match of String(typeof raw === 'string' ? raw : '').matchAll(/(\d{1,2})(?:[:.](\d{2}))?\s*[-–—]\s*(\d{1,2})(?:[:.](\d{2}))?/g)) {
    const from = time(match[1] as string, match[2]);
    const to = time(match[3] as string, match[4]);
    if (from && to && out.length < 4) out.push(`${from}-${to}`);
  }
  return out.join(', ');
}

export function cleanBusiness(raw: unknown): Business | undefined {
  const given = isObject(raw) ? raw : {};
  const line = (value: unknown, max: number): string => str(value, max).replace(/\s+/g, ' ').trim();
  const hours = Array.isArray(given.hours) ? WEEKDAYS.map((_, i) => cleanHours((given.hours as unknown[])[i])) : [];
  const email = line(given.email, 200);
  const country = line(given.country, 2).toUpperCase();
  const currency = line(given.currency, 3).toUpperCase();
  const business: Business = {
    ...(BUSINESS_KINDS.includes(given.kind as BusinessKind) ? { kind: given.kind as BusinessKind } : {}),
    ...(line(given.street, 200) ? { street: line(given.street, 200) } : {}),
    ...(line(given.city, 100) ? { city: line(given.city, 100) } : {}),
    ...(line(given.region, 100) ? { region: line(given.region, 100) } : {}),
    ...(line(given.postalCode, 20) ? { postalCode: line(given.postalCode, 20) } : {}),
    ...(/^[A-Z]{2}$/.test(country) ? { country } : {}),
    ...(/^[+\d][\d\s().-]{3,30}$/.test(line(given.phone, 40)) ? { phone: line(given.phone, 40) } : {}),
    ...(/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(email) ? { email } : {}),
    ...(line(given.priceRange, 40) ? { priceRange: line(given.priceRange, 40) } : {}),
    ...(hours.some(Boolean) ? { hours } : {}),
    ...(/^[A-Z]{3}$/.test(currency) ? { currency } : {}),
  };
  return Object.keys(business).length ? business : undefined;
}
