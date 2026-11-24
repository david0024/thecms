/**
 * The shop, PR (c) (ADR 0065 d8, d9): coupons in the cart and the order,
 * what extensions hear of orders and what `orders` lends them, and the
 * shop's tables in backups and in the content file.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { couponCode, couponOff, couponProblem, extensionAsks, normalizeCoupon, normalizeShopSettings, PROGRAM_DATA, type ExtensionManifest } from '../src/core/index.ts';
import { readContentFile, runContentImport } from '../src/import/uhlaka.ts';
import type { Mail } from '../src/site/mail.ts';
import { startRuntime } from '../src/site/runtime.ts';
import { startEditor } from '../src/site/server.ts';
import { shopGate } from '../src/site/shop-gate.ts';
import { asCoupon, shopSchema, stockId } from '../src/site/shop-schema.ts';
import { totalsOf } from '../src/site/shop.ts';
import { importOrders, importShop } from '../src/site/shop-transfer.ts';
import { Store } from '../src/site/store.ts';
import { contentParts, exportContent } from '../src/site/transfer.ts';
import plain from '../themes/plain.json';

const dir = await mkdtemp(join(tmpdir(), 'uhlaka-coupons-'));
afterAll(() => rm(dir, { recursive: true, force: true }));
const text = (body: string) => ({ id: `b_${Math.random().toString(36).slice(2, 10)}`, type: 'text', content: { body: [{ type: 'paragraph', children: [{ text: body }] }] } });

async function site(name: string): Promise<Store> {
  const store = await Store.open(join(dir, `${name}.db`));
  await store.setTheme(plain);
  await store.publishTheme();
  await store.setSite({ name: 'Atelier', url: 'https://example.com', language: 'en', languages: [] });
  await store.savePage({ slug: '', title: 'Home', blocks: [text('Welcome.')] });
  await store.publish('');
  return store;
}

async function admin(store: Store, sent: Mail[] = []) {
  const editor = await startEditor(store, { listen: false, log: () => {}, mailer: async (mail) => void sent.push(mail), from: 'site@example.com' });
  const call = async (method: string, path: string, body?: unknown): Promise<{ status: number; body: Record<string, unknown>; text: string }> => {
    const response = await editor.fetch(
      new Request(`http://127.0.0.1:4321${path}`, { method, headers: { host: '127.0.0.1:4321', 'x-uhlaka-token': editor.token, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }),
    );
    const text = (await response.text()).replace(/ /g, ' ');
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      // A CSV.
    }
    return { status: response.status, body: parsed, text };
  };
  return { editor, call };
}

function browser(fetch: (request: Request) => Promise<Response>) {
  const jar = new Map<string, string>();
  const go = async (method: string, path: string, fields?: Record<string, string>): Promise<Response> => {
    const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const response = await fetch(
      new Request(`https://example.com${path}`, {
        method,
        headers: { ...(cookie ? { cookie } : {}), ...(fields ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
        body: fields ? new URLSearchParams(fields).toString() : undefined,
      }),
    );
    const set = response.headers.get('set-cookie');
    if (set) {
      const [pair] = set.split(';');
      const [name, ...value] = (pair as string).split('=');
      if (/Max-Age=0/.test(set)) jar.delete(name as string);
      else jar.set(name as string, value.join('='));
    }
    return response;
  };
  const read = async (method: string, path: string, fields?: Record<string, string>): Promise<string> => (await (await go(method, path, fields)).text()).replace(/ /g, ' ');
  return { go, read };
}

/** A shop with a mug (counted, 10 left) at 50, sent by courier for 20, free from 100, paid on delivery. */
async function shop(store: Store, call: Awaited<ReturnType<typeof admin>>['call']): Promise<void> {
  await call('PUT', '/api/shop', { on: true });
  await store.saveEntry('products', { title: 'Mug', product: { price: '50', counted: true, vat: 21 } });
  await store.publishEntry('products', 'mug');
  await call('PUT', '/api/shop/stock', { kind: 'products', slug: 'mug', stock: { '': 10 } });
  await call('PUT', '/api/shop', { cod: true, shipping: [{ name: 'Courier', price: '20', free: '100' }], terms: '/terms/' });
}

