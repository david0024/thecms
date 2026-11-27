/**
 * The shop, PR (b) (ADR 0065 d4–d7, d10): the cart in a cookie of its own,
 * checkout, paying by transfer or on delivery, delivery methods, orders with
 * their numbers, states and stock, the Orders screen and its CSV, a
 * visitor's orders in "My account", and the messages of an order, sent from
 * the site's one queue.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ibanOf, normalizeShopSettings, pageLink, shippingCost, vatIn } from '../src/core/index.ts';
import type { Mail } from '../src/site/mail.ts';
import { mailSchema } from '../src/site/mail-queue.ts';
import { startRuntime } from '../src/site/runtime.ts';
import { startEditor } from '../src/site/server.ts';
import { shopGate } from '../src/parts/shop/gate.ts';
import { shopSchema } from '../src/parts/shop/schema.ts';
import { totalsOf } from '../src/parts/shop/shop.ts';
import { Store, type User } from '../src/site/store.ts';
import plain from '../themes/plain.json';

const dir = await mkdtemp(join(tmpdir(), 'uhlaka-orders-'));
afterAll(() => rm(dir, { recursive: true, force: true }));
const text = (body: string) => ({ id: `b_${Math.random().toString(36).slice(2, 10)}`, type: 'text', content: { body: [{ type: 'paragraph', children: [{ text: body }] }] } });
const IBAN = 'RO49AAAA1B31007593840000';

async function site(name: string, languages: string[] = []): Promise<Store> {
  const store = await Store.open(join(dir, `${name}.db`));
  await store.setTheme(plain);
  await store.publishTheme();
  await store.setSite({ name: 'Atelier', url: 'https://example.com', language: 'en', languages });
  await store.savePage({ slug: '', title: 'Home', blocks: [text('Welcome.')] });
  await store.publish('');
  return store;
}

async function admin(store: Store, sent: Mail[] = []) {
  const editor = await startEditor(store, { listen: false, log: () => {}, mailer: async (mail) => void sent.push({ ...mail, subject: mail.subject.replace(/\u00a0/g, ' '), text: mail.text.replace(/\u00a0/g, ' ') }), from: 'site@example.com' });
  const call = async (method: string, path: string, body?: unknown): Promise<{ status: number; body: Record<string, unknown>; text: string }> => {
    const response = await editor.fetch(
      new Request(`http://127.0.0.1:4321${path}`, { method, headers: { host: '127.0.0.1:4321', 'x-uhlaka-token': editor.token, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }),
    );
    const text = (await response.text()).replace(/\u00a0/g, ' ');
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

/** A browser of one visitor: it keeps each cookie it is given, and follows nothing by itself. */
function browser(fetch: (request: Request) => Promise<Response>) {
  const jar = new Map<string, string>();
  const go = async (method: string, path: string, fields?: Record<string, string>, headers: Record<string, string> = {}): Promise<Response> => {
    const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const response = await fetch(
      new Request(`https://example.com${path}`, {
        method,
        headers: { ...(cookie ? { cookie } : {}), ...(fields ? { 'content-type': 'application/x-www-form-urlencoded' } : {}), ...headers },
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
  /** A page's text, its money with plain spaces. */
  const read = async (method: string, path: string, fields?: Record<string, string>, headers: Record<string, string> = {}): Promise<string> => (await (await go(method, path, fields, headers)).text()).replace(/\u00a0/g, ' ');
  return { go, read, cookies: () => jar };
}

/** A shop with a mug (4 left), a tee in two sizes and a card that is not counted, with two ways to deliver. */
async function shop(store: Store, call: Awaited<ReturnType<typeof admin>>['call']): Promise<void> {
  await call('PUT', '/api/shop', { on: true });
  await store.saveEntry('products', { title: 'Mug', product: { price: '50', counted: true, sku: 'MUG', vat: 21 } });
  await store.saveEntry('products', { title: 'Tee', product: { price: '80', options: [{ name: 'Size', values: ['S', 'M'] }], variants: { M: { price: '90' } }, counted: true, vat: 11 } });
  await store.saveEntry('products', { title: 'Card', product: { price: '5' } });
  await store.saveEntry('products', { title: 'Draft', product: { price: '1' } });
  for (const slug of ['mug', 'tee', 'card']) await store.publishEntry('products', slug);
  await call('PUT', '/api/shop/stock', { kind: 'products', slug: 'mug', stock: { '': 4 } });
  await call('PUT', '/api/shop/stock', { kind: 'products', slug: 'tee', stock: { S: 0, M: 2 } });
}

const ways = {
  transfer: { on: true, holder: 'Atelier SRL', iban: 'ro49 aaaa 1b31 0075 9384 0000', bank: 'Banca' },
  cod: true,
  shipping: [
    { name: 'Courier', price: '20', free: '200' },
    { name: 'Pick up', price: '0', pickup: 'Str. Lemnului 1, Cluj' },
  ],
  terms: '/terms/',
  notify: 'Owner@Example.com',
};

const buyer = { name: 'Ana Pop', email: 'ana@example.com', phone: '0722 000 000', street: 'Str. Mare 2', town: 'Cluj-Napoca', county: 'Cluj', postcode: '400000', shipping: 'm1', payment: 'transfer', terms: 'yes' };
const totalIn = (page: string): string => /name="total" value="(\d+)"/.exec(page)?.[1] as string;

describe('the shop’s words, settings and sums', () => {
  test('an IBAN is checked by its digits, and a link is a page or an address', () => {
    expect(ibanOf('ro49 aaaa 1b31 0075 9384 0000')).toBe(IBAN);
    expect(ibanOf('RO49AAAA1B31007593840001')).toBe('');
    expect(ibanOf('nonsense')).toBe('');
    expect(ibanOf(42)).toBe('');
    expect(pageLink('/terms/')).toBe('/terms/');
    expect(pageLink('https://example.com/t')).toBe('https://example.com/t');
    expect(pageLink('javascript:alert(1)')).toBe('');
    expect(pageLink('//evil.example')).toBe('');
  });

  test('the settings keep only what makes sense', () => {
    const s = normalizeShopSettings({
      on: true,
      transfer: { on: true, holder: '  Atelier   SRL ', iban: 'bad', bank: 'B' },
      cod: true,
      shipping: [{ name: 'A', price: '10', free: '0' }, { name: '', price: '1' }, 'x', { id: 'm1', name: 'B', price: 'x', free: '100', pickup: ' Here ' }, ...Array.from({ length: 12 }, (_, i) => ({ name: `N${i}` }))],
      terms: 'javascript:x',
      account: true,
      editors: true,
      notify: 'not an address',
    });
    // No IBAN, no transfer.
    expect(s.transfer).toEqual({ on: false, holder: 'Atelier SRL', iban: '', bank: 'B' });
    expect(s.shipping[0]).toEqual({ id: 'm1', name: 'A', price: 1000, free: null, pickup: '' });
    expect(s.shipping[1]).toEqual({ id: 'm2', name: 'B', price: 0, free: 10000, pickup: 'Here' });
    expect(s.shipping).toHaveLength(10);
    expect([s.terms, s.account, s.editors, s.notify, s.cod]).toEqual(['', true, true, '', true]);
  });

  test('the sums: VAT by rate, delivery at the first rate, free above its sum', () => {
    expect(vatIn(12100, 21)).toBe(2100);
    expect(vatIn(1000, 0)).toBe(0);
    const settings = normalizeShopSettings({ on: true, rates: [21, 11, 0] });
    const courier = { id: 'm1', name: 'Courier', price: 2000, free: 20000, pickup: '' };
    expect(shippingCost(courier, 19999)).toBe(2000);
    expect(shippingCost(courier, 20000)).toBe(0);
    const totals = totalsOf(
      [
        { price: 12100, quantity: 1, rate: 21 },
        { price: 11100, quantity: 1, rate: 11 },
        { price: 500, quantity: 2, rate: 0 },
      ],
      { ...courier, free: null },
      settings,
    );
    expect(totals).toEqual({ subtotal: 24200, shipping: 2000, total: 26200, vat: [[21, 2447], [11, 1100]] });
    expect(totalsOf([{ price: 100, quantity: 1, rate: 21 }], null, { ...settings, vat: false })).toEqual({ subtotal: 100, shipping: 0, total: 100, vat: [] });
  });

  test('the tables are made in the words of each database', () => {
    const [, carts, orders] = shopSchema('mysql');
    expect(carts).toContain('items LONGTEXT');
    expect(orders).toContain('number INTEGER NOT NULL UNIQUE');
    expect(orders).toContain('total BIGINT');
    expect(shopSchema('postgres')[2]).toContain('secret VARCHAR(64)');
    expect(mailSchema('sqlite')[0]).toContain('mail_queue (id TEXT PRIMARY KEY');
    expect(mailSchema('postgres')[0]).toContain('to_address VARCHAR(255)');
    expect(mailSchema('mysql')[0]).toContain('body LONGTEXT');
  });
});

describe('the shop, off', () => {
  test('has no cart, checkout or order, and makes no queue', async () => {
    const store = await site('off');
    const runtime = startRuntime(store, { listen: false, log: () => {} });
    try {
      for (const path of ['/_/cart', '/_/checkout', '/_/order/abcdefghijklmnopqrstuvwxyz']) expect((await runtime.fetch(new Request(`https://example.com${path}`))).status).toBe(404);
      expect((await runtime.fetch(new Request('https://example.com/_/cart', { method: 'POST' }))).status).toBe(404);
      await runtime.chores(new Date());
      expect(await store.hasTable('mail_queue')).toBe(false);
      expect(await store.hasTable('shop_orders')).toBe(false);
      expect(shopGate(store).loaded()).toBe(false);
      expect(await shopGate(store).ordersOf('someone', 'en')).toBe('');
    } finally {
      runtime.stop();
      await store.close();
    }
  });

  test('Settings → E-mail offers the order messages only while the shop is on', async () => {
    const store = await site('mails');
    const { editor, call } = await admin(store);
    try {
      expect((await call('GET', '/api/mail/templates')).body.names).not.toContain('orderPaid');
      await call('PUT', '/api/shop', { on: true });
      const shown = (await call('GET', '/api/mail/templates')).body as { names: string[]; defaults: Record<string, Record<string, { subject: string }>> };
      expect(shown.names).toContain('orderPaid');
      expect(shown.defaults.en?.orderNew?.subject).toBe('A new order: {number}, {total}');
      expect((await call('PUT', '/api/mail/templates', { language: 'en', name: 'orderPaid', subject: 'Paid: {number}', text: 'Thanks {name}, {total}.' })).status).toBe(200);
    } finally {
      editor.stop();
      await store.close();
    }
  });
});

describe('the cart and checkout', () => {
  test('a visitor fills a cart, places an order paid by transfer, and is told; the owner handles it', async () => {
    const store = await site('flow');
    const sent: Mail[] = [];
    const { editor, call } = await admin(store, sent);
    const runtime = startRuntime(store, { listen: false, log: () => {}, mailer: async (mail) => void sent.push({ ...mail, subject: mail.subject.replace(/\u00a0/g, ' '), text: mail.text.replace(/\u00a0/g, ' ') }), from: 'site@example.com' });
    try {
      await shop(store, call);
      const tab = browser((r) => runtime.fetch(r));

      // An empty cart.
      let page = await tab.read('GET', '/_/cart');
      expect(page).toContain('data-cart-empty');
      expect(page).toContain('<meta name="robots" content="noindex">');
      // Checkout with nothing in the cart leads back to it.
      expect((await tab.go('GET', '/_/checkout')).headers.get('location')).toBe('/_/cart');

      // A product that cannot be bought is not added, and no cart is made for it.
      let answer = await tab.go('POST', '/_/cart', { product: 'products/tee', variant: 'S', quantity: '1' });
      expect(answer.headers.get('location')).toBe('/_/cart?said=notadded');
      expect(tab.cookies().size).toBe(0);
      expect((await tab.go('POST', '/_/cart', { product: 'products/draft', quantity: '1' })).headers.get('location')).toBe('/_/cart?said=notadded');

      // From the Buy part: the cart is a cookie of its own, SameSite=Lax, kept 30 days.
      answer = await tab.go('POST', '/_/cart', { product: 'products/mug', quantity: '3' });
      expect(answer.status).toBe(303);
      expect(answer.headers.get('set-cookie')).toMatch(/^uhlaka_cart=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=2592000; Secure$/);
      await tab.go('POST', '/_/cart', { product: 'products/mug', quantity: '5' });
      await tab.go('POST', '/_/cart', { product: 'products/tee', variant: 'M', quantity: '1' });
      await tab.go('POST', '/_/cart', { product: 'products/card', quantity: '2' });
      expect((await tab.go('POST', '/_/cart', { product: 'products/tee', variant: 'XL', quantity: '1' })).headers.get('location')).toBe('/_/cart?said=notadded');

      page = await tab.read('GET', '/_/cart?said=added');
      expect(page).toContain('Added to your cart.');
      // Only 4 mugs are left: the cart holds 4.
      expect(page).toContain('name="q0" value="4"');
      expect(page).toContain('<a href="/products/mug/">Mug</a>');
      expect(page).toContain('M</small>');
      // 4 × 50 + 90 + 2 × 5 = 300; delivery chosen later.
      expect(page).toContain('RON 300.00');
      expect(page).toContain('of which VAT 21%');
      expect(page).toContain('data-cart-checkout');

      // No way to pay or deliver yet: checkout says the shop takes no orders.
      expect((await tab.go('GET', '/_/checkout')).status).toBe(503);
      expect((await call('PUT', '/api/shop', { transfer: { on: true, iban: 'RO00 nope' } })).status).toBe(400);
      expect((await call('PUT', '/api/shop', ways)).status).toBe(200);

      // Quantities changed, a line removed, a delivery chosen: the courier is free from 200.
      await tab.go('POST', '/_/cart', { q0: '2', q1: '1', q2: '0', shipping: 'm1' });
      page = await tab.read('GET', '/_/cart');
      expect(page).not.toContain('Card');
      expect(page).toContain('Delivery (Courier)');
      expect(page).toContain('RON 190.00');
      expect(page).toContain('RON 20.00');
      await tab.go('POST', '/_/cart', { remove: '1' });
      page = await tab.read('GET', '/_/cart');
      expect(page).not.toContain('Tee');


      page = await tab.read('GET', '/_/checkout');
      expect(page).toContain('Bank transfer');
      expect(page).toContain('Cash on delivery');
      expect(page).toContain('value="m1" checked');
      expect(page).toContain('<a href="/terms/">');
      expect(totalIn(page)).toBe('12000');

      // What is missing is said, and what was typed is kept.
      answer = await tab.go('POST', '/_/checkout', { ...buyer, street: '', terms: '', total: '12000' });
      expect(answer.status).toBe(400);
      page = (await answer.text()).replace(/\u00a0/g, ' ');
      expect(page).toContain('value="Ana Pop"');
      expect(page).toContain('name="street" type="text" aria-invalid="true"');
      // A company needs its name and tax code.
      expect((await tab.go('POST', '/_/checkout', { ...buyer, company: 'yes', total: '12000' })).status).toBe(400);
      // A total that is no longer what was shown is shown again first.
      expect((await tab.go('POST', '/_/checkout', { ...buyer, total: '100' })).status).toBe(409);
      // A form of another site is refused.
      expect((await tab.go('POST', '/_/checkout', { ...buyer, total: '12000' }, { origin: 'https://evil.example' })).status).toBe(403);

      answer = await tab.go('POST', '/_/checkout', { ...buyer, company: 'yes', companyName: 'Pop SRL', taxCode: 'RO123', registration: 'J12/1/2020', note: 'Ring twice', total: '12000' });
      expect(answer.status).toBe(303);
      const location = answer.headers.get('location') as string;
      expect(location).toMatch(/^\/_\/order\/[A-Za-z0-9_-]{43}\?said=placed$/);
      // The cart is gone with its cookie.
      expect(tab.cookies().has('uhlaka_cart')).toBe(false);
      expect(await tab.read('GET', '/_/cart')).toContain('data-cart-empty');

      page = await tab.read('GET', location);
      expect(page).toContain('Order 1');
      expect(page).toContain('Thank you! Your order is placed');
      expect(page).toContain('data-order-state="waiting"');
      expect(page).toContain(`into account ${IBAN} (Banca), held by Atelier SRL, with “Order 1”`);
      expect(page).toContain('Pop SRL');
      expect(page).toContain('Ring twice');
      expect((await tab.go('GET', location)).headers.get('referrer-policy')).toBe('no-referrer');
      expect((await tab.go('GET', '/_/order/nothing-here-at-all-nothing')).status).toBe(404);

      // The stock was taken.
      expect((await call('GET', '/api/shop/stock?kind=products&slug=mug')).body).toEqual({ stock: { '': 2 } });

      // The buyer and the owner are told, through the queue the clock sends.
      await runtime.chores(new Date());
      const received = sent.find((m) => m.to === 'ana@example.com');
      expect(received?.subject).toBe('Your order 1 on Atelier');
      expect(received?.text).toContain('2 × Mug: RON 100.00');
      expect(received?.text).toContain(IBAN);
      expect(received?.text).toContain(`https://example.com${location.replace('?said=placed', '')}`);
      expect(sent.find((m) => m.to === 'owner@example.com')?.subject).toBe('A new order: 1, RON 120.00');

      // The Orders screen.
      const listed = (await call('GET', '/api/shop/orders')).body.orders as { id: string; number: number; state: string; total: number; name: string }[];
      expect(listed.map((o) => [o.number, o.state, o.total, o.name])).toEqual([[1, 'waiting', 12000, 'Ana Pop']]);
      expect(((await call('GET', '/api/shop/orders?state=paid')).body.orders as unknown[]).length).toBe(0);
      const id = (listed[0] as { id: string }).id;
      const one = (await call('GET', `/api/shop/orders?id=${id}`)).body.order as { data: { lines: { sku: string }[]; buyer: { company: { taxCode: string } } } };
      expect(one.data.lines[0]?.sku).toBe('MUG');
      expect(one.data.buyer.company.taxCode).toBe('RO123');
      expect((await call('GET', '/api/shop/orders?id=nope')).status).toBe(404);
      expect((await call('PUT', '/api/shop/orders', { id, state: 'lost' })).status).toBe(400);
      expect((await call('DELETE', `/api/shop/orders?id=${id}`)).status).toBe(404);

      // Paid, then sent with its tracking number: each told to the buyer.
      sent.length = 0;
      expect((await call('PUT', '/api/shop/orders', { id, state: 'paid' })).status).toBe(200);
      expect((await call('PUT', '/api/shop/orders', { id, state: 'sent', tracking: ' AWB 123 ' })).status).toBe(200);
      await runtime.chores(new Date());
      expect(sent.map((m) => m.subject)).toEqual(['Order 1 is paid', 'Order 1 is on its way']);
      expect(sent[1]?.text).toContain('AWB 123');
      page = await tab.read('GET', location);
      expect(page).toContain('Tracking number: AWB 123');
      expect(page).not.toContain('data-order-pay');

      const csv = await call('GET', '/api/shop/orders.csv');
      expect(csv.text.startsWith('﻿number,date,state')).toBe(true);
      expect(csv.text).toContain('1,');
      expect(csv.text).toContain('"Str. Mare 2, 400000, Cluj-Napoca, Cluj"');
      expect(csv.text).toContain('2 × Mug');
      expect(csv.text).toContain(',120.00,RON,transfer,AWB 123');
      expect((await call('POST', '/api/shop/orders.csv', {})).status).toBe(404);

      // Cancelled: the stock comes back, the buyer is told, and it stays cancelled.
      sent.length = 0;
      expect((await call('PUT', '/api/shop/orders', { id, state: 'cancelled' })).status).toBe(200);
      expect((await call('GET', '/api/shop/stock?kind=products&slug=mug')).body).toEqual({ stock: { '': 4 } });
      expect((await call('PUT', '/api/shop/orders', { id, state: 'paid' })).status).toBe(409);
      await runtime.chores(new Date());
      expect(sent.map((m) => m.subject)).toEqual(['Order 1 is cancelled']);
      const history = ((await call('GET', `/api/shop/orders?id=${id}`)).body.order as { data: { history: { state: string }[] } }).data.history.map((h) => h.state);
      expect(history).toEqual(['waiting', 'paid', 'sent', 'cancelled']);
    } finally {
      runtime.stop();
      editor.stop();
      await store.close();
    }
  });

  test('cash on delivery, picked up: no address asked, numbers follow, and the last one is bought once', async () => {
    const store = await site('last');
    const { editor, call } = await admin(store);
    // The runtime asks whether the site changed at most once a second: here, a clock moved by hand.
    let clock = 0;
    const runtime = startRuntime(store, { listen: false, log: () => {}, now: () => clock });
    try {
      await shop(store, call);
      await call('PUT', '/api/shop', { ...ways, vat: false });
      await call('PUT', '/api/shop/stock', { kind: 'products', slug: 'mug', stock: { '': 1 } });
      const first = browser((r) => runtime.fetch(r));
      const second = browser((r) => runtime.fetch(r));
      for (const tab of [first, second]) await tab.go('POST', '/_/cart', { product: 'products/mug', quantity: '1' });
      const pickup = { name: 'Ion', email: 'ion@example.com', phone: '+40 722 111 222', shipping: 'm2', payment: 'cod', terms: 'yes' };
      const page = await first.read('GET', '/_/checkout');
      expect(page).toContain('Picked up at Str. Lemnului 1, Cluj');
      expect(page).not.toContain('of which VAT');
      // Both place it at once: one has it, the other finds none left.
      const [placed, short] = await Promise.all([first.go('POST', '/_/checkout', { ...pickup, total: '5000' }), second.go('POST', '/_/checkout', { ...pickup, total: '5000' })]);
      expect(placed.status).toBe(303);
      expect(short.status).toBe(409);
      expect(await short.text()).toContain('Not enough is left of “Mug”');
      // The mug ran out: its page is built again, and says so.
      clock += 2000;
      expect(await (await runtime.fetch(new Request('https://example.com/products/mug/'))).text()).toContain('Out of stock');
      // A cart that now holds what is gone says so, and leads back to it.
      expect(await second.read('GET', '/_/cart')).toContain('Mug: Out of stock');

      // Paid on delivery, it is prepared at once.
      const order = await first.read('GET', placed.headers.get('location') as string);
      expect(order).toContain('data-order-state="preparing"');
      expect(order).toContain('You pay RON 50.00 when the order is delivered.');
      expect(order).toContain('Picked up at Str. Lemnului 1, Cluj');

      // A cancelled order whose product is no longer counted gives nothing back.
      const third = browser((r) => runtime.fetch(r));
      await third.go('POST', '/_/cart', { product: 'products/card', quantity: '1' });
      expect((await third.go('POST', '/_/checkout', { ...pickup, total: '500' })).status).toBe(303);
      const orders = (await call('GET', '/api/shop/orders')).body.orders as { id: string; number: number }[];
      expect(orders.map((o) => o.number)).toEqual([2, 1]);
      expect((await call('PUT', '/api/shop/orders', { id: orders[0]?.id, state: 'cancelled' })).status).toBe(200);
    } finally {
      runtime.stop();
      editor.stop();
      await store.close();
    }
  });

  test('a cart nobody came back to is forgotten after 30 days', async () => {
    const store = await site('old');
    const { editor, call } = await admin(store);
    const runtime = startRuntime(store, { listen: false, log: () => {} });
    try {
      await shop(store, call);
      const tab = browser((r) => runtime.fetch(r));
      await tab.go('POST', '/_/cart', { product: 'products/card', quantity: '1' });
      await runtime.chores(new Date(Date.now() + 29 * 86_400_000));
      expect(await tab.read('GET', '/_/cart')).toContain('Card');
      await runtime.chores(new Date(Date.now() + 31 * 86_400_000));
      expect(await tab.read('GET', '/_/cart')).toContain('data-cart-empty');
    } finally {
      runtime.stop();
      editor.stop();
      await store.close();
    }
  });
});

describe('orders and visitor accounts', () => {
  test('a visitor signed in buys with their details filled in, and sees their orders in My account', async () => {
    const store = await site('members', ['ro']);
    const sent: Mail[] = [];
    const { editor, call } = await admin(store, sent);
    const runtime = startRuntime(store, { listen: false, log: () => {}, mailer: async (mail) => void sent.push({ ...mail, subject: mail.subject.replace(/\u00a0/g, ' '), text: mail.text.replace(/\u00a0/g, ' ') }), from: 'site@example.com' });
    try {
      await shop(store, call);
      await call('PUT', '/api/shop', { ...ways, account: true });
      const tab = browser((r) => runtime.fetch(r));
      await tab.go('POST', '/_/cart', { product: 'products/card', quantity: '1', language: 'ro' });
      // Accounts off: an account cannot be required, and anyone buys.
      expect((await tab.go('GET', '/_/checkout')).status).toBe(200);

      await call('PUT', '/api/visitors', { on: true, signup: 'open' });
      let answer = await tab.go('GET', '/_/checkout?l=ro');
      expect(answer.status).toBe(403);
      expect(await answer.text()).toContain('/_/account?back=%2F_%2Fcheckout%3Fl%3Dro&amp;l=ro');

      // Signed up and confirmed through the link sent.
      await tab.go('POST', '/_/account/signup', { name: 'Ion', email: 'ion@example.com', password: 'long enough pass', consent: 'yes' });
      await runtime.chores(new Date());
      const k = /k=([A-Za-z0-9_-]+)/.exec(sent.find((m) => m.to === 'ion@example.com')?.text ?? '')?.[1] as string;
      expect((await tab.go('POST', '/_/account/link', { k })).status).toBe(303);

      const page = await tab.read('GET', '/_/checkout?l=ro');
      expect(page).toContain('Comanda');
      expect(page).toContain('value="Ion"');
      expect(page).toContain('value="ion@example.com"');
      answer = await tab.go('POST', '/_/checkout?l=ro', { name: 'Ion', email: 'ion@example.com', phone: '0722000000', shipping: 'm2', payment: 'transfer', terms: 'yes', total: '500' });
      expect(answer.status).toBe(303);
      expect(answer.headers.get('location')).toMatch(/\?l=ro&said=placed$/);

      const mine = await tab.read('GET', '/_/account');
      expect(mine).toContain('Your orders');
      expect(mine).toMatch(/<a href="\/_\/order\/[A-Za-z0-9_-]{43}">Order 1<\/a>/);
      expect(mine).toContain('Waiting for payment');

      // Told in Romanian, the language it was placed in.
      await runtime.chores(new Date());
      expect(sent.some((m) => m.subject === 'Comanda ta 1 pe Atelier')).toBe(true);
    } finally {
      runtime.stop();
      editor.stop();
      await store.close();
    }
  });
});

describe('who handles orders', () => {
  test('the owner; an editor only when the owner allows it; nobody else', async () => {
    const store = await site('who');
    const { editor, call } = await admin(store);
    try {
      await call('PUT', '/api/shop', { on: true });
      const gate = shopGate(store);
      const as = (role: User['role']) => ({ id: role, email: `${role}@example.com`, name: role, role, active: true }) as User;
      const ask = (role: User['role']) => gate.admin(new Request('https://x/api/shop/orders'), new URL('https://x/api/shop/orders'), as(role), {});
      expect((await ask('editor')).status).toBe(403);
      expect((await ask('author')).status).toBe(403);
      await call('PUT', '/api/shop', { editors: true });
      expect((await ask('editor')).status).toBe(200);
      expect((await ask('author')).status).toBe(403);
      expect(((await call('GET', '/api/state')).body.shop as { editors: boolean }).editors).toBe(true);
    } finally {
      editor.stop();
      await store.close();
    }
  });
});
