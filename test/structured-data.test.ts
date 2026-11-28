import { describe, expect, test } from 'bun:test';
import {
  cleanBusiness,
  cleanHours,
  type ContentType,
  faqData,
  normalizeBlocks,
  normalizePage,
  normalizePost,
  normalizeSite,
  normalizeTypes,
  organizationData,
  parseTheme,
  type Theme,
} from '../src/core/index.ts';
import { renderPage, renderPost } from '../src/site/document.ts';
import plain from '../themes/plain.json';

const theme = parseTheme(plain).theme as Theme;
const site = normalizeSite({ name: 'Atelier', url: 'https://example.com', logo: { src: '/media/logo.png', alt: '' } });
/** The schema.org data a page says, as objects. */
const data = (html: string): Record<string, unknown>[] => {
  const json = /<script type="application\/ld\+json">([^<]*)<\/script>/.exec(html)?.[1];
  return json ? (JSON.parse(json.replace(/\\u003c/g, '<')) as { '@graph': Record<string, unknown>[] })['@graph'] : [];
};
const ofType = (html: string, type: string) => data(html).find((d) => d['@type'] === type);

describe('the business as a place people come to (ADR 0061 d2)', () => {
  test('hours are read as people write them', () => {
    expect(cleanHours('9-18')).toBe('09:00-18:00');
    expect(cleanHours('9:30 – 13, 14.15-18')).toBe('09:30-13:00, 14:15-18:00');
    expect(cleanHours('closed')).toBe('');
    expect(cleanHours('25-30')).toBe('');
  });

  test('only what is right is kept', () => {
    expect(cleanBusiness({ kind: 'Bakery', street: ' Str. Lungă  5 ', country: 'ro', phone: '+40 721 000 000', email: 'not an email', currency: 'ron', hours: ['9-18', '', 'x'] })).toEqual({
      kind: 'Bakery',
      street: 'Str. Lungă 5',
      country: 'RO',
      phone: '+40 721 000 000',
      currency: 'RON',
      hours: ['09:00-18:00', '', '', '', '', '', ''],
    });
    expect(cleanBusiness({ kind: 'Spaceship', phone: 'call me' })).toBeUndefined();
    expect(normalizeSite({ business: { city: 'Cluj' } }).business).toEqual({ city: 'Cluj' });
  });

  test('without it the business is an organization; with it, a local business with its address and hours', () => {
    expect(organizationData(site)).toEqual({ '@type': 'Organization', '@id': 'https://example.com/#organization', name: 'Atelier', url: 'https://example.com/', logo: 'https://example.com/media/logo.png' });
    const local = organizationData({ ...site, business: cleanBusiness({ kind: 'Bakery', street: 'Str. Lungă 5', city: 'Cluj', country: 'RO', phone: '+40 721', priceRange: '$$', hours: ['8-18', '8-18', '8-18', '8-18', '8-18', '9-13', ''] }) });
    expect(local).toMatchObject({
      '@type': 'Bakery',
      image: 'https://example.com/media/logo.png',
      address: { '@type': 'PostalAddress', streetAddress: 'Str. Lungă 5', addressLocality: 'Cluj', addressCountry: 'RO' },
      telephone: '+40 721',
      priceRange: '$$',
      openingHoursSpecification: [
        { '@type': 'OpeningHoursSpecification', dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], opens: '08:00', closes: '18:00' },
        { '@type': 'OpeningHoursSpecification', dayOfWeek: ['Saturday'], opens: '09:00', closes: '13:00' },
      ],
    });
    expect(organizationData({ ...site, business: { city: 'Cluj' } })['@type']).toBe('LocalBusiness');
    expect(organizationData({ ...site, business: { currency: 'RON' } })['@type']).toBe('Organization');
    const home = renderPage({ ...site, business: { kind: 'Store', city: 'Cluj' } }, theme, normalizePage({ slug: '', title: 'Home', blocks: [] }).page, []);
    expect(ofType(home, 'Store')).toMatchObject({ address: { addressLocality: 'Cluj' } });
  });
});