const buyer = { name: 'Ana Pop', email: 'ana@example.com', phone: '0722 000 000', street: 'Str. Mare 2', town: 'Cluj-Napoca', county: 'Cluj', shipping: 'm1', payment: 'cod', terms: 'yes' };
const totalIn = (page: string): string => /name="total" value="(\d+)"/.exec(page)?.[1] as string;

describe('a coupon’s words and sums', () => {
  test('its code, what it takes off, and when it is not taken', () => {
    expect(couponCode(' summer-10 ')).toBe('SUMMER-10');
    expect(couponCode('no spaces')).toBe('');
    expect(couponCode('x'.repeat(41))).toBe('');
    expect(normalizeCoupon({ code: 'a', value: '10' })).toEqual({ code: 'A', kind: 'percent', value: 10, ends: '', uses: null, used: 0, minimum: null });
    expect(normalizeCoupon({ code: 'B', kind: 'amount', value: '15,50', ends: '2026-12-31', uses: '3', used: 1, minimum: '100' })).toEqual({ code: 'B', kind: 'amount', value: 1550, ends: '2026-12-31', uses: 3, used: 1, minimum: 10000 });
    expect(normalizeCoupon({ code: 'C', value: 101 })).toBeNull();
    expect(normalizeCoupon({ code: '', value: 10 })).toBeNull();
    expect(normalizeCoupon({ code: 'D', value: 5, ends: 'soon', uses: 0 })?.ends).toBe('');
    expect(normalizeCoupon('nothing')).toBeNull();
    const c = normalizeCoupon({ code: 'E', value: 10, ends: '2026-01-31', uses: 2, used: 2, minimum: '50' })!;
    expect(couponProblem(c, 10000, new Date('2026-02-01'))).toBe('ended');
    expect(couponProblem(c, 10000, new Date('2026-01-31T23:00:00Z'))).toBe('used');
    expect(couponProblem({ ...c, used: 1 }, 4999, new Date('2026-01-01'))).toBe('minimum');
    expect(couponProblem({ ...c, used: 1 }, 5000, new Date('2026-01-01'))).toBeNull();
    expect(couponOff({ kind: 'percent', value: 10 }, 12345)).toBe(1235);
    expect(couponOff({ kind: 'amount', value: 5000 }, 3000)).toBe(3000);
    expect(asCoupon({ code: 'F', kind: 'amount', value: '500', ends: '', uses: null, used: '2', minimum: null })).toEqual({ code: 'F', kind: 'amount', value: 500, ends: '', uses: null, used: 2, minimum: null });
  });

  test('a coupon takes off the products, shared between the rates, and delivery is free by what is paid after it', () => {
    const settings = normalizeShopSettings({ on: true, rates: [21, 11] });
    const lines = [
      { price: 12100, quantity: 1, rate: 21 },
      { price: 11100, quantity: 1, rate: 11 },
    ];
    const courier = { id: 'm1', name: 'Courier', price: 2000, free: 20000, pickup: '' };
    // 10% of 232: 23.20 off, 11.10 from 21% and 12.10 from 11%... by their share.
    const totals = totalsOf(lines, courier, settings, { code: 'TEN', kind: 'percent', value: 10 });
    expect(totals.subtotal).toBe(23200);
    expect(totals.discount).toBe(2320);
    expect(totals.coupon).toBe('TEN');
    // 208.80 left is above 200: delivery is free.
    expect(totals.shipping).toBe(0);
    expect(totals.total).toBe(20880);
    expect(totals.vat).toEqual([
      [21, 1890],
      [11, 990],
    ]);
    // 50 off 232 leaves 182: delivery is paid again.
    expect(totalsOf(lines, courier, settings, { code: 'S', kind: 'amount', value: 5000 }).shipping).toBe(2000);
    expect(shopSchema('mysql')[3]).toContain('code VARCHAR(64)');
    expect(shopSchema('postgres')[3]).toContain('value BIGINT');
    expect(stockId('products/mug', '')).toHaveLength(40);
  });
});

