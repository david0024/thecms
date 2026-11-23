/**
 * The shop's words about a product (ADR 0065 d1, d2): what an entry of a type
 * that sells carries besides the fields its owner defined. Only data here; the
 * shop itself (its stock, cart and orders) is the site's, loaded only while it
 * is on (ADR 0060 d3).
 *
 * Money is kept in the currency's smallest unit (bani, cents) as a whole
 * number, so that no sum is ever a fraction a computer rounds.
 */
import { isObject, str } from './util.ts';

/** An option a product is sold in (ADR 0065 d2): `Size`, with `S`, `M`, `L`. */
export interface ProductOption {
  name: string;
  values: string[];
}

/** What one combination of the options changes from the product: empty, the product's own. */
export interface ProductVariant {
  price: number | null;
  sale: number | null;
  sku: string;
}

export interface Product {
  /** With VAT included, in the smallest unit; null while the owner has not given one (it cannot be bought then). */
  price: number | null;
  /** The price it is sold at for now; null for none. */
  sale: number | null;
  sku: string;
  /** The VAT rate, as a percentage (ADR 0065 d5); null: the site's first rate, whatever it is then. */
  vat: number | null;
  /** Its stock is counted (in the shop's table, not here); otherwise it is always there. */
  counted: boolean;
  /** At most {@link MAX_PRODUCT_OPTIONS}, each with at most {@link MAX_VALUES} values. */
  options: ProductOption[];
  /** By the combination's key (`M / Red`): only those that change something. */
  variants: Record<string, ProductVariant>;
}

export const MAX_PRODUCT_OPTIONS = 3;
export const MAX_VALUES = 20;
/** The most combinations a product is sold in: more is a catalogue, not a product. */
export const MAX_COMBINATIONS = 100;
/** The VAT rates a site starts with (Romania, from August 2025). */
export const DEFAULT_RATES: readonly number[] = [21, 11, 0];
/** The most rates a site names. */
export const MAX_RATES = 6;
/** What a variant's key joins its values with. */
export const VARIANT_JOIN = ' / ';

/**
 * A sum as typed (`49,99`, `49.9`, `1 250`) or stored, in the smallest unit:
 * `4999`. Null for nothing, a negative sum or what is not a sum.
 */
export function moneyOf(value: unknown): number | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? value : null;
  if (typeof value !== 'string') return null;
  const typed = value.replace(/[\s ]/g, '');
  const match = /^(\d{1,9})(?:[.,](\d{1,2}))?$/.exec(typed);
  if (!match) return null;
  return Number(match[1]) * 100 + Number(((match[2] ?? '') + '00').slice(0, 2));
}

/** A sum in the smallest unit as typed in a form: `4999` → `49.99`, `5000` → `50`. */
export const typedMoney = (value: number | null): string => (value === null ? '' : value % 100 === 0 ? String(value / 100) : (value / 100).toFixed(2));

/** A sum as a visitor reads it, in the site's language and currency: `49,99 lei`. */
export function moneyText(value: number, currency: string, language: string): string {
  try {
    return new Intl.NumberFormat(language || 'en', { style: 'currency', currency: currency || 'RON' }).format(value / 100);
  } catch {
    return `${(value / 100).toFixed(2)} ${currency}`;
  }
}

/** A VAT rate: a percentage from 0 to 100, with at most two decimals. */
const rateOf = (value: unknown): number | null => {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value.trim().replace(',', '.')) : Number.NaN;
  return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n * 100) / 100 : null;
};

/** The site's VAT rates, each once, the first the one a new product takes. */
export function normalizeRates(input: unknown): number[] {
  const out: number[] = [];
  for (const raw of Array.isArray(input) ? input : []) {
    const rate = rateOf(raw);
    if (rate !== null && !out.includes(rate) && out.length < MAX_RATES) out.push(rate);
  }
  return out.length ? out : [...DEFAULT_RATES];
}