describe('the questions a page answers (ADR 0061 d1)', () => {
  const faq = normalizeBlocks([{ type: 'faq', content: { title: 'Asked', items: [{ question: 'Do you deliver?', answer: 'Yes, in Cluj.' }, { question: 'No answer', answer: '' }] }, children: [] }]).blocks;

  test('a page or an entry with questions and answers says them', () => {
    expect(faqData(faq)).toEqual({ '@type': 'FAQPage', mainEntity: [{ '@type': 'Question', name: 'Do you deliver?', acceptedAnswer: { '@type': 'Answer', text: 'Yes, in Cluj.' } }] });
    expect(faqData([])).toBeNull();
    const page = renderPage(site, theme, normalizePage({ slug: 'help', title: 'Help', blocks: faq }).page, []);
    expect(ofType(page, 'FAQPage')).toBeDefined();
    const post = renderPost(site, theme, normalizePost({ slug: 'a', title: 'A', date: '2026-11-01', blocks: faq }).post, []);
    expect(ofType(post, 'FAQPage')).toBeDefined();
    expect(ofType(post, 'BlogPosting')).toBeDefined();
  });

  test('a page without them says nothing more', () => {
    expect(renderPage(site, theme, normalizePage({ slug: 'about', title: 'About', blocks: [] }).page, [])).not.toContain('ld+json');
  });
});

describe('events and products (ADR 0061 d3)', () => {
  const [events, products] = normalizeTypes([
    {
      name: 'Events',
      dated: true,
      schema: 'event',
      fields: [
        { label: 'Starts', kind: 'date', means: 'start' },
        { label: 'Ends', kind: 'date', means: 'end' },
        { label: 'Where', kind: 'text', means: 'place' },
        { label: 'Ticket', kind: 'number', means: 'price' },
        { label: 'Again', kind: 'date', means: 'start' },
        { label: 'Wrong', kind: 'yesno', means: 'place' },
      ],
    },
    {
      name: 'Products',
      schema: 'product',
      fields: [
        { label: 'Price', kind: 'number', means: 'price' },
        { label: 'Code', kind: 'text', means: 'sku' },
        { label: 'Brand', kind: 'text', means: 'brand' },
        { label: 'In stock', kind: 'yesno', means: 'inStock' },
      ],
    },
    { name: 'Notes', schema: 'recipe', fields: [{ label: 'Price', kind: 'number', means: 'price' }] },
  ]) as ContentType[];

  test('a meaning is kept once, on a field that can say it, on a type of events or products', () => {
    expect(events?.fields.map((f) => f.means ?? '-')).toEqual(['start', 'end', 'place', 'price', '-', '-']);
    const notes = normalizeTypes([{ name: 'Notes', schema: 'recipe', fields: [{ label: 'Price', kind: 'number', means: 'price' }] }])[0];
    expect(notes?.schema).toBeUndefined();
    expect(notes?.fields[0]?.means).toBeUndefined();
  });

  const shop = normalizeSite({ name: 'Atelier', url: 'https://example.com', business: { currency: 'RON' }, types: [events, products] });

  test('an event says when, where and what a ticket costs, instead of an article', () => {
    const post = normalizePost({ slug: 'fair', title: 'Wood fair', date: '2026-11-01', fields: { starts: '2026-12-05', ends: '2026-12-06', where: 'Cluj, Piața Unirii', ticket: 20 } }, undefined, events).post;
    const html = renderPost(shop, theme, post, [], events);
    expect(ofType(html, 'BlogPosting')).toBeUndefined();
    expect(ofType(html, 'Event')).toMatchObject({
      name: 'Wood fair',
      startDate: '2026-12-05',
      endDate: '2026-12-06',
      url: 'https://example.com/events/fair/',
      location: { '@type': 'Place', name: 'Cluj, Piața Unirii' },
      organizer: { '@id': 'https://example.com/#organization' },
      offers: { '@type': 'Offer', price: 20, priceCurrency: 'RON' },
    });
    expect(ofType(html, 'Organization')).toBeDefined();
    const unstarted = renderPost(shop, theme, { ...post, fields: { ...post.fields, starts: '' } }, [], events);
    expect(ofType(unstarted, 'Event')).toBeUndefined();
  });

  test('a product says its price, code, brand and whether it is in stock', () => {
    const post = normalizePost({ slug: 'oak-table', title: 'Oak table', cover: { src: '/media/t.jpg', alt: '' }, fields: { price: 3200, code: 'OT-1', brand: 'Atelier', [products?.fields[3]?.key ?? '']: false } }, undefined, products).post;
    const html = renderPost(shop, theme, post, [], products);
    expect(ofType(html, 'Product')).toMatchObject({
      name: 'Oak table',
      image: 'https://example.com/media/t.jpg',
      brand: { '@type': 'Brand', name: 'Atelier' },
      offers: { '@type': 'Offer', price: 3200, priceCurrency: 'RON' },
    });
    expect(JSON.stringify(ofType(html, 'Product'))).toContain('OutOfStock');
    // Without a currency in Settings, no price is said.
    expect(ofType(renderPost(normalizeSite({ ...shop, business: undefined }), theme, post, [], products), 'Product')).not.toHaveProperty('offers');
  });
});