describe('coupons in the cart and the order', () => {
  test('applied, under its smallest order, used up, given back when cancelled, in the CSV', async () => {
    const store = await site('flow');
    const { editor, call } = await admin(store);
    const runtime = startRuntime(store, { listen: false, log: () => {} });
    try {
      await shop(store, call);
      // Kept by code: a new one, then the same one changed.
      expect((await call('PUT', '/api/shop/coupons', { code: 'nope', value: 0 })).status).toBe(400);
      expect((await call('PUT', '/api/shop/coupons', { code: 'once', kind: 'amount', value: '10', uses: 1 })).status).toBe(200);
      const saved = await call('PUT', '/api/shop/coupons', { code: 'ONCE', kind: 'amount', value: '25', uses: '1', minimum: '60' });
      expect(saved.body.coupons).toEqual([{ code: 'ONCE', kind: 'amount', value: 2500, ends: '', uses: 1, used: 0, minimum: 6000 }]);
      await call('PUT', '/api/shop/coupons', { code: 'OLD', value: 50, ends: '2020-01-01' });
      expect(((await call('GET', '/api/shop/coupons')).body.coupons as unknown[]).length).toBe(2);

      const tab = browser((r) => runtime.fetch(r));
      // Without a cart, a code that is not one makes none.
      expect((await tab.go('POST', '/_/cart', { coupon: 'WRONG' })).headers.get('location')).toBe('/_/cart?said=couponbad');
      await tab.go('POST', '/_/cart', { product: 'products/mug', quantity: '1' });
      let page = await tab.read('GET', '/_/cart');
      expect(page).toContain('data-cart-coupon');
      expect((await tab.go('POST', '/_/cart', { coupon: 'old' })).headers.get('location')).toBe('/_/cart?said=couponbad');
      expect(await tab.read('GET', '/_/cart?said=couponbad')).toContain('There is no such coupon, or it has ended.');

      // Under its smallest order, it stays and is said.
      expect((await tab.go('POST', '/_/cart', { coupon: ' once ' })).headers.get('location')).toBe('/_/cart?said=coupon');
      page = await tab.read('GET', '/_/cart');
      expect(page).toContain('The coupon ONCE is taken from RON 60.00 of products.');
      expect(page).not.toContain('data-cart-discount');
      // Two mugs: 100 − 25 = 75, and delivery is paid again (free only from 100).
      await tab.go('POST', '/_/cart', { q0: '2', shipping: 'm1' });
      page = await tab.read('GET', '/_/cart');
      expect(page).toContain('data-cart-discount');
      expect(page).toContain('Coupon ONCE');
      expect(page).toContain('−RON 25.00');
      page = await tab.read('GET', '/_/checkout');
      expect(totalIn(page)).toBe('9500');

      // Another buyer takes its one use first: this checkout goes back to the cart, which says so.
      const other = browser((r) => runtime.fetch(r));
      await other.go('POST', '/_/cart', { product: 'products/mug', quantity: '2' });
      await other.go('POST', '/_/cart', { coupon: 'ONCE', shipping: 'm1' });
      expect((await other.go('POST', '/_/checkout', { ...buyer, email: 'ion@example.com', total: '9500' })).status).toBe(303);
      const changed = await tab.go('POST', '/_/checkout', { ...buyer, total: '9500' });
      expect(changed.status).toBe(409);
      expect((await changed.text()).replace(/\u00a0/g, ' ')).toContain('RON 100.00');
      page = await tab.read('GET', '/_/cart');
      expect(page).not.toContain('data-cart-discount');
      expect(page).not.toContain('data-cart-uncoupon');
      expect(await tab.read('POST', '/_/cart', { coupon: 'ONCE' })).toBe('');
      expect(await tab.read('GET', '/_/cart?said=couponused')).toContain('used as many times as it may be');

      const [order] = (await call('GET', '/api/shop/orders')).body.orders as { id: string; total: number }[];
      expect(order?.total).toBe(9500);
      const full = (await call('GET', `/api/shop/orders?id=${order?.id}`)).body.order as { data: { totals: { coupon: string; discount: number } } };
      expect(full.data.totals).toMatchObject({ coupon: 'ONCE', discount: 2500 });
      const csv = (await call('GET', '/api/shop/orders.csv')).text;
      expect(csv.split('\r\n')[0]).toContain('subtotal,coupon,discount,delivery');
      expect(csv).toContain('100.00,ONCE,25.00,20.00,95.00');
      expect(((await call('GET', '/api/shop/coupons')).body.coupons as { code: string; used: number }[]).find((c) => c.code === 'ONCE')?.used).toBe(1);
      // Cancelled, the order gives its use back.
      await call('PUT', '/api/shop/orders', { id: order?.id, state: 'cancelled' });
      expect(((await call('GET', '/api/shop/coupons')).body.coupons as { code: string; used: number }[]).find((c) => c.code === 'ONCE')?.used).toBe(0);
      // And the coupon is applied again, then taken off by its own button.
      await tab.go('POST', '/_/cart', { coupon: 'ONCE' });
      expect(await tab.read('GET', '/_/cart')).toContain('data-cart-uncoupon');
      await tab.go('POST', '/_/cart', { coupon: '' });
      expect(await tab.read('GET', '/_/cart')).not.toContain('data-cart-uncoupon');

      expect((await call('DELETE', '/api/shop/coupons?code=OLD')).status).toBe(200);
      expect((await call('DELETE', '/api/shop/coupons?code=OLD')).status).toBe(404);
      expect((await call('POST', '/api/shop/coupons', {})).status).toBe(404);
    } finally {
      runtime.stop();
      editor.stop();
      await store.close();
    }
  });

  test('an editor handles coupons only when they handle orders', async () => {
    const store = await site('editors');
    const { editor, call } = await admin(store);
    try {
      await shop(store, call);
      const user = await store.addUser({ email: 'ed@example.com', name: 'Ed', role: 'editor' });
      const gate = shopGate(store);
      const ask = (method: string) => gate.admin(new Request('http://x/api/shop/coupons', { method }), new URL('http://x/api/shop/coupons'), user, {});
      expect((await ask('GET')).status).toBe(403);
      await call('PUT', '/api/shop', { editors: true });
      expect((await ask('GET')).status).toBe(200);
    } finally {
      editor.stop();
      await store.close();
    }
  });
});

