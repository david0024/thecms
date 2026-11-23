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
  entryPath,
  isFinal,
  isObject,
  moneyText,
  NAME,
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
} from '../core/index.ts';
import { wordsFor } from '../blocks/words.ts';
import { openMailQueue } from './mail-queue.ts';
import { normalizeTemplates, type OrderValues, renderTemplate, type TemplateName } from './site-mail.ts';
import { type CartLine, checkoutForm, dayOf, linesPart, type Order, type OrderData, orderPart, orderText, stateName, type Totals, totalsPart, type Typed } from './shop-pages.ts';
import { shopSchema } from './shop-schema.ts';
import { escape, framed, type Notice } from './framed.ts';
import { cleanEmail, type Database, type Store, type User } from './store.ts';
import './languages.ts';

type Row = Record<string, unknown>;
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
}

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const plain = (words: string, status: number): Response => new Response(`${words}\n`, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });

const hashed = (value: string): string => createHash('sha256').update(value).digest('hex');
const idOf = (key: string): string => hashed(key).slice(0, 40);
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

/** The sums of lines that can be bought, with a way to deliver them (ADR 0065 d5). */
export function totalsOf(lines: { price: number; quantity: number; rate: number }[], method: ShippingMethod | null, settings: ShopSettings): Totals {
  const subtotal = lines.reduce((sum, l) => sum + l.price * l.quantity, 0);
  const shipping = method ? shippingCost(method, subtotal) : 0;
  const vat: [number, number][] = [];
  if (settings.vat) {
    const gross = new Map<number, number>();
    for (const l of lines) gross.set(l.rate, (gross.get(l.rate) ?? 0) + l.price * l.quantity);
    // Delivery is taxed at the site's first rate.
    const first = settings.rates[0] ?? 0;
    if (shipping) gross.set(first, (gross.get(first) ?? 0) + shipping);
    for (const rate of [...settings.rates, ...gross.keys()]) {
      const amount = vatIn(gross.get(rate) ?? 0, rate);
      if (amount && !vat.some(([r]) => r === rate)) vat.push([rate, amount]);
    }
  }
  return { subtotal, shipping, total: subtotal + shipping, vat };
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
    const counted = product.counted ? ((await one('SELECT quantity FROM shop_stock WHERE id = ?', [idOf(`${line.product}#${line.variant}`)]))?.quantity ?? 0) : null;
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
  const cartOf = async (secret: string, now = new Date()): Promise<{ lines: Kept[]; shipping: string } | null> => {
    if (!secret || secret.length > 100) return null;
    const row = await one('SELECT items, shipping, updated_at FROM shop_carts WHERE id = ?', [hashed(secret)]);
    if (!row || String(row.updated_at) <= new Date(now.getTime() - CART_DAYS * DAY).toISOString()) return null;
    return { lines: keptLines(JSON.parse(String(row.items))), shipping: String(row.shipping) };
  };
  const keepCart = async (secret: string, lines: Kept[], shipping: string): Promise<void> => {
    await db.run(db.upsert('shop_carts', ['id', 'items', 'shipping', 'updated_at'], ['id'], ['items', 'shipping', 'updated_at']), [hashed(secret), JSON.stringify(lines), shipping, new Date().toISOString()]);
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
      const id = idOf(`${l.product}#${l.variant}`);
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
      const id = idOf(`${l.product}#${l.variant}`);
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
  const baseOf = (site: Site, url: URL): string => {
    try {
      const own = new URL(site.url);
      if (own.protocol === 'https:' || own.protocol === 'http:') return own.origin;
    } catch {
      // No address set: the one asked.
    }
    return url.origin;
  };
  const orderLink = (site: Site, url: URL, order: Order): string => `${baseOf(site, url)}/_/order/${order.secret}${order.language === site.language ? '' : `?l=${encodeURIComponent(order.language)}`}`;
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
    const methodOf = (id: string): ShippingMethod | null => settings.shipping.find((m) => m.id === id) ?? null;

    /** The cart's lines as they can be bought now, each lowered to what is left. Saved when something changed. */
    const current = async (): Promise<{ lines: CartLine[]; notices: string[] }> => {
      if (!cart) return { lines: [], notices: [] };
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
      if (changed) await keepCart(secret, lines.map(({ product, variant, quantity }) => ({ product, variant, quantity })), cart.shipping);
      return { lines, notices };
    };
    const bought = (lines: CartLine[]) => lines.filter((l): l is CartLine & { price: number } => l.price !== null);

    switch (route) {
      case '/_/cart': {
        if (post) {
          const lines = [...(cart?.lines ?? [])];
          let shipping = cart?.shipping ?? '';
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
          } else {
            const removed = fields.get('remove');
            for (let i = lines.length - 1; i >= 0; i--) {
              const typed = fields.get(`q${i}`);
              const quantity = typed === null ? (lines[i] as Kept).quantity : (quantityOf(typed) ?? (lines[i] as Kept).quantity);
              if (removed === String(i) || quantity === 0) lines.splice(i, 1);
              else (lines[i] as Kept).quantity = Math.min(quantity, QUANTITY_MAX);
            }
            if (fields.has('shipping') && (methodOf(field('shipping', 40)) || field('shipping') === '')) shipping = field('shipping', 40);
          }
          if (notice === 'notadded' && !cart) return to('/_/cart', notice);
          const own = cart ? secret : newSecret();
          await keepCart(own, lines, shipping);
          return to('/_/cart', notice, cart ? {} : { 'set-cookie': cookie(own, CART_DAYS * 86_400) });
        }
        const { lines, notices } = await current();
        const NOTICES: Record<string, Notice> = { added: { text: said.cartAdded }, updated: { text: said.cartUpdated }, notadded: { text: said.cartNotAdded, failed: true }, changed: { text: said.checkoutChanged, failed: true } };
        const notice: Notice | undefined = notices.length ? { text: notices.join(' '), failed: true } : NOTICES[url.searchParams.get('said') ?? ''];
        if (!lines.length) return draw(said.cart, `<p class="lead" data-cart-empty>${escape(said.cartEmpty)}</p><p><a href="/">${escape(said.cartBack)}</a></p>`, notice);
        const method = methodOf(cart?.shipping ?? '') ?? (settings.shipping.length === 1 ? (settings.shipping[0] as ShippingMethod) : null);
        const totals = totalsOf(bought(lines), method, settings);
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
        const choose = settings.shipping.length
          ? `<p class="form-field"><label for="cart-shipping">${escape(said.cartShipping)}</label><select id="cart-shipping" name="shipping"><option value="">${escape(said.shopChoose)}…</option>${settings.shipping
              .map((m) => `<option value="${escape(m.id)}"${method?.id === m.id ? ' selected' : ''}>${escape(m.name)}: ${escape(shippingCost(m, totals.subtotal) ? money(shippingCost(m, totals.subtotal)) : said.cartShippingFree)}</option>`)
              .join('')}</select></p>`
          : '';
        return draw(
          said.cart,
          `<form id="cart-remove" method="post" action="/_/cart${query}"></form>` +
            `<form class="form cart" method="post" action="/_/cart${query}" accept-charset="utf-8"><table class="cart-lines"><thead><tr><th scope="col">${escape(said.cartProduct)}</th><th scope="col">${escape(said.cartPrice)}</th><th scope="col">${escape(said.shopQuantity)}</th><th scope="col">${escape(said.cartLineTotal)}</th><th></th></tr></thead><tbody>${rows}</tbody></table>` +
            `${choose}<p><button class="button button-quiet" type="submit">${escape(said.cartUpdate)}</button></p></form>` +
            totalsPart(said, totals, money, method ? method.name : null, settings.vat) +
            (bought(lines).length ? `<p><a class="button" href="/_/checkout${query}" data-cart-checkout>${escape(said.cartToCheckout)}</a></p>` : ''),
          notice,
        );
      }
      case '/_/checkout': {
        const { lines } = await current();
        const buying = bought(lines);
        if (!buying.length) return to('/_/cart');
        const payments = [...(settings.transfer.on ? (['transfer'] as const) : []), ...(settings.cod ? (['cod'] as const) : [])];
        if (!payments.length || !settings.shipping.length) return draw(said.checkout, `<p class="lead" data-checkout-closed>${escape(said.checkoutClosed)}</p>`, undefined, 503);
        const me = await deps.visitor(request);
        if (settings.account && !me && (await deps.accounts())) {
          const back = `/_/checkout${query}`;
          return draw(said.checkout, `<p class="lead" data-checkout-sign-in>${escape(said.checkoutSignIn)}</p><p><a class="button" href="/_/account?back=${encodeURIComponent(back)}${language === site.language ? '' : `&amp;l=${encodeURIComponent(language)}`}">${escape(said.accountSignIn)}</a></p>`, undefined, 403);
        }
        const typed: Typed = post
          ? Object.fromEntries(['name', 'email', 'phone', 'street', 'town', 'county', 'postcode', 'company', 'companyName', 'taxCode', 'registration', 'shipping', 'payment', 'note'].map((k) => [k, field(k, k === 'note' ? 1000 : 200)]))
          : { name: me?.name ?? '', email: me?.email ?? '', shipping: methodOf(cart?.shipping ?? '')?.id ?? (settings.shipping.length === 1 ? (settings.shipping[0]?.id ?? '') : ''), payment: payments.length === 1 ? (payments[0] as string) : '' };
        const method = methodOf(typed.shipping ?? '');
        const totals = totalsOf(buying, method, settings);
        const page = (notice?: Notice, bad = new Set<string>(), status = 200): Response =>
          draw(
            said.checkout,
            linesPart(said, buying.map((l) => ({ ...l, href: l.href })), money) +
              totalsPart(said, totals, money, method ? method.name : null, settings.vat) +
              checkoutForm(said, settings, { action: `/_/checkout${query}`, typed, bad, methods: settings.shipping, money, subtotal: totals.subtotal, total: totals.total, payments }),
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
        if (!payments.includes(typed.payment as 'transfer' | 'cod')) bad.add('payment');
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
        const taken = await take(buying);
        if (taken.short !== null) return page({ text: said.checkoutNoStock.replace('{name}', taken.short), failed: true }, new Set(), 409);
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
          payment: typed.payment as 'transfer' | 'cod',
          transfer: typed.payment === 'transfer' ? { holder: settings.transfer.holder, iban: settings.transfer.iban, bank: settings.transfer.bank } : null,
          totals,
          vat: settings.vat,
          currency,
          note: typed.note ?? '',
          tracking: '',
          history: [],
        };
        // Paid by transfer, it waits for the money; paid on delivery, it is prepared at once.
        const state: OrderState = data.payment === 'transfer' ? 'waiting' : 'preparing';
        data.history.push({ state, at: new Date().toISOString() });
        const order = await place(data, email, me?.id ?? '', language, state);
        await db.run('DELETE FROM shop_carts WHERE id = ?', [hashed(secret)]);
        if (taken.crossed) await store.touch();
        const link = orderLink(site, url, order);
        await tell(email, 'orderReceived', order, link);
        await tell(await ownerAddress(settings), 'orderNew', order, link);
        return to(`/_/order/${order.secret}`, 'placed', { 'set-cookie': cookie('', 0) });
      }
      default: {
        const asked = /^\/_\/order\/([A-Za-z0-9_-]{20,100})$/.exec(route)?.[1];
        const order = asked && !post ? await orderBy('secret', asked) : null;
        if (!order) return draw(said.orderGone, `<p><a href="/">${escape(said.cartBack)}</a></p>`, undefined, 404);
        const shown = (n: number): string => moneyText(n, order.data.currency, language);
        return draw(said.order.replace('{number}', String(order.number)), orderPart(said, order, shown), url.searchParams.get('said') === 'placed' ? { text: said.orderPlaced } : undefined, 200, { 'referrer-policy': 'no-referrer' });
      }
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
        const head = ['number', 'date', 'state', 'name', 'email', 'phone', 'address', 'company', 'tax code', 'products', 'subtotal', 'delivery', 'total', 'currency', 'payment', 'tracking'];
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
        const asked = String(body.state ?? order.state);
        if (!(ORDER_STATES as readonly string[]).includes(asked)) return json({ error: 'that is not a state an order has' }, 400);
        const state = asked as OrderState;
        const tracking = typeof body.tracking === 'string' ? body.tracking.replace(/\s+/g, ' ').trim().slice(0, 100) : order.data.tracking;
        if (state !== order.state && isFinal(order.state)) return json({ error: 'a cancelled or refunded order stays so' }, 409);
        const data: OrderData = { ...order.data, tracking, history: state === order.state ? order.data.history : [...order.data.history, { state, at: new Date().toISOString() }] };
        const at = new Date().toISOString();
        // Changed only from the state it was read in: two people handling one order do not both send its message.
        if ((await db.changed('UPDATE shop_orders SET state = ?, data = ?, updated_at = ? WHERE id = ? AND state = ?', [state, JSON.stringify(data), at, order.id, order.state])) !== 1) {
          return json({ error: 'someone else changed this order: open it again' }, 409);
        }
        const next: Order = { ...order, state, data, updatedAt: at };
        if (state !== order.state) {
          if (state === 'cancelled') await giveBack(order);
          const site = await store.site();
          const message: Partial<Record<OrderState, TemplateName>> = { paid: 'orderPaid', sent: 'orderSent', cancelled: 'orderCancelled' };
          const what = message[state];
          if (what) await tell(order.email, what, next, orderLink(site, url, next));
        }
        return json({ order: next });
      }
      if (request.method !== 'GET') return json({ error: 'not found' }, 404);
      return json({ order });
    }
    if (url.pathname !== '/api/shop/stock') return json({ error: 'not found' }, 404);
    return stockApi(request, url, body);
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
        if (quantity !== null) await db.run('INSERT INTO shop_stock (id, product, variant, quantity) VALUES (?, ?, ?, ?)', [idOf(`${product}#${key}`), product, key, quantity]);
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
  };
}
