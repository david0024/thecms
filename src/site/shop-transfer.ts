/**
 * The shop as parts of the content file (ADR 0057 d1, ADR 0065): `shop`, with
 * the whole site, holds its settings, what is left of each product and the
 * coupons; `orders`, chosen apart as the visitors are (ADR 0064 d6), holds the
 * orders with their buyers, never the secret of a buyer's link. Read and
 * written on the tables themselves, so the shop's own code is not loaded for
 * it (ADR 0060 d3).
 */
import { type Coupon, normalizeShopSettings, ORDER_STATES, type OrderState, type ShopSettings } from '../core/index.ts';
import type { OrderData } from './shop-pages.ts';
import { asCoupon, shopSchema, stockId } from './shop-schema.ts';
import { cleanEmail, type Store } from './store.ts';

/** The shop's part of a content file. */
export interface ContentShop {
  settings: ShopSettings;
  /** What is left of each product counted, by `type/slug` and combination ('' for the product itself). */
  stock: { product: string; variant: string; quantity: number }[];
  coupons: Coupon[];
}

/** An order as the content file holds it: its number, state and what was bought, without the buyer's secret link. */
export interface ContentOrder {
  number: number;
  state: OrderState;
  email: string;
  language: string;
  total: number;
  createdAt: string;
  updatedAt: string;
  data: OrderData;
}

type Row = Record<string, unknown>;

/** The shop's settings, stock and coupons; its settings alone when it was never turned on. */
export async function exportShop(store: Store): Promise<ContentShop> {
  const settings = normalizeShopSettings(await store.shopSettings());
  if (!(await store.hasTable('shop_stock'))) return { settings, stock: [], coupons: [] };
  const db = store.database();
  const stock = (await db.rows<Row>('SELECT product, variant, quantity FROM shop_stock ORDER BY product, variant')).map((r) => ({ product: String(r.product), variant: String(r.variant), quantity: Number(r.quantity) }));
  const coupons = (await db.rows<Row>('SELECT * FROM shop_coupons ORDER BY code')).map(asCoupon).filter((c): c is Coupon => c !== null);
  return { settings, stock, coupons };
}

/** Every order, the first first; none when the shop was never turned on. */
export async function exportOrders(store: Store): Promise<ContentOrder[]> {
  if (!(await store.hasTable('shop_orders'))) return [];
  const rows = await store.database().rows<Row>('SELECT number, state, email, language, total, data, created_at, updated_at FROM shop_orders ORDER BY number');
  return rows.map((r) => ({
    number: Number(r.number),
    state: String(r.state) as OrderState,
    email: String(r.email),
    language: String(r.language),
    total: Number(r.total),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    data: JSON.parse(String(r.data)) as OrderData,
  }));
}

/** What bringing the shop did, for the import's report. */
export interface ShopBrought {
  /** The old site's shop settings were taken. */
  settings: boolean;
  stock: number;
  coupons: number;
  /** Coupons whose code this shop has already: left as they were. */
  kept: string[];
  /** The shop is off here: no stock and no coupon was brought. */
  off: boolean;
}

/**
 * Brings the shop's part. Its settings only with the old site's settings
 * (`fresh`), and then the shop is on here when it was there; the stock and
 * the coupons only into a shop that is on, never in place of what it has.
 */
export async function importShop(store: Store, shop: ContentShop, fresh: boolean): Promise<ShopBrought> {
  const db = store.database();
  let settings = false;
  if (fresh) {
    const taken = normalizeShopSettings(shop.settings);
    // Its tables are made before the shop says it is on, as turning it on in the admin does.
    if (taken.on) await db.make(shopSchema(db.kind));
    await store.setShopSettings(taken);
    settings = true;
  }
  if (!normalizeShopSettings(await store.shopSettings()).on) return { settings, stock: 0, coupons: 0, kept: [], off: true };
  await db.make(shopSchema(db.kind));
  let stock = 0;
  for (const s of shop.stock) {
    const quantity = Number(s.quantity);
    if (typeof s.product !== 'string' || typeof s.variant !== 'string' || !/^[^/]+\/.+$/.test(s.product) || !Number.isInteger(quantity) || quantity < 0) continue;
    const id = stockId(s.product, s.variant);
    if ((await db.rows('SELECT id FROM shop_stock WHERE id = ?', [id])).length) continue;
    await db.run('INSERT INTO shop_stock (id, product, variant, quantity) VALUES (?, ?, ?, ?)', [id, s.product, s.variant, Math.min(quantity, 1_000_000_000)]);
    stock++;
  }
  let coupons = 0;
  const kept: string[] = [];
  for (const raw of shop.coupons) {
    const coupon = asCoupon(raw as unknown as Row);
    if (!coupon) continue;
    if ((await db.rows('SELECT code FROM shop_coupons WHERE code = ?', [coupon.code])).length) {
      kept.push(coupon.code);
      continue;
    }
    await db.run('INSERT INTO shop_coupons (code, kind, value, ends, uses, used, minimum, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
      coupon.code,
      coupon.kind,
      coupon.value,
      coupon.ends,
      coupon.uses,
      coupon.used,
      coupon.minimum,
      new Date().toISOString(),
    ]);
    coupons++;
  }
  // A product that comes in stock, or runs out, is said on its page once the site is built again.
  if (stock) await store.touch();
  return { settings, stock, coupons, kept, off: false };
}

/** What bringing the orders did, for the import's report. */
export interface OrdersBrought {
  added: number;
  /** The numbers this shop has already: those orders were left behind. */
  kept: number[];
  off: boolean;
}

const newSecret = (): string => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');

/**
 * Brings the orders into a shop that is on, each with its own number; an
 * order whose number this shop has already stays behind, and is named. Each
 * gets a new link for its buyer, and belongs to the visitor here with its
 * address, when there is one. No message is sent and no stock is taken: they
 * were placed elsewhere.
 */
export async function importOrders(store: Store, orders: ContentOrder[]): Promise<OrdersBrought> {
  if (!normalizeShopSettings(await store.shopSettings()).on) return { added: 0, kept: [], off: true };
  const db = store.database();
  await db.make(shopSchema(db.kind));
  const visitors = await store.hasTable('visitors');
  let added = 0;
  const kept: number[] = [];
  for (const order of orders) {
    const number = Number(order.number);
    const email = cleanEmail(String(order.email ?? ''));
    if (!Number.isSafeInteger(number) || number < 1 || !order.data || typeof order.data !== 'object') continue;
    if ((await db.rows('SELECT id FROM shop_orders WHERE number = ?', [number])).length) {
      kept.push(number);
      continue;
    }
    const visitor = visitors && email ? ((await db.rows<Row>('SELECT id FROM visitors WHERE email = ?', [email]))[0]?.id ?? '') : '';
    const day = (value: string): string => (Number.isNaN(Date.parse(value)) ? new Date().toISOString() : new Date(value).toISOString());
    await db.run('INSERT INTO shop_orders (id, number, secret, state, email, visitor_id, language, total, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
      crypto.randomUUID(),
      number,
      newSecret(),
      (ORDER_STATES as readonly string[]).includes(order.state) ? order.state : 'waiting',
      email,
      String(visitor),
      String(order.language ?? '').slice(0, 20),
      Number.isSafeInteger(Number(order.total)) ? Number(order.total) : 0,
      JSON.stringify(order.data),
      day(order.createdAt),
      day(order.updatedAt),
    ]);
    added++;
  }
  return { added, kept, off: false };
}