describe('orders for extensions', () => {
  test('the events say the order’s id, number and total; `orders` reads it and marks it', async () => {
    const store = await site('events');
    const sent: Mail[] = [];
    const { editor, call } = await admin(store, sent);
    const runtime = startRuntime(store, { listen: false, log: () => {}, mailer: async (mail) => void sent.push(mail), from: 'site@example.com' });
    const heard: { name: string; data: Record<string, unknown> }[] = [];
    const off = store.onEvent((event) => heard.push(event));
    try {
      // Off: the shop lends nothing.
      await expect(shopGate(store).lent.get('x')).rejects.toThrow('the shop is off');
      await shop(store, call);
      await call('PUT', '/api/shop', { transfer: { on: true, holder: 'A', iban: 'RO49AAAA1B31007593840000', bank: 'B' } });
      const tab = browser((r) => runtime.fetch(r));
      await tab.go('POST', '/_/cart', { product: 'products/mug', quantity: '1', shipping: 'm1' });
      await tab.go('POST', '/_/cart', { shipping: 'm1' });
      expect((await tab.go('POST', '/_/checkout', { ...buyer, payment: 'transfer', total: '7000' })).status).toBe(303);
      const made = heard.find((e) => e.name === 'order.made');
      expect(made?.data).toEqual({ id: expect.any(String), number: 1, total: 7000, currency: 'RON' });
      const id = made?.data.id as string;

      const lent = shopGate(store).lent;
      const read = await lent.get(id);
      expect(read).toMatchObject({ number: 1, state: 'waiting', email: 'ana@example.com', buyer: { name: 'Ana Pop' } });
      expect(read).not.toHaveProperty('secret');
      expect(await lent.get('none')).toBeNull();
      expect((await lent.paid(id)).state).toBe('paid');
      // Told twice, as a webhook may: nothing changes, nobody is told again.
      expect((await lent.paid(id)).state).toBe('paid');
      expect(heard.filter((e) => e.name === 'order.paid')).toHaveLength(1);
      expect((await lent.tracking(id, ' AWB  123 ')).tracking).toBe('AWB 123');
      await call('PUT', '/api/shop/orders', { id, state: 'sent' });
      expect(heard.some((e) => e.name === 'order.sent')).toBe(true);
      expect((await lent.refunded(id)).state).toBe('refunded');
      expect((await lent.refunded(id)).state).toBe('refunded');
      expect(heard.filter((e) => e.name === 'order.refunded')).toHaveLength(1);
      await expect(lent.paid('none')).rejects.toThrow('there is no such order');
      // No event carries who bought.
      for (const e of heard.filter((e) => e.name.startsWith('order.'))) expect(Object.keys(e.data).sort()).toEqual(['currency', 'id', 'number', 'total']);
    } finally {
      off();
      runtime.stop();
      editor.stop();
      await store.close();
    }
  });

  test('an extension that uses `orders` or hears of them is said to work with the shop', () => {
    expect(PROGRAM_DATA).toContain('orders');
    const manifest = { uses: ['orders'], events: [], collections: [], egress: [], actions: [], routes: [], jobs: [], answers: [], blocks: [], mails: [] } as unknown as ExtensionManifest;
    expect(extensionAsks(manifest).shop).toBe(true);
    expect(extensionAsks({ ...manifest, uses: [], events: [{ on: 'order.paid', action: 'a' }] } as unknown as ExtensionManifest).shop).toBe(true);
    expect(extensionAsks({ ...manifest, uses: [] } as unknown as ExtensionManifest).shop).toBe(false);
  });
});

