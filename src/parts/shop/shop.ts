/**
 * The shop (ADR 0065): what is left of each product, the cart, checkout and
 * orders. Loaded only once the owner has turned it on (`shop-gate.ts`,
 * ADR 0060 d3).
 *
 * Stock is not content (ADR 0065 d2): it changes with each order, so it lives
 * in a table of its own, set from the entry's editor, and nothing is published
 * for it. The site is built again only when a product runs out or comes back,
 * for its page says whether it can be bought.
 *
 * A cart is a secret in a cookie of its own, its hash here (d4). An order
 * keeps its lines as they were bought (d7); placing it takes the stock, and
 * cancelling it gives the stock back.
 */
import { createHash } from 'node:crypto';
import {
  combinations,
  type Coupon,
  couponCode,
  couponOff,
  couponProblem,
  entryPath,
  isFinal,
  isObject,
  MAX_COUPONS,
  moneyText,
  NAME,
  normalizeCoupon,
  normalizeShopSettings,
  ORDER_STATES,
  type OrderState,
  paid,
  priceOf,
  rateFor,
  type ShippingMethod,
  shippingCost,
  type ShopSettings,
  type Site,
  stockKey,
  vatIn,
} from '../../core/index.ts';
import { wordsFor } from '../../blocks/words.ts';
import { openMailQueue } from '../../site/mail-queue.ts';
import { normalizeTemplates, type OrderValues, renderTemplate, type TemplateName } from '../../site/site-mail.ts';
import { byExtension, type CartLine, checkoutForm, dayOf, linesPart, type Order, type OrderData, orderPart, orderText, type PaymentChoice, type ShopProviders, stateName, type Totals, totalsPart, type Typed } from './pages.ts';
import { asCoupon, shopSchema, stockId } from './schema.ts';
import { escape, framed, type Notice } from '../../site/framed.ts';
import { cleanEmail, type Database, type OrderEvent, type Store, type User } from '../../site/store.ts';
import '../../site/languages.ts';

type Row = Record<string, unknown>;
/** A way to deliver an extension offers (ADR 0076 d4.1): `<extension>:<option>`, and `:<point>` for a place to pick it up. */
const EXTENSION_WAY = /^[a-z][a-z0-9-]{1,39}:[a-z0-9-]{1,40}(:[A-Za-z0-9._-]{1,40})?$/;
/** The most a stock may say: more than any shop counts. */
const STOCK_MAX = 1_000_000_000;
export const CART_COOKIE = `${NAME}_cart`;
/** How long a cart is kept since it was last changed (ADR 0065 d4). */
export const CART_DAYS = 30;
/** The most lines a cart holds, and the most of one line. */
const CART_LINES = 50;
const QUANTITY_MAX = 999;
const DAY = 86_400_000;

/** What the runtime gives the shop to draw its pages and know its buyer. */
export interface ShopDeps {
  /** The site's frame in a language, or null while nothing is published. */
  frame: (language: string) => Promise<string | null>;
  /** What every page of the site says to the browser. */
  headers: Record<string, string>;
  /** The visitor signed in on this request (ADR 0064), or null: nobody, or accounts are off. */
  visitor: (request: Request) => Promise<{ id: string; name: string; email: string } | null>;
  /** Whether visitor accounts are on: only then may the owner require one to buy. */
  accounts: () => Promise<boolean>;
  /** What the extensions offer at checkout (ADR 0076 d4.1): ways to pay and to deliver. Absent: none. */
  providers?: ShopProviders;
}

export interface Shop {
  /** What is left of everything counted, by {@link stockKey}. */
  stock: () => Promise<Record<string, number>>;
  admin: (request: Request, url: URL, me: User, body: Record<string, unknown>) => Promise<Response>;
  /** `/_/cart`, `/_/checkout` and `/_/order/<secret>`. */
  fetch: (request: Request, url: URL, deps: ShopDeps) => Promise<Response>;
  /** What the site's clock does for the shop: forget carts nobody came back to. */
  chores: (now: Date) => Promise<void>;
  /** A visitor's orders, for "My account" (ADR 0065 d4). */
  ordersOf: (visitorId: string, language: string) => Promise<string>;
  /** What an extension that uses `orders` is lent (ADR 0065 d9). */
  lent: OrdersLent;
}

/** An order as an extension that uses `orders` reads it (ADR 0065 d9): everything but the buyer's secret link. */
export interface LentOrder {
  id: string;
  number: number;
  state: OrderState;
  createdAt: string;
  language: string;
  email: string;
  buyer: OrderData['buyer'];
  lines: OrderData['lines'];
  shipping: OrderData['shipping'];
  payment: OrderData['payment'];
  totals: Totals;
  currency: string;
  tracking: string;
}

/**
 * What the shop lends an extension that declared `orders` (ADR 0065 d9): an
 * order read by its id, marked paid or refunded, given a tracking number.
 * Marking an order paid twice, as a provider's webhook may, changes nothing.
 */
export interface OrdersLent {
  get: (id: string) => Promise<LentOrder | null>;
  paid: (id: string) => Promise<LentOrder>;
  refunded: (id: string) => Promise<LentOrder>;
  tracking: (id: string, tracking: string) => Promise<LentOrder>;
}

const lentOrder = (o: Order): LentOrder => ({
  id: o.id,
  number: o.number,
  state: o.state,
  createdAt: o.createdAt,
  language: o.language,
  email: o.email,
  buyer: o.data.buyer,
  lines: o.data.lines,
  shipping: o.data.shipping,
  payment: o.data.payment,
  totals: o.data.totals,
  currency: o.data.currency,
  tracking: o.data.tracking,
});

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const plain = (words: string, status: number): Response => new Response(`${words}\n`, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });

const hashed = (value: string): string => createHash('sha256').update(value).digest('hex');
const newSecret = (): string => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');

/** A stock as typed: a whole number from 0, or null for "not given". */
const quantityOf = (value: unknown): number | null => {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value.trim()) : Number.NaN;
  return Number.isInteger(n) && n >= 0 ? Math.min(n, STOCK_MAX) : null;
};

/** A line of a cart as kept: only what names it. */
interface Kept {
  product: string;
  variant: string;
  quantity: number;
}
const keptLines = (raw: unknown): Kept[] => {
  const out: Kept[] = [];
  for (const line of Array.isArray(raw) ? raw : []) {
    if (!isObject(line) || out.length >= CART_LINES) continue;
    const quantity = quantityOf(line.quantity);
    if (typeof line.product === 'string' && typeof line.variant === 'string' && quantity) out.push({ product: line.product, variant: line.variant, quantity: Math.min(quantity, QUANTITY_MAX) });
  }
  return out;
};