const word = (value: unknown, max = 40): string => str(value, max).replace(/\s+/g, ' ').replace(/\//g, '-').trim();

function cleanOptions(input: unknown): ProductOption[] {
  const out: ProductOption[] = [];
  let combinations = 1;
  for (const raw of Array.isArray(input) ? input : []) {
    if (!isObject(raw) || out.length >= MAX_PRODUCT_OPTIONS) continue;
    const name = word(raw.name);
    const given = Array.isArray(raw.values) ? raw.values : typeof raw.values === 'string' ? raw.values.split(/[\n,]/) : [];
    const values: string[] = [];
    for (const v of given) {
      const value = word(v);
      if (value && !values.includes(value) && values.length < MAX_VALUES) values.push(value);
    }
    if (!name || !values.length || out.some((o) => o.name === name) || combinations * values.length > MAX_COMBINATIONS) continue;
    combinations *= values.length;
    out.push({ name, values });
  }
  return out;
}

/** Every combination of a product's options, in the order they are offered: `S / Red`, `S / Blue`, `M / Red`… None without options. */
export function combinations(options: ProductOption[]): string[] {
  if (!options.length) return [];
  let out: string[][] = [[]];
  for (const option of options) out = out.flatMap((before) => option.values.map((value) => [...before, value]));
  return out.map((values) => values.join(VARIANT_JOIN));
}

/**
 * Untrusted input as a product's shop data (ADR 0065 d2). A sale price that is not below the price
 * is no sale; a variant that changes nothing is not kept.
 */
export function normalizeProduct(input: unknown): Product {
  const raw = isObject(input) ? input : {};
  const price = moneyOf(raw.price);
  const sale = moneyOf(raw.sale);
  const vat = rateOf(raw.vat);
  const options = cleanOptions(raw.options);
  const keys = new Set(combinations(options));
  const variants: Record<string, ProductVariant> = {};
  for (const [key, given] of Object.entries(isObject(raw.variants) ? raw.variants : {})) {
    if (!keys.has(key) || !isObject(given)) continue;
    const own = { price: moneyOf(given.price), sale: moneyOf(given.sale), sku: str(given.sku, 60).trim() };
    const base = own.price ?? price;
    if (own.sale !== null && (base === null || own.sale >= base)) own.sale = null;
    if (own.price !== null || own.sale !== null || own.sku) variants[key] = own;
  }
  return {
    price,
    sale: sale !== null && price !== null && sale < price ? sale : null,
    sku: str(raw.sku, 60).trim(),
    vat,
    counted: raw.counted === true,
    options,
    variants,
  };
}

/** A product with nothing given yet: what a new entry of a type that sells starts with. */
export const emptyProduct = (): Product => normalizeProduct({});

/** The rate a product is taxed at: its own while the site still names it, otherwise the site's first. */
export const rateFor = (product: Product, rates: readonly number[]): number => (product.vat !== null && rates.includes(product.vat) ? product.vat : (rates[0] ?? 0));

/** Where the stock of a product, or of one combination of it, is kept: `products/mug`, `products/tee#M / Red`. */
export const stockKey = (type: string, slug: string, variant = ''): string => (variant ? `${type}/${slug}#${variant}` : `${type}/${slug}`);

/** What one combination costs, and is sold at: its own price, or the product's. */
export function priceOf(product: Product, variant = ''): { price: number | null; sale: number | null; sku: string } {
  const own = variant ? product.variants[variant] : undefined;
  if (!own) return { price: product.price, sale: product.sale, sku: product.sku };
  const price = own.price ?? product.price;
  // A variant with a price of its own has only its own sale; one without takes the product's.
  const sale = own.price !== null ? own.sale : (own.sale ?? product.sale);
  return { price, sale: sale !== null && price !== null && sale < price ? sale : null, sku: own.sku || product.sku };
}

/** What a visitor pays for one: the sale price when there is one. */
export const paid = (p: { price: number | null; sale: number | null }): number | null => p.sale ?? p.price;

/**
 * The shop's settings (ADR 0065 d5, d10). Only what the first pull request
 * needs; the cart's, the payments' and the shipping's come with theirs.
 */
export interface ShopSettings {
  /** The one switch of Settings → Shop. */
  on: boolean;
  /** The site charges VAT: the cart and the order show it. */
  vat: boolean;
  rates: number[];
}

export const SHOP_OFF: ShopSettings = { on: false, vat: true, rates: [...DEFAULT_RATES] };

export function normalizeShopSettings(input: unknown): ShopSettings {
  const raw = isObject(input) ? input : {};
  return { on: raw.on === true, vat: raw.vat !== false, rates: normalizeRates(raw.rates) };
}

/**
 * What a page is drawn with while the shop is on (ADR 0065 d3): the currency,
 * whether VAT is said, and what was left of each product counted when the
 * site was built. Filled in to draw, never kept.
 */
export interface ShopShown {
  currency: string;
  vat: boolean;
  /** By {@link stockKey}: only products whose stock is counted. Absent: none left. */
  stock: Record<string, number>;
}

/** Whether one combination of a product can be bought, as the site was built. */
export function inStock(shop: ShopShown, product: Product, key: string): boolean {
  return !product.counted || (shop.stock[key] ?? 0) > 0;
}