describe('the shop in backups and in the content file', () => {
  /** A shop with an order placed with a coupon. */
  async function sold(name: string): Promise<Store> {
    const store = await site(name);
    const { editor, call } = await admin(store);
    const runtime = startRuntime(store, { listen: false, log: () => {} });
    try {
      await shop(store, call);
      await call('PUT', '/api/shop/coupons', { code: 'TEN', value: 10 });
      const tab = browser((r) => runtime.fetch(r));
      await tab.go('POST', '/_/cart', { product: 'products/mug', quantity: '1' });
      await tab.go('POST', '/_/cart', { coupon: 'TEN', shipping: 'm1' });
      expect((await tab.go('POST', '/_/checkout', { ...buyer, total: '6500' })).status).toBe(303);
    } finally {
      runtime.stop();
      editor.stop();
    }
    return store;
  }

  test('a backup holds the stock, the orders and the coupons, and puts them back; not the carts', async () => {
    const from = await sold('backup-from');
    const rows: { table: string; row: Record<string, unknown> }[] = [];
    for await (const row of from.backupRows()) rows.push(row);
    const tables = new Set(rows.map((r) => r.table));
    for (const table of ['shop_stock', 'shop_orders', 'shop_coupons']) expect(tables.has(table)).toBe(true);
    expect(tables.has('shop_carts')).toBe(false);
    const into = await Store.open(join(dir, 'backup-into.db'));
    try {
      expect(await into.hasTable('shop_orders')).toBe(false);
      await into.restoreRows((async function* () {
        yield* rows;
      })());
      const db = into.database();
      expect((await db.rows<{ number: number }>('SELECT number FROM shop_orders')).map((r) => Number(r.number))).toEqual([1]);
      expect((await db.rows<{ quantity: number }>('SELECT quantity FROM shop_stock')).map((r) => Number(r.quantity))).toEqual([9]);
      expect((await db.rows<{ used: number }>('SELECT used FROM shop_coupons')).map((r) => Number(r.used))).toEqual([1]);
    } finally {
      await into.close();
      await from.close();
    }
  });

  test('the shop goes with the whole site, its orders only when chosen; both come back by import', async () => {
    const from = await sold('file-from');
    try {
      const offered = await contentParts(from);
      expect(offered.find((p) => p.id === 'shop')?.apart).toBeUndefined();
      expect(offered.find((p) => p.id === 'orders')?.apart).toBe(true);
      const whole = await exportContent(from);
      expect(whole.shop?.stock).toEqual([{ product: 'products/mug', variant: '', quantity: 9 }]);
      expect(whole.shop?.coupons).toEqual([{ code: 'TEN', kind: 'percent', value: 10, ends: '', uses: null, used: 1, minimum: null }]);
      expect(whole.shop?.settings.on).toBe(true);
      expect(whole.orders).toBeUndefined();
      const all = await exportContent(from, [...offered.map((p) => p.id)]);
      expect(all.orders?.[0]).toMatchObject({ number: 1, email: 'ana@example.com', total: 6500 });
      expect(all.orders?.[0]).not.toHaveProperty('secret');

      // Into a new site, taking the old one's settings: the shop is on, with its stock, coupon and order.
      const into = await Store.open(join(dir, 'file-into.db'));
      try {
        const file = readContentFile(JSON.stringify(all));
        const report = await runContentImport(into, file, { fresh: true });
        expect(report.notes.join(' ')).toContain("The old site's shop settings were taken.");
        expect(report.notes.join(' ')).toContain('One order was brought');
        const db = into.database();
        expect((await db.rows<{ quantity: number }>('SELECT quantity FROM shop_stock')).map((r) => Number(r.quantity))).toEqual([9]);
        expect((await db.rows<{ code: string }>('SELECT code FROM shop_coupons')).map((r) => r.code)).toEqual(['TEN']);
        const [order] = await db.rows<{ number: number; secret: string }>('SELECT number, secret FROM shop_orders');
        expect(Number(order?.number)).toBe(1);
        // A new link for its buyer.
        expect(order?.secret).not.toBe((await from.database().rows<{ secret: string }>('SELECT secret FROM shop_orders'))[0]?.secret);
        // Again: nothing is replaced, and what was here is said.
        const again = await runContentImport(into, file, { fresh: false });
        expect(again.notes.join(' ')).toContain('This shop already has the coupons TEN');
        expect(again.notes.join(' ')).toContain('This shop already has orders numbered 1');
      } finally {
        await into.close();
      }

      // Into a site whose shop is off: nothing of the shop comes, and the report says how to bring it.
      const closed = await Store.open(join(dir, 'file-closed.db'));
      try {
        const report = await runContentImport(closed, readContentFile(JSON.stringify(all)), { fresh: false });
        expect(report.notes.join(' ')).toContain('The shop is off here, so its stock and coupons were not brought.');
        expect(report.notes.join(' ')).toContain('the shop is off here, so none was brought');
        expect(await closed.hasTable('shop_orders')).toBe(false);
        expect(await importShop(closed, { settings: normalizeShopSettings({}), stock: [], coupons: [] }, false)).toMatchObject({ off: true, settings: false });
        expect(await importOrders(closed, [])).toEqual({ added: 0, kept: [], off: true });
      } finally {
        await closed.close();
      }
    } finally {
      await from.close();
    }
  });
});