const asOrder = (row: Row): Order => ({
  id: String(row.id),
  number: Number(row.number),
  secret: String(row.secret),
  state: (ORDER_STATES as readonly string[]).includes(String(row.state)) ? (String(row.state) as OrderState) : 'waiting',
  email: String(row.email),
  visitorId: String(row.visitor_id),
  language: String(row.language),
  total: Number(row.total),
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at),
  data: JSON.parse(String(row.data)) as OrderData,
});

/**
 * The sums of lines that can be bought, with a way to deliver them (ADR 0065
 * d5) and a coupon (d8). A coupon takes off the products, never delivery; what
 * it takes is shared between the VAT rates as the products are, and delivery
 * is free above its sum by what is paid for the products after it.
 */
export function totalsOf(lines: { price: number; quantity: number; rate: number }[], method: ShippingMethod | null, settings: ShopSettings, coupon: Pick<Coupon, 'code' | 'kind' | 'value'> | null = null): Totals {
  const subtotal = lines.reduce((sum, l) => sum + l.price * l.quantity, 0);
  const discount = coupon ? couponOff(coupon, subtotal) : 0;
  const shipping = method ? shippingCost(method, subtotal - discount) : 0;
  const vat: [number, number][] = [];
  if (settings.vat) {
    const gross = new Map<number, number>();
    for (const l of lines) gross.set(l.rate, (gross.get(l.rate) ?? 0) + l.price * l.quantity);
    if (discount) {
      // Each rate gives up its share of the discount; the last gives what rounding left over.
      const rates = [...gross.keys()];
      let left = discount;
      rates.forEach((rate, i) => {
        const share = i === rates.length - 1 ? left : Math.round((discount * (gross.get(rate) ?? 0)) / subtotal);
        left -= share;
        gross.set(rate, (gross.get(rate) ?? 0) - share);
      });
    }
    // Delivery is taxed at the site's first rate.
    const first = settings.rates[0] ?? 0;
    if (shipping) gross.set(first, (gross.get(first) ?? 0) + shipping);
    for (const rate of [...settings.rates, ...gross.keys()]) {
      const amount = vatIn(gross.get(rate) ?? 0, rate);
      if (amount && !vat.some(([r]) => r === rate)) vat.push([rate, amount]);
    }
  }
  return { subtotal, ...(coupon && discount ? { coupon: coupon.code, discount } : {}), shipping, total: subtotal - discount + shipping, vat };
}

