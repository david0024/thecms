/**
 * What a page says to search engines as schema.org data, besides its title
 * (ADR 0030, ADR 0061): the business behind the site, the questions a page
 * answers, and what an entry is when it is an event or a product.
 */
import type { Block } from './blocks.ts';
import type { Site } from './page.ts';
import type { Post } from './post.ts';
import { richTextPlain, type RichText } from './richtext.ts';
import { WEEKDAYS } from './seo.ts';
import { combinations, inStock, paid, priceOf, type ShopShown, stockKey } from './shop.ts';
import { type ContentType, fieldMeaning, type FieldMeaning } from './types.ts';

type Data = Record<string, unknown>;

const absolute = (site: Site, src: string): string => (src.startsWith('/') ? `${site.url}${src}` : src);

/**
 * The business behind the site: who publishes every page. With an address,
 * a telephone or a kind, it is a local business: where it is, when it is
 * open, how to reach it (ADR 0061 d2).
 */
export function organizationData(site: Site): Data {
  const b = site.business;
  const local = !!b && !!(b.kind || b.street || b.city || b.phone || b.hours);
  const address = b && (b.street || b.city || b.postalCode || b.region || b.country)
    ? {
        '@type': 'PostalAddress',
        ...(b.street ? { streetAddress: b.street } : {}),
        ...(b.city ? { addressLocality: b.city } : {}),
        ...(b.region ? { addressRegion: b.region } : {}),
        ...(b.postalCode ? { postalCode: b.postalCode } : {}),
        ...(b.country ? { addressCountry: b.country } : {}),
      }
    : null;
  // Days with the same hours are said once, as schema.org allows.
  const opening: Data[] = [];
  for (const [i, hours] of (b?.hours ?? []).entries()) {
    for (const range of hours ? hours.split(', ') : []) {
      const [opens, closes] = range.split('-');
      const same = opening.find((o) => o.opens === opens && o.closes === closes);
      if (same) (same.dayOfWeek as string[]).push(WEEKDAYS[i] as string);
      else opening.push({ '@type': 'OpeningHoursSpecification', dayOfWeek: [WEEKDAYS[i]], opens, closes });
    }
  }
  return {
    '@type': local ? (b?.kind ?? 'LocalBusiness') : 'Organization',
    '@id': `${site.url}/#organization`,
    name: site.name,
    url: `${site.url}/`,
    ...(site.logo ? { logo: absolute(site, site.logo.src), ...(local ? { image: absolute(site, site.logo.src) } : {}) } : {}),
    ...(address ? { address } : {}),
    ...(b?.phone ? { telephone: b.phone } : {}),
    ...(b?.email ? { email: b.email } : {}),
    ...(local && b?.priceRange ? { priceRange: b.priceRange } : {}),
    ...(local && opening.length ? { openingHoursSpecification: opening } : {}),
  };
}

/**
 * The questions a page answers, from its blocks of questions and answers
 * (ADR 0061 d1), in the order they are shown; nothing when it has none.
 */
export function faqData(blocks: Block[]): Data | null {
  const questions: Data[] = [];
  const walk = (list: Block[]): void => {
    for (const block of list) {
      if (block.type === 'faq' && Array.isArray(block.content.items)) {
        for (const item of block.content.items as { question?: unknown; answer?: unknown }[]) {
          const name = typeof item.question === 'string' ? item.question.trim() : '';
          const text = typeof item.answer === 'string' ? item.answer.trim() : Array.isArray(item.answer) ? richTextPlain(item.answer as RichText) : '';
          if (name && text) questions.push({ '@type': 'Question', name, acceptedAnswer: { '@type': 'Answer', text } });
        }
      }
      if (block.children) walk(block.children);
    }
  };
  walk(blocks);
  return questions.length ? { '@type': 'FAQPage', mainEntity: questions } : null;
}

/** The value of the field that means this, if the entry has one. */
function meant(type: ContentType, post: Post, meaning: FieldMeaning): unknown {
  const field = fieldMeaning(type, meaning);
  const value = field ? post.fields[field.key] : undefined;
  return value === '' || value === null ? undefined : value;
}

/**
 * An entry of a type whose entries are events or products (ADR 0061 d3): what
 * search engines show beside it. An event needs its start, a product its
 * name; without them, nothing is said.
 */
export function entrySchemaData(site: Site, type: ContentType, post: Post, url: string, description: string): Data | null {
  if (!type.schema) return null;
  const image = post.cover ? absolute(site, post.cover.src) : undefined;
  const currency = site.business?.currency;
  const price = meant(type, post, 'price');
  const offer = (extra: Data = {}): Data | null =>
    typeof price === 'number' && currency ? { offers: { '@type': 'Offer', price, priceCurrency: currency, url, ...extra } } : null;
  if (type.schema === 'event') {
    const start = meant(type, post, 'start');
    if (typeof start !== 'string') return null;
    const end = meant(type, post, 'end');
    const place = meant(type, post, 'place');
    return {
      '@type': 'Event',
      name: post.title,
      startDate: start,
      ...(typeof end === 'string' ? { endDate: end } : {}),
      url,
      ...(description ? { description } : {}),
      ...(image ? { image } : {}),
      eventStatus: 'https://schema.org/EventScheduled',
      eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
      ...(typeof place === 'string' ? { location: { '@type': 'Place', name: place, address: place } } : {}),
      organizer: { '@id': `${site.url}/#organization` },
      ...offer(),
    };
  }
  const brand = meant(type, post, 'brand');
  // A product the shop sells (ADR 0065 d1) says the shop's price, code and stock, while the shop is on.
  if (type.sells && post.product && site.shop) {
    const product = post.product;
    const slug = post.of ?? post.slug;
    const keys = product.options.length ? combinations(product.options) : [''];
    const sold = keys.map((key) => ({ ...priceOf(product, key), left: inStock(site.shop as ShopShown, product, stockKey(type.id, slug, key)) })).filter((c) => c.price !== null);
    const prices = sold.map((c) => (paid(c) as number) / 100);
    const availability = `https://schema.org/${sold.some((c) => c.left) ? 'InStock' : 'OutOfStock'}`;
    const offers = !prices.length
      ? {}
      : prices.length === 1 || Math.min(...prices) === Math.max(...prices)
        ? { offers: { '@type': 'Offer', price: prices[0], priceCurrency: site.shop.currency, url, availability } }
        : { offers: { '@type': 'AggregateOffer', lowPrice: Math.min(...prices), highPrice: Math.max(...prices), offerCount: prices.length, priceCurrency: site.shop.currency, url, availability } };
    return {
      '@type': 'Product',
      name: post.title,
      url,
      ...(description ? { description } : {}),
      ...(image ? { image } : {}),
      ...(product.sku ? { sku: product.sku } : {}),
      ...(typeof brand === 'string' ? { brand: { '@type': 'Brand', name: brand } } : {}),
      ...offers,
    };
  }
  const sku = meant(type, post, 'sku');
  const stocked = meant(type, post, 'inStock');
  return {
    '@type': 'Product',
    name: post.title,
    url,
    ...(description ? { description } : {}),
    ...(image ? { image } : {}),
    ...(typeof sku === 'string' ? { sku } : {}),
    ...(typeof brand === 'string' ? { brand: { '@type': 'Brand', name: brand } } : {}),
    ...offer(typeof stocked === 'boolean' ? { availability: `https://schema.org/${stocked ? 'InStock' : 'OutOfStock'}` } : {}),
  };
}