export async function openShop(store: Store): Promise<Shop> {
  const db: Database = store.database();
  await db.make(shopSchema(db.kind));
  // Orders are told by e-mail through the site's queue (ADR 0065 d7); the runtime's clock sends it.
  const mails = await openMailQueue(store, {}, () => {});
  const one = async (query: string, params: unknown[]): Promise<Row | null> => (await db.rows<Row>(query, params))[0] ?? null;
  const settingsOf = async (): Promise<ShopSettings> => normalizeShopSettings(await store.shopSettings());

  /** What is left of one product: by its combination, '' for the product itself. */
  const left = async (product: string): Promise<Record<string, number>> =>
    Object.fromEntries((await db.rows<Row>('SELECT variant, quantity FROM shop_stock WHERE product = ?', [product])).map((r) => [String(r.variant), Number(r.quantity)]));

  /** A line of a cart as it can be bought now: from the product as it is published, in stock or not. */
  const resolve = async (site: Site, settings: ShopSettings, line: Kept): Promise<CartLine> => {
    const [typeId, ...rest] = line.product.split('/');
    const slug = rest.join('/');
    const gone: CartLine = { ...line, name: line.product, href: '', sku: '', price: null, rate: 0, left: null };
    const type = site.types.find((t) => t.id === typeId && t.sells);
    const entry = type && slug ? await store.publishedEntry(type.id, slug).catch(() => null) : null;
    const product = entry?.product;
    if (!type || !entry || !product) return gone;
    const sold = product.options.length ? combinations(product.options).includes(line.variant) : line.variant === '';
    const price = sold ? paid(priceOf(product, line.variant)) : null;
    const counted = product.counted ? ((await one('SELECT quantity FROM shop_stock WHERE id = ?', [stockId(line.product, line.variant)]))?.quantity ?? 0) : null;
    return { ...line, name: entry.title, href: entryPath(type, slug), sku: priceOf(product, line.variant).sku, price, rate: rateFor(product, settings.rates), left: counted === null ? null : Number(counted) };
  };

  // Carts.
  const cookieOf = (request: Request, name: string): string => {
    for (const part of (request.headers.get('cookie') ?? '').split(';')) {
      const [key, ...rest] = part.trim().split('=');
      if (key === name) return rest.join('=');
    }
    return '';
  };
  // A cart's items are its lines and the coupon typed (`{ lines, coupon }`); a cart kept before coupons is its lines alone.
  const cartOf = async (secret: string, now = new Date()): Promise<{ lines: Kept[]; shipping: string; coupon: string } | null> => {
    if (!secret || secret.length > 100) return null;
    const row = await one('SELECT items, shipping, updated_at FROM shop_carts WHERE id = ?', [hashed(secret)]);
    if (!row || String(row.updated_at) <= new Date(now.getTime() - CART_DAYS * DAY).toISOString()) return null;
    const items: unknown = JSON.parse(String(row.items));
    const kept = isObject(items) ? items : { lines: items };
    return { lines: keptLines(kept.lines), shipping: String(row.shipping), coupon: couponCode(kept.coupon) };
  };
  const keepCart = async (secret: string, lines: Kept[], shipping: string, coupon: string): Promise<void> => {
    await db.run(db.upsert('shop_carts', ['id', 'items', 'shipping', 'updated_at'], ['id'], ['items', 'shipping', 'updated_at']), [
      hashed(secret),
      JSON.stringify({ lines, coupon }),
      shipping,
      new Date().toISOString(),
    ]);
  };

  // Coupons (ADR 0065 d8).
  const couponOf = async (code: string): Promise<Coupon | null> => {
    if (!code) return null;
    const row = await one('SELECT * FROM shop_coupons WHERE code = ?', [code]);
    return row ? asCoupon(row) : null;
  };
  /**
   * Takes one use of a coupon for an order, only while it has one left and
   * has not ended: two buyers never both take its last use.
   */
  const takeCoupon = async (code: string): Promise<boolean> =>
    (await db.changed("UPDATE shop_coupons SET used = used + 1 WHERE code = ? AND (uses IS NULL OR used < uses) AND (ends = '' OR ends >= ?)", [code, new Date().toISOString().slice(0, 10)])) === 1;
  const giveCouponBack = async (code: string | undefined): Promise<void> => {
    if (code) await db.run('UPDATE shop_coupons SET used = used - 1 WHERE code = ? AND used > 0', [code]);
  };

  // Stock.
  /**
   * Takes what an order holds from the stock, all of it or nothing: each
   * product counted is taken only while enough is left, so two buyers never
   * take the last one both. The name of what ran short, or null.
   */
  const take = async (lines: CartLine[]): Promise<{ short: string | null; crossed: boolean }> => {
    const wanted = new Map<string, { quantity: number; name: string; product: string; variant: string }>();
    for (const l of lines) {
      if (l.left === null) continue;
      const id = stockId(l.product, l.variant);
      const was = wanted.get(id);
      wanted.set(id, { quantity: (was?.quantity ?? 0) + l.quantity, name: l.name, product: l.product, variant: l.variant });
    }
    const taken: [string, number][] = [];
    let crossed = false;
    for (const [id, want] of wanted) {
      if ((await db.changed('UPDATE shop_stock SET quantity = quantity - ? WHERE id = ? AND quantity >= ?', [want.quantity, id, want.quantity])) !== 1) {
        for (const [back, quantity] of taken) await db.run('UPDATE shop_stock SET quantity = quantity + ? WHERE id = ?', [quantity, back]);
        return { short: want.name, crossed: false };
      }
      taken.push([id, want.quantity]);
      if (Number((await one('SELECT quantity FROM shop_stock WHERE id = ?', [id]))?.quantity ?? 0) === 0) crossed = true;
    }
    return { short: null, crossed };
  };
  /** Gives back what a cancelled order took; a product that comes back is said on its page again. */
  const giveBack = async (order: Order): Promise<void> => {
    let crossed = false;
    for (const l of order.data.lines) {
      const id = stockId(l.product, l.variant);
      const row = await one('SELECT quantity FROM shop_stock WHERE id = ?', [id]);
      // Only what is still counted: a product whose stock the owner stopped counting has nothing to give back to.
      if (!row) continue;
      await db.run('UPDATE shop_stock SET quantity = quantity + ? WHERE id = ?', [l.quantity, id]);
      if (Number(row.quantity) === 0) crossed = true;
    }
    if (crossed) await store.touch();
  };

  // Orders.
  const orderBy = async (column: 'id' | 'secret', value: string): Promise<Order | null> => {
    if (!value || value.length > 100) return null;
    const row = await one(`SELECT * FROM shop_orders WHERE ${column} = ?`, [value]);
    return row ? asOrder(row) : null;
  };
  /** Where an order's link leads: the site's own address, or the one asked. */
  const baseOf = (site: Site, url: URL | null): string => {
    try {
      const own = new URL(site.url);
      if (own.protocol === 'https:' || own.protocol === 'http:') return own.origin;
    } catch {
      // No address set: the one asked.
    }
    return url?.origin ?? '';
  };
  const orderLink = (site: Site, url: URL | null, order: Order): string => `${baseOf(site, url)}/_/order/${order.secret}${order.language === site.language ? '' : `?l=${encodeURIComponent(order.language)}`}`;
  /** A message about an order, in the owner's words where they gave them, in the order's language. */
  const tell = async (to: string, what: TemplateName, order: Order, link: string): Promise<void> => {
    if (!to) return;
    const site = await store.site();
    const money = (n: number): string => moneyText(n, order.data.currency, order.language);
    const values: { name: string; link: string; site: string } & OrderValues = {
      name: order.data.buyer.name,
      link,
      site: site.name,
      number: String(order.number),
      total: money(order.data.totals.total),
      order: orderText(order),
      tracking: order.data.tracking,
    };
    const message = renderTemplate(normalizeTemplates(await store.mailTemplates()), what, order.language, values);
    await mails.queue(to, `order-${what.slice(5).toLowerCase()}`, message);
  };
  /** Where each new order is told: the address the owner gave, or the owner's own. */
  const ownerAddress = async (settings: ShopSettings): Promise<string> => settings.notify || ((await store.users()).find((u) => u.role === 'owner' && u.active)?.email ?? '');

  /**
   * Places an order: its number follows the last. Two orders placed at once
   * cannot both take one number, which the database keeps unique; the second
   * takes the next.
   */
  const place = async (data: OrderData, email: string, visitorId: string, language: string, state: OrderState): Promise<Order> => {
    for (let attempt = 0; ; attempt++) {
      const last = Number((await one('SELECT MAX(number) AS n FROM shop_orders', []))?.n ?? 0);
      const now = new Date().toISOString();
      const order: Order = { id: crypto.randomUUID(), number: last + 1, secret: newSecret(), state, email, visitorId, language, total: data.totals.total, createdAt: now, updatedAt: now, data };
      try {
        await db.run('INSERT INTO shop_orders (id, number, secret, state, email, visitor_id, language, total, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
          order.id,
          order.number,
          order.secret,
          order.state,
          email,
          visitorId,
          language,
          order.total,
          JSON.stringify(data),
          now,
          now,
        ]);
        return order;
      } catch (error) {
        if (attempt >= 5) throw error;
      }
    }
  };

  /** The language a page is drawn in: the one asked for when the site has it, otherwise the site's. */
  const languageOf = (site: Site, asked: string): string => ([site.language, ...site.languages].includes(asked) ? asked : site.language);

  async function fetch(request: Request, url: URL, deps: ShopDeps): Promise<Response> {
    const route = url.pathname.replace(/\/+$/, '');
    const site = await store.site();
    const settings = await settingsOf();
    const post = request.method === 'POST';
    let fields = new URLSearchParams();
    if (post) {
      // A form of another site cannot send here (the cookie is SameSite=Lax), and a browser that says where a form came from is believed.
      const origin = request.headers.get('origin');
      if (request.headers.get('sec-fetch-site') === 'cross-site' || (origin && origin !== 'null' && new URL(origin).host !== url.host)) return plain('a form of another site', 403);
      if (Number(request.headers.get('content-length') ?? 0) > 16_384) return plain('too large', 413);
      fields = new URLSearchParams((await request.text()).slice(0, 16_384));
    } else if (request.method !== 'GET' && request.method !== 'HEAD') return plain('not found', 404);
    const field = (name: string, max = 200): string => (fields.get(name) ?? '').slice(0, max).replace(/[\u0000-\u001F\u007F]/g, ' ').trim();
    const language = languageOf(site, url.searchParams.get('l') ?? field('language', 20) ?? '');
    const query = language === site.language ? '' : `?l=${encodeURIComponent(language)}`;
    const said = wordsFor(language);
    const frame = await deps.frame(language);
    if (frame === null) return plain('nothing is published yet', 404);
    const currency = site.business?.currency || 'RON';
    const money = (n: number): string => moneyText(n, currency, language);
    const secure = url.protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https';
    const cookie = (secret: string, seconds: number): string => `${CART_COOKIE}=${secret}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${secure ? '; Secure' : ''}`;
    const draw = (title: string, inside: string, notice?: Notice, status = 200, headers: Record<string, string> = {}): Response =>
      new Response(framed(frame, title, inside, notice, 'shop'), {
        status,
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'private, no-store', ...deps.headers, ...headers },
      });
    /** Where a form leads: a page of the shop, with what was done said there. */
    const to = (path: string, saidKey = '', headers: Record<string, string> = {}): Response => {
      const params = new URLSearchParams();
      if (language !== site.language) params.set('l', language);
      if (saidKey) params.set('said', saidKey);
      const search = params.toString();
      return new Response(null, { status: 303, headers: { location: `${path}${search ? `?${search}` : ''}`, 'cache-control': 'no-store', ...headers } });
    };
    const secret = cookieOf(request, CART_COOKIE);
    const cart = await cartOf(secret);
    /** The ways to deliver: the shop's own, then what the extensions offer for these lines (ADR 0076 d4.1), asked once a request. */
    let offered: ShippingMethod[] = [];
    const methodOf = (id: string): ShippingMethod | null => settings.shipping.find((m) => m.id === id) ?? offered.find((m) => m.id === id) ?? null;
    const ask = async (lines: (CartLine & { price: number })[], address: { street: string; town: string; county: string; postcode: string } | null): Promise<ShippingMethod[]> => {
      if (!deps.providers || !lines.length) return (offered = []);
      const subtotal = lines.reduce((sum, l) => sum + l.price * l.quantity, 0);
      offered = await deps.providers
        .deliveries({ lines: lines.map((l) => ({ product: l.product, variant: l.variant, name: l.name, sku: l.sku, price: l.price, quantity: l.quantity })), subtotal, currency, address }, language)
        .catch(() => []);
      return offered;
    };
    /** Which way to deliver a cart is on: the one kept, or the only one there is. */
    const methodsAll = (): ShippingMethod[] => [...settings.shipping, ...offered];

    const bought = (lines: CartLine[]) => lines.filter((l): l is CartLine & { price: number } => l.price !== null);
    /**
     * The cart's lines as they can be bought now, each lowered to what is
     * left, and its coupon when it is taken from them. Saved when something
     * changed: a coupon that ended or was used up is taken off; one under its
     * smallest order stays, and is said.
     */
    const current = async (): Promise<{ lines: CartLine[]; notices: string[]; coupon: Coupon | null }> => {
      if (!cart) return { lines: [], notices: [], coupon: null };
      const lines: CartLine[] = [];
      const notices: string[] = [];
      let changed = false;
      for (const kept of cart.lines) {
        const line = await resolve(site, settings, kept);
        if (line.left !== null && line.quantity > line.left && line.price !== null) {
          changed = true;
          if (line.left === 0) {
            notices.push(`${line.name}: ${said.shopOutOfStock}`);
            continue;
          }
          notices.push(`${line.name}: ${said.cartFewer.replace('{count}', String(line.left))}`);
          line.quantity = line.left;
        }
        lines.push(line);
      }
      let coupon: Coupon | null = null;
      let code = cart.coupon;
      if (code) {
        const subtotal = bought(lines).reduce((sum, l) => sum + l.price * l.quantity, 0);
        const kept = await couponOf(code);
        const problem = kept ? couponProblem(kept, subtotal) : 'ended';
        if (problem === 'minimum') notices.push(said.cartCouponMinimum.replace('{code}', code).replace('{sum}', money(kept?.minimum ?? 0)));
        else if (problem) {
          notices.push(said.cartCouponGone.replace('{code}', code));
          code = '';
          changed = true;
        } else coupon = kept;
      }
      if (changed) await keepCart(secret, lines.map(({ product, variant, quantity }) => ({ product, variant, quantity })), cart.shipping, code);
      return { lines, notices, coupon };
    };
    /** The coupon's own form, under the cart's lines (ADR 0065 d8): a code to apply, or the one applied to take off. */
    const couponForm = (code: string): string =>
      `<form class="form cart-coupon" method="post" action="/_/cart${query}" accept-charset="utf-8">` +
      (code
        ? `<p>${escape(said.cartCouponOff.replace('{code}', code))} <button class="button button-quiet" type="submit" name="coupon" value="" data-cart-uncoupon>${escape(said.cartCouponRemove)}</button></p>`
        : `<p class="form-field"><label for="cart-coupon">${escape(said.cartCoupon)}</label><input id="cart-coupon" name="coupon" maxlength="40" autocomplete="off" autocapitalize="characters"> <button class="button button-quiet" type="submit" data-cart-coupon>${escape(said.cartCouponApply)}</button></p>`) +
      `</form>`;

    switch (route) {
      case '/_/cart': {
        if (post) {
          const lines = [...(cart?.lines ?? [])];
          let shipping = cart?.shipping ?? '';
          let coupon = cart?.coupon ?? '';
          let notice = 'updated';
          const product = field('product', 300);
          if (product) {
            // From a product's Buy part (ADR 0065 d3).
            const variant = field('variant', 300);
            const quantity = Math.min(quantityOf(field('quantity', 6)) || 1, QUANTITY_MAX);
            const line = await resolve(site, settings, { product, variant, quantity });
            const there = lines.find((l) => l.product === product && l.variant === variant);
            const wanted = Math.min((there?.quantity ?? 0) + quantity, QUANTITY_MAX, line.left ?? QUANTITY_MAX);
            if (line.price === null || wanted < 1 || (!there && lines.length >= CART_LINES)) notice = 'notadded';
            else {
              if (there) there.quantity = wanted;
              else lines.push({ product, variant, quantity: wanted });
              notice = 'added';
            }
          } else if (fields.has('coupon')) {
            // The coupon's own form (ADR 0065 d8): a code typed, or none to take it off.
            const typed = couponCode(field('coupon', 80));
            const kept = await couponOf(typed);
            const problem = kept ? couponProblem(kept, 0) : null;
            if (!field('coupon', 80)) {
              coupon = '';
              notice = 'updated';
            } else if (!kept || problem === 'ended') notice = 'couponbad';
            else if (problem === 'used') notice = 'couponused';
            else {
              // One under its smallest order is kept, and said in the cart until the order reaches it.
              coupon = kept.code;
              notice = 'coupon';
            }
          } else {
            const removed = fields.get('remove');
            for (let i = lines.length - 1; i >= 0; i--) {
              const typed = fields.get(`q${i}`);
              const quantity = typed === null ? (lines[i] as Kept).quantity : (quantityOf(typed) ?? (lines[i] as Kept).quantity);
              if (removed === String(i) || quantity === 0) lines.splice(i, 1);
              else (lines[i] as Kept).quantity = Math.min(quantity, QUANTITY_MAX);
            }
            // An extension's way (ADR 0076 d4.1) is checked when it is used: what it offers may change with the address.
            if (fields.has('shipping') && (methodOf(field('shipping', 120)) || field('shipping') === '' || EXTENSION_WAY.test(field('shipping', 120)))) shipping = field('shipping', 120);
          }
          if ((notice === 'notadded' || notice === 'couponbad' || notice === 'couponused') && !cart) return to('/_/cart', notice);
          const own = cart ? secret : newSecret();
          await keepCart(own, lines, shipping, coupon);
          return to('/_/cart', notice, cart ? {} : { 'set-cookie': cookie(own, CART_DAYS * 86_400) });
        }
        const { lines, notices, coupon } = await current();
        const NOTICES: Record<string, Notice> = {
          added: { text: said.cartAdded },
          updated: { text: said.cartUpdated },
          notadded: { text: said.cartNotAdded, failed: true },
          changed: { text: said.checkoutChanged, failed: true },
          coupon: { text: said.cartCouponAdded },
          couponbad: { text: said.cartCouponBad, failed: true },
          couponused: { text: said.cartCouponUsed, failed: true },
        };
        const notice: Notice | undefined = notices.length ? { text: notices.join(' '), failed: true } : NOTICES[url.searchParams.get('said') ?? ''];
        if (!lines.length) return draw(said.cart, `<p class="lead" data-cart-empty>${escape(said.cartEmpty)}</p><p><a href="/">${escape(said.cartBack)}</a></p>`, notice);
        await ask(bought(lines), null);
        const all = methodsAll();
        const method = methodOf(cart?.shipping ?? '') ?? (all.length === 1 ? (all[0] as ShippingMethod) : null);
        const totals = totalsOf(bought(lines), method, settings, coupon);
        const rows = lines
          .map(
            (l, i) =>
              `<tr${l.price === null ? ' class="cart-gone"' : ''}><td>${l.href ? `<a href="${escape(l.href)}">${escape(l.name)}</a>` : escape(l.name)}${l.variant ? `<br><small>${escape(l.variant)}</small>` : ''}${l.price === null ? `<br><small>${escape(said.cartGone)}</small>` : ''}</td>` +
              `<td>${l.price === null ? '' : escape(money(l.price))}</td>` +
              `<td><input type="number" name="q${i}" value="${l.quantity}" min="0" max="${Math.min(QUANTITY_MAX, l.left ?? QUANTITY_MAX)}" inputmode="numeric" aria-label="${escape(`${said.shopQuantity}: ${l.name}`)}"></td>` +
              `<td>${l.price === null ? '' : escape(money(l.price * l.quantity))}</td>` +
              `<td><button type="submit" form="cart-remove" name="remove" value="${i}" class="cart-remove">${escape(said.cartRemove)}</button></td></tr>`,
          )
          .join('');
        const choose = all.length
          ? `<p class="form-field"><label for="cart-shipping">${escape(said.cartShipping)}</label><select id="cart-shipping" name="shipping"><option value="">${escape(said.shopChoose)}…</option>${all
              .map((m) => `<option value="${escape(m.id)}"${method?.id === m.id ? ' selected' : ''}>${escape(m.name)}: ${escape(shippingCost(m, totals.subtotal) ? money(shippingCost(m, totals.subtotal)) : said.cartShippingFree)}</option>`)
              .join('')}</select></p>`
          : '';
        return draw(
          said.cart,
          `<form id="cart-remove" method="post" action="/_/cart${query}"></form>` +
            `<form class="form cart" method="post" action="/_/cart${query}" accept-charset="utf-8"><table class="cart-lines"><thead><tr><th scope="col">${escape(said.cartProduct)}</th><th scope="col">${escape(said.cartPrice)}</th><th scope="col">${escape(said.shopQuantity)}</th><th scope="col">${escape(said.cartLineTotal)}</th><th></th></tr></thead><tbody>${rows}</tbody></table>` +
            `${choose}<p><button class="button button-quiet" type="submit">${escape(said.cartUpdate)}</button></p></form>` +
            couponForm(cart?.coupon ?? '') +
            totalsPart(said, totals, money, method ? method.name : null, settings.vat) +
            (bought(lines).length ? `<p><a class="button" href="/_/checkout${query}" data-cart-checkout>${escape(said.cartToCheckout)}</a></p>` : ''),
          notice,
        );
      }
      case '/_/checkout': {
        const { lines, coupon } = await current();
        const buying = bought(lines);
        if (!buying.length) return to('/_/cart');
        // The shop's own ways to pay, then those the extensions offer (ADR 0076 d4.1).
        const payments: PaymentChoice[] = [
          ...(settings.transfer.on ? [{ id: 'transfer', label: said.checkoutTransfer, hint: said.checkoutTransferHint }] : []),
          ...(settings.cod ? [{ id: 'cod', label: said.checkoutCod, hint: '' }] : []),
          ...(deps.providers ? await deps.providers.payments(language).catch(() => []) : []),
        ];
        const address = post && fields.get('street') ? { street: field('street'), town: field('town'), county: field('county'), postcode: field('postcode') } : null;
        await ask(buying, address);
        if (!payments.length || !methodsAll().length) return draw(said.checkout, `<p class="lead" data-checkout-closed>${escape(said.checkoutClosed)}</p>`, undefined, 503);
        const me = await deps.visitor(request);
        if (settings.account && !me && (await deps.accounts())) {
          const back = `/_/checkout${query}`;
          return draw(said.checkout, `<p class="lead" data-checkout-sign-in>${escape(said.checkoutSignIn)}</p><p><a class="button" href="/_/account?back=${encodeURIComponent(back)}${language === site.language ? '' : `&amp;l=${encodeURIComponent(language)}`}">${escape(said.accountSignIn)}</a></p>`, undefined, 403);
        }
        const typed: Typed = post
          ? Object.fromEntries(['name', 'email', 'phone', 'street', 'town', 'county', 'postcode', 'company', 'companyName', 'taxCode', 'registration', 'shipping', 'payment', 'note'].map((k) => [k, field(k, k === 'note' ? 1000 : 200)]))
          : { name: me?.name ?? '', email: me?.email ?? '', shipping: methodOf(cart?.shipping ?? '')?.id ?? (methodsAll().length === 1 ? (methodsAll()[0]?.id ?? '') : ''), payment: payments.length === 1 ? (payments[0]?.id ?? '') : '' };
        const method = methodOf(typed.shipping ?? '');
        const totals = totalsOf(buying, method, settings, coupon);
        const page = (notice?: Notice, bad = new Set<string>(), status = 200): Response =>
          draw(
            said.checkout,
            linesPart(said, buying.map((l) => ({ ...l, href: l.href })), money) +
              totalsPart(said, totals, money, method ? method.name : null, settings.vat) +
              checkoutForm(said, settings, { action: `/_/checkout${query}`, typed, bad, methods: methodsAll(), money, subtotal: totals.subtotal, total: totals.total, payments }),
            notice,
            status,
          );
        if (!post) return page();
        // What is wrong, field by field.
        const bad = new Set<string>();
        const email = cleanEmail(typed.email ?? '');
        if (!typed.name) bad.add('name');
        if (!email) bad.add('email');
        if (!/^\+?[\d\s().-]{6,30}$/.test(typed.phone ?? '')) bad.add('phone');
        if (!method) bad.add('shipping');
        const paying = payments.find((p) => p.id === typed.payment);
        if (!paying) bad.add('payment');
        if (method && !method.pickup) for (const k of ['street', 'town', 'county']) if (!typed[k]) bad.add(k);
        const company = typed.company === 'yes';
        if (company) for (const k of ['companyName', 'taxCode']) if (!typed[k]) bad.add(k);
        if (fields.get('terms') !== 'yes') bad.add('terms');
        if (bad.size) return page({ text: said.checkoutInvalid, failed: true }, bad, 400);
        // The buyer agrees to what they saw: a price or a delivery that changed since is shown again first.
        if (field('total', 20) !== String(totals.total) || lines.some((l) => l.price === null)) {
          if (lines.some((l) => l.price === null)) return to('/_/cart', 'changed');
          return page({ text: said.checkoutChanged, failed: true }, new Set(), 409);
        }
        // The coupon's use first: one used up meanwhile sends the buyer back to the cart, which says so.
        if (totals.coupon && !(await takeCoupon(totals.coupon))) return to('/_/cart', 'changed');
        const taken = await take(buying);
        if (taken.short !== null) {
          await giveCouponBack(totals.coupon);
          return page({ text: said.checkoutNoStock.replace('{name}', taken.short), failed: true }, new Set(), 409);
        }
        const chosen = method as ShippingMethod;
        const data: OrderData = {
          buyer: {
            name: typed.name as string,
            email,
            phone: typed.phone as string,
            street: chosen.pickup ? '' : (typed.street ?? ''),
            town: chosen.pickup ? '' : (typed.town ?? ''),
            county: chosen.pickup ? '' : (typed.county ?? ''),
            postcode: chosen.pickup ? '' : (typed.postcode ?? ''),
            company: company ? { name: typed.companyName ?? '', taxCode: typed.taxCode ?? '', registration: typed.registration ?? '' } : null,
          },
          lines: buying.map((l) => ({ product: l.product, variant: l.variant, name: l.name, sku: l.sku, price: l.price, quantity: l.quantity, rate: settings.vat ? l.rate : 0 })),
          shipping: { id: chosen.id, name: chosen.name, price: totals.shipping, pickup: chosen.pickup },
          payment: (paying as PaymentChoice).id,
          ...(byExtension((paying as PaymentChoice).id) ? { paymentName: (paying as PaymentChoice).label } : {}),
          transfer: typed.payment === 'transfer' ? { holder: settings.transfer.holder, iban: settings.transfer.iban, bank: settings.transfer.bank } : null,
          totals,
          vat: settings.vat,
          currency,
          note: typed.note ?? '',
          tracking: '',
          history: [],
        };
        // Paid by transfer or with an extension's way, it waits for the money; paid on delivery, it is prepared at once.
        const state: OrderState = data.payment === 'cod' ? 'preparing' : 'waiting';
        data.history.push({ state, at: new Date().toISOString() });
        const order = await place(data, email, me?.id ?? '', language, state);
        told('order.made', order);
        await db.run('DELETE FROM shop_carts WHERE id = ?', [hashed(secret)]);
        if (taken.crossed) await store.touch();
        const link = orderLink(site, url, order);
        await tell(email, 'orderReceived', order, link);
        await tell(await ownerAddress(settings), 'orderNew', order, link);
        // Paid with an extension's way (ADR 0076 d4.1): the buyer is sent to pay at once, or back to the order to try again.
        if (byExtension(order.data.payment)) return payWith(order, link, deps.providers, { 'set-cookie': cookie('', 0) });
        return to(`/_/order/${order.secret}`, 'placed', { 'set-cookie': cookie('', 0) });
      }
      default: {
        const [, asked, rest = ''] = /^\/_\/order\/([A-Za-z0-9_-]{20,100})(\/pay|\/file\/[A-Za-z0-9]{1,40})?$/.exec(route) ?? [];
        const order = asked && (!post || rest === '/pay') ? await orderBy('secret', asked) : null;
        if (!order || (post && rest !== '/pay') || (!post && rest === '/pay')) return draw(said.orderGone, `<p><a href="/">${escape(said.cartBack)}</a></p>`, undefined, 404);
        // Paying again, for an order that still waits for it.
        if (rest === '/pay') return order.state === 'waiting' && byExtension(order.data.payment) ? payWith(order, orderLink(site, url, order), deps.providers) : to(`/_/order/${order.secret}`);
        const files = (await store.orderFiles(order.id)).filter((f) => f.buyer);
        if (rest.startsWith('/file/')) {
          // A file an extension put on the order for its buyer (ADR 0076 d4.4); only for this order.
          const one = files.find((f) => f.id === rest.slice(6));
          const file = one ? await store.extensionFile(one.id) : null;
          if (!file) return draw(said.orderGone, `<p><a href="/">${escape(said.cartBack)}</a></p>`, undefined, 404);
          return new Response(file.bytes as Uint8Array<ArrayBuffer>, {
            headers: {
              'content-type': file.type,
              'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
              'cache-control': 'private, no-store',
              'x-content-type-options': 'nosniff',
              'referrer-policy': 'no-referrer',
            },
          });
        }
        const shown = (n: number): string => moneyText(n, order.data.currency, language);
        const notices: Record<string, Notice> = { placed: { text: said.orderPlaced }, paying: { text: said.orderPaying }, payfailed: { text: said.orderPayFailed, failed: true } };
        const path = `/_/order/${order.secret}`;
        return draw(
          said.order.replace('{number}', String(order.number)),
          orderPart(said, order, shown, { action: `${path}/pay${query}`, files: files.map((f) => ({ id: f.id, name: f.name })), path }),
          notices[url.searchParams.get('said') ?? ''],
          200,
          { 'referrer-policy': 'no-referrer' },
        );
      }
    }
  }

  /**
   * Sends the buyer to pay with an extension's way (ADR 0076 d4.1): where the
   * extension answers, or back to the order, which says the payment did not
   * start and offers it again. The order waits either way.
   */
  async function payWith(order: Order, link: string, providers: ShopProviders | undefined, headers: Record<string, string> = {}): Promise<Response> {
    const back = (said: string): Response => {
      const at = new URL(link);
      at.searchParams.set('said', said);
      return new Response(null, { status: 303, headers: { location: `${at.pathname}${at.search}`, 'cache-control': 'no-store', ...headers } });
    };
    const using = providers;
    if (!using) return back('payfailed');
    try {
      const { data } = order;
      const at = await using.pay(data.payment, {
        order: { id: order.id, number: order.number, total: order.total, currency: data.currency, language: order.language, email: order.email, buyer: data.buyer, lines: data.lines, shipping: data.shipping, totals: data.totals },
        back: (() => {
          const u = new URL(link);
          u.searchParams.set('said', 'paying');
          return u.href;
        })(),
      });
      return new Response(null, { status: 303, headers: { location: at, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', ...headers } });
    } catch {
      return back('payfailed');
    }
  }

  /** The orders of a visitor signed in, for "My account": each by its link, with its day, total and state. */
  async function ordersOf(visitorId: string, language: string): Promise<string> {
    const said = wordsFor(language);
    const orders = (await db.rows<Row>('SELECT * FROM shop_orders WHERE visitor_id = ? ORDER BY number DESC LIMIT 100', [visitorId])).map(asOrder);
    const list = orders.length
      ? `<ul data-my-orders>${orders
          .map(
            (o) =>
              `<li><a href="/_/order/${o.secret}">${escape(said.order.replace('{number}', String(o.number)))}</a> · ${escape(dayOf(o.createdAt, language))} · ${escape(moneyText(o.total, o.data.currency, language))} · ${escape(stateName(said, o.state))}</li>`,
          )
          .join('')}</ul>`
      : `<p data-my-orders>${escape(said.myOrdersNone)}</p>`;
    return `<h2>${escape(said.myOrders)}</h2>${list}`;
  }

  /** Tells extensions what happened to an order (ADR 0065 d9): its id, number and total, never who bought it. */
  const told = (event: OrderEvent, order: Order): void => store.tell(event, { id: order.id, number: order.number, total: order.total, currency: order.data.currency });

  /**
   * Moves an order to a state, or sets its tracking number: from the Orders
   * screen, or by an extension that uses `orders`. Cancelling gives back the
   * stock and the coupon's use; the buyer is told when it is paid, sent or
   * cancelled, and extensions when it is paid, sent or refunded.
   */
  async function change(order: Order, asked: { state?: unknown; tracking?: unknown }, url: URL | null): Promise<{ order: Order } | { error: string; status: number }> {
    const wanted = String(asked.state ?? order.state);
    if (!(ORDER_STATES as readonly string[]).includes(wanted)) return { error: 'that is not a state an order has', status: 400 };
    const state = wanted as OrderState;
    const tracking = typeof asked.tracking === 'string' ? asked.tracking.replace(/\s+/g, ' ').trim().slice(0, 100) : order.data.tracking;
    if (state !== order.state && isFinal(order.state)) return { error: 'a cancelled or refunded order stays so', status: 409 };
    const data: OrderData = { ...order.data, tracking, history: state === order.state ? order.data.history : [...order.data.history, { state, at: new Date().toISOString() }] };
    const at = new Date().toISOString();
    // Changed only from the state it was read in: two people handling one order do not both send its message.
    if ((await db.changed('UPDATE shop_orders SET state = ?, data = ?, updated_at = ? WHERE id = ? AND state = ?', [state, JSON.stringify(data), at, order.id, order.state])) !== 1) {
      return { error: 'someone else changed this order: open it again', status: 409 };
    }
    const next: Order = { ...order, state, data, updatedAt: at };
    if (state !== order.state) {
      if (state === 'cancelled') {
        await giveBack(order);
        await giveCouponBack(order.data.totals.coupon);
      }
      const site = await store.site();
      const message: Partial<Record<OrderState, TemplateName>> = { paid: 'orderPaid', sent: 'orderSent', cancelled: 'orderCancelled' };
      const what = message[state];
      if (what) await tell(order.email, what, next, orderLink(site, url, next));
      const event: Partial<Record<OrderState, OrderEvent>> = { paid: 'order.paid', sent: 'order.sent', refunded: 'order.refunded' };
      const heard = event[state];
      if (heard) told(heard, next);
    }
    return { order: next };
  }

  /** An order as the admin lists it. */
  const listed = (o: Order) => ({ id: o.id, number: o.number, state: o.state, createdAt: o.createdAt, name: o.data.buyer.name, email: o.email, total: o.total, currency: o.data.currency, items: o.data.lines.reduce((n, l) => n + l.quantity, 0) });

  /** One CSV cell: quoted when it must be, and never read as a formula by a spreadsheet. */
  const cell = (value: string | number): string => {
    let text = String(value);
    if (/^[=+\-@\t\r]/.test(text) && typeof value === 'string') text = `'${text}`;
    return /[",\n\r;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  async function admin(request: Request, url: URL, me: User, body: Record<string, unknown>): Promise<Response> {
    if (url.pathname === '/api/shop/orders' || url.pathname === '/api/shop/orders.csv') {
      const settings = await settingsOf();
      // The owner's, and the editors' when the owner allows it (ADR 0065 d7).
      if (!(me.role === 'owner' || (me.role === 'editor' && settings.editors))) return json({ error: 'only the owner handles orders' }, 403);
      if (url.pathname === '/api/shop/orders.csv') {
        if (request.method !== 'GET') return json({ error: 'not found' }, 404);
        const orders = (await db.rows<Row>('SELECT * FROM shop_orders ORDER BY number')).map(asOrder);
        const head = ['number', 'date', 'state', 'name', 'email', 'phone', 'address', 'company', 'tax code', 'products', 'subtotal', 'coupon', 'discount', 'delivery', 'total', 'currency', 'payment', 'tracking'];
        const rows = orders.map((o) => {
          const b = o.data.buyer;
          return [
            o.number,
            o.createdAt,
            o.state,
            b.name,
            o.email,
            b.phone,
            o.data.shipping.pickup ? o.data.shipping.name : [b.street, b.postcode, b.town, b.county].filter(Boolean).join(', '),
            b.company?.name ?? '',
            b.company?.taxCode ?? '',
            o.data.lines.map((l) => `${l.quantity} × ${l.name}${l.variant ? ` (${l.variant})` : ''}`).join('; '),
            (o.data.totals.subtotal / 100).toFixed(2),
            o.data.totals.coupon ?? '',
            ((o.data.totals.discount ?? 0) / 100).toFixed(2),
            (o.data.totals.shipping / 100).toFixed(2),
            (o.data.totals.total / 100).toFixed(2),
            o.data.currency,
            o.data.payment,
            o.data.tracking,
          ]
            .map(cell)
            .join(',');
        });
        return new Response(`﻿${[head.join(','), ...rows].join('\r\n')}\r\n`, {
          headers: { 'content-type': 'text/csv; charset=utf-8', 'cache-control': 'no-store', 'content-disposition': 'attachment; filename="orders.csv"' },
        });
      }
      const id = url.searchParams.get('id') ?? String(body.id ?? '');
      if (request.method === 'GET' && !id) {
        const state = url.searchParams.get('state') ?? '';
        const rows = (ORDER_STATES as readonly string[]).includes(state)
          ? await db.rows<Row>('SELECT * FROM shop_orders WHERE state = ? ORDER BY number DESC', [state])
          : await db.rows<Row>('SELECT * FROM shop_orders ORDER BY number DESC');
        return json({ orders: rows.map(asOrder).map(listed) });
      }
      const order = await orderBy('id', id);
      if (!order) return json({ error: 'there is no such order' }, 404);
      if (request.method === 'PUT') {
        const changed = await change(order, body, url);
        return 'error' in changed ? json({ error: changed.error }, changed.status) : json(changed);
      }
      if (request.method !== 'GET') return json({ error: 'not found' }, 404);
      return json({ order });
    }
    if (url.pathname === '/api/shop/coupons') {
      const settings = await settingsOf();
      // Whoever handles the orders handles the coupons.
      if (!(me.role === 'owner' || (me.role === 'editor' && settings.editors))) return json({ error: 'only the owner handles coupons' }, 403);
      return couponsApi(request, url, body);
    }
    if (url.pathname !== '/api/shop/stock') return json({ error: 'not found' }, 404);
    return stockApi(request, url, body);
  }

  const coupons = async (): Promise<Coupon[]> => (await db.rows<Row>('SELECT * FROM shop_coupons ORDER BY code')).map(asCoupon).filter((c): c is Coupon => c !== null);

  /**
   * Keeps a coupon (ADR 0065 d8), by its code: a new one, or one changed with
   * its uses so far kept. Null, and why, when it is not one.
   */
  async function saveCoupon(input: unknown): Promise<{ coupon: Coupon } | { error: string }> {
    const coupon = normalizeCoupon(input);
    if (!coupon) return { error: 'a coupon needs a code (letters, digits, "-" and "_") and what it takes off: a percentage from 1 to 100, or a sum' };
    const before = await couponOf(coupon.code);
    if (!before && Number((await one('SELECT COUNT(*) AS n FROM shop_coupons', []))?.n ?? 0) >= MAX_COUPONS) return { error: `a shop keeps at most ${MAX_COUPONS} coupons: delete some that ended first` };
    const kept = { ...coupon, used: before?.used ?? 0 };
    await db.run(
      db.upsert('shop_coupons', ['code', 'kind', 'value', 'ends', 'uses', 'used', 'minimum', 'created_at'], ['code'], ['kind', 'value', 'ends', 'uses', 'minimum']),
      [kept.code, kept.kind, kept.value, kept.ends, kept.uses, kept.used, kept.minimum, new Date().toISOString()],
    );
    return { coupon: kept };
  }

  /** `/api/shop/coupons`: every coupon (GET), one kept by its code (PUT), one deleted (`DELETE ?code=`). */
  async function couponsApi(request: Request, url: URL, body: Record<string, unknown>): Promise<Response> {
    if (request.method === 'GET') return json({ coupons: await coupons() });
    if (request.method === 'PUT') {
      const saved = await saveCoupon(body);
      return 'error' in saved ? json(saved, 400) : json({ ...saved, coupons: await coupons() });
    }
    if (request.method === 'DELETE') {
      const code = couponCode(url.searchParams.get('code') ?? body.code);
      if (!code || (await db.changed('DELETE FROM shop_coupons WHERE code = ?', [code])) !== 1) return json({ error: 'there is no such coupon' }, 404);
      return json({ coupons: await coupons() });
    }
    return json({ error: 'not found' }, 404);
  }

  /**
   * `/api/shop/stock?kind=<type>&slug=<entry>`: what is left of a product, by
   * combination ('' for the product itself). PUT sets it; a combination the
   * product is not sold in is not kept, and one left empty is forgotten.
   * Editors set it, as they write the product (ADR 0065 d2).
   */
  async function stockApi(request: Request, url: URL, body: Record<string, unknown>): Promise<Response> {
    const kind = String(url.searchParams.get('kind') ?? body.kind ?? '');
    const at = String(url.searchParams.get('slug') ?? body.slug ?? '');
    const type = (await store.site()).types.find((t) => t.id === kind && t.sells);
    if (!type) return json({ error: 'that type does not sell' }, 404);
    const slug = (await store.locateEntry(type.id, at))?.of ?? at;
    const entry = await store.entryDraft(type.id, slug);
    if (!entry?.product) return json({ error: 'there is no such product' }, 404);
    const product = `${type.id}/${slug}`;
    if (request.method === 'PUT') {
      const before = await left(product);
      const given = isObject(body.stock) ? body.stock : {};
      const keys = entry.product.options.length ? combinations(entry.product.options) : [''];
      let crossed = false;
      await db.run('DELETE FROM shop_stock WHERE product = ?', [product]);
      for (const key of keys) {
        const quantity = quantityOf(given[key]);
        if (quantity !== null) await db.run('INSERT INTO shop_stock (id, product, variant, quantity) VALUES (?, ?, ?, ?)', [stockId(product, key), product, key, quantity]);
        if ((quantity ?? 0) > 0 !== (before[key] ?? 0) > 0) crossed = true;
      }
      // A product that ran out or came back: its page says so once built again.
      if (crossed) await store.touch();
    } else if (request.method !== 'GET') return json({ error: 'not found' }, 404);
    return json({ stock: await left(product) });
  }

  return {
    async stock() {
      const out: Record<string, number> = {};
      for (const row of await db.rows<Row>('SELECT product, variant, quantity FROM shop_stock')) {
        const [type, ...rest] = String(row.product).split('/');
        out[stockKey(type as string, rest.join('/'), String(row.variant))] = Number(row.quantity);
      }
      return out;
    },
    admin,
    fetch,
    async chores(now) {
      await db.run('DELETE FROM shop_carts WHERE updated_at <= ?', [new Date(now.getTime() - CART_DAYS * DAY).toISOString()]);
    },
    ordersOf,
    lent: {
      get: async (id) => {
        const order = await orderBy('id', String(id));
        return order ? lentOrder(order) : null;
      },
      paid: (id) => changeFor(id, (o) => (o.state === 'waiting' ? { state: 'paid' } : null)),
      refunded: (id) => changeFor(id, (o) => (o.state === 'refunded' ? null : { state: 'refunded' })),
      tracking: (id, tracking) => changeFor(id, () => ({ tracking: String(tracking) })),
    },
  };

  /** A change an extension asks for: none when the order is already so. */
  async function changeFor(id: string, asked: (order: Order) => { state?: OrderState; tracking?: string } | null): Promise<LentOrder> {
    const order = await orderBy('id', String(id));
    if (!order) throw new Error('there is no such order');
    const wanted = asked(order);
    if (!wanted) return lentOrder(order);
    const changed = await change(order, wanted, null);
    if ('error' in changed) throw new Error(changed.error);
    return lentOrder(changed.order);
  }
}
