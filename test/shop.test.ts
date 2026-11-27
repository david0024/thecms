/**
 * The shop (ADR 0065, PR a): off, it costs nothing; on, a type sells, its
 * entries carry a price, variants and stock, and a product's page says its
 * price and offers "Add to cart" only while the shop is on and the site is
 * served.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { combinations, moneyOf, moneyText, normalizeProduct, normalizeRates, normalizeShopSettings, normalizeTypes, paid, priceOf, rateFor, SHOP_OFF, typedMoney } from '../src/core/index.ts';
import { exportedFiles } from '../src/site/export.ts';
import { startRuntime } from '../src/site/runtime.ts';
import { startEditor } from '../src/site/server.ts';
import { shopGate } from '../src/site/shop-gate.ts';
import { SHOP_TABLES, shopSchema } from '../src/site/shop-schema.ts';
import { Store } from '../src/site/store.ts';
import plain from '../themes/plain.json';

const dir = await mkdtemp(join(tmpdir(), 'uhlaka-shop-'));
afterAll(() => rm(dir, { recursive: true, force: true }));
const text = (body: string) => ({ id: `b_${Math.random().toString(36).slice(2, 10)}`, type: 'text', content: { body: [{ type: 'paragraph', children: [{ text: body }] }] } });

async function site(name: string, language = 'en'): Promise<Store> {
  const store = await Store.open(join(dir, `${name}.db`));
  await store.setTheme(plain);
  await store.publishTheme();
  await store.setSite({ name: 'Atelier', url: 'https://example.com', language });
  await store.savePage({ slug: '', title: 'Home', blocks: [text('Welcome.')] });
  await store.publish('');
  return store;
}

async function admin(store: Store) {
  const editor = await startEditor(store, { listen: false, log: () => {} });
  const call = async (method: string, path: string, body?: unknown): Promise<{ status: number; body: Record<string, unknown> }> => {
    const response = await editor.fetch(
      new Request(`http://127.0.0.1:4321${path}`, { method, headers: { host: '127.0.0.1:4321', 'x-uhlaka-token': editor.token, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }),
    );
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };
  return { editor, call };
}

describe('money and products', () => {
  test('a sum is read in the smallest unit, as people type it', () => {
    expect(moneyOf('49,99')).toBe(4999);
    expect(moneyOf('49.9')).toBe(4990);
    expect(moneyOf('1 250')).toBe(125000);
    expect(moneyOf(' 7 ')).toBe(700);
    expect(moneyOf('-3')).toBeNull();
    expect(moneyOf('3.999')).toBeNull();
    expect(moneyOf('abc')).toBeNull();
    expect(moneyOf(12.5)).toBeNull();
    expect(moneyOf(1250)).toBe(1250);
    expect(moneyOf(null)).toBeNull();
    expect(typedMoney(4999)).toBe('49.99');
    expect(typedMoney(5000)).toBe('50');
    expect(typedMoney(null)).toBe('');
    expect(moneyText(4999, 'RON', 'ro')).toContain('49,99');
    expect(moneyText(4999, '??', 'en')).toBe('49.99 ??');
  });

  test('a product keeps a sale only below its price, and a variant only when it changes something', () => {
    const p = normalizeProduct({
      price: '100',
      sale: '120',
      sku: ' TEE ',
      vat: '11',
      counted: true,
      options: [
        { name: 'Size', values: 'S, M, M, L' },
        { name: 'Colour', values: ['Red', 'Blue/Green'] },
        { name: 'Size', values: ['XL'] },
        { name: '', values: ['x'] },
      ],
      variants: { 'L / Red': { price: '110', sale: '105', sku: 'TEE-LR' }, 'S / Red': { sale: '90' }, 'M / Red': {}, 'XXL / Red': { price: '1' } },
    });
    expect(p.price).toBe(10000);
    expect(p.sale).toBeNull();
    expect(p.sku).toBe('TEE');
    expect(p.vat).toBe(11);
    expect(p.options).toEqual([
      { name: 'Size', values: ['S', 'M', 'L'] },
      { name: 'Colour', values: ['Red', 'Blue-Green'] },
    ]);
    expect(combinations(p.options)).toEqual(['S / Red', 'S / Blue-Green', 'M / Red', 'M / Blue-Green', 'L / Red', 'L / Blue-Green']);
    expect(Object.keys(p.variants).sort()).toEqual(['L / Red', 'S / Red']);
    expect(priceOf(p, 'L / Red')).toEqual({ price: 11000, sale: 10500, sku: 'TEE-LR' });
    expect(priceOf(p, 'S / Red')).toEqual({ price: 10000, sale: 9000, sku: 'TEE' });
    expect(priceOf(p, 'M / Blue-Green')).toEqual({ price: 10000, sale: null, sku: 'TEE' });
    expect(paid(priceOf(p, 'S / Red'))).toBe(9000);
    // A product with no price yet, or of a type whose rate is gone, still reads.
    const empty = normalizeProduct('nothing');
    expect(empty).toEqual({ price: null, sale: null, sku: '', vat: null, counted: false, options: [], variants: {} });
    expect(rateFor(empty, [19, 9])).toBe(19);
    expect(rateFor(p, [21, 11])).toBe(11);
    expect(rateFor(p, [21])).toBe(21);
    expect(rateFor(p, [])).toBe(0);
    expect(combinations([])).toEqual([]);
  });

  test('a product is sold in at most a hundred combinations', () => {
    const many = (name: string) => ({ name, values: Array.from({ length: 20 }, (_, i) => `${name}${i}`) });
    const p = normalizeProduct({ options: [many('a'), many('b'), { name: 'c', values: ['1', '2'] }] });
    expect(p.options.map((o) => o.name)).toEqual(['a', 'c']);
  });

  test('the settings and the rates are cleaned', () => {
    expect(normalizeRates(['21', 9.5, 9.5, '200', -1, 'x'])).toEqual([21, 9.5]);
    expect(normalizeRates([])).toEqual([21, 11, 0]);
    expect(normalizeShopSettings(null)).toEqual(SHOP_OFF);
    expect(normalizeShopSettings({ on: true, vat: false, rates: [19] })).toEqual({ ...SHOP_OFF, on: true, vat: false, rates: [19] });
  });

  test('the tables are made in the words of each database', () => {
    expect(shopSchema('sqlite')[0]).toContain('id TEXT PRIMARY KEY');
    expect(shopSchema('postgres')[0]).toContain('id VARCHAR(64) PRIMARY KEY, product VARCHAR(255) NOT NULL, variant VARCHAR(255)');
    expect(shopSchema('mysql')[0]).toEndWith('COLLATE=utf8mb4_bin');
  });

  test('a type that sells is one of products', () => {
    const [type] = normalizeTypes([{ name: 'Courses', sells: true, schema: 'event' }]);
    expect(type?.sells).toBe(true);
    expect(type?.schema).toBe('product');
  });
});

describe('the shop, off', () => {
  test('costs nothing: no tables, nothing loaded, no Buy part, the admin says it is off', async () => {
    const store = await site('off');
    const { editor, call } = await admin(store);
    try {
      const state = await call('GET', '/api/state');
      expect((state.body as { shop: { on: boolean } }).shop.on).toBe(false);
      expect((await call('GET', '/api/shop')).body).toEqual({ settings: SHOP_OFF });
      expect((await call('GET', '/api/shop/stock?kind=x&slug=y')).status).toBe(404);
      for (const table of SHOP_TABLES) expect(await store.hasTable(table)).toBe(false);
      expect(shopGate(store).loaded()).toBe(false);
      expect(await shopGate(store).shown()).toBeNull();
    } finally {
      editor.stop();
      await store.close();
    }
  });
});

describe('the shop, on', () => {
  test('turning it on makes its tables and a type of products, in the site language', async () => {
    const store = await site('on', 'ro');
    const { editor, call } = await admin(store);
    try {
      const turned = await call('PUT', '/api/shop', { on: true, rates: [21, 11] });
      expect(turned.status).toBe(200);
      for (const table of SHOP_TABLES) expect(await store.hasTable(table)).toBe(true);
      const types = (await store.site()).types.filter((t) => t.sells);
      expect(types.map((t) => [t.name, t.singular, t.path, t.schema])).toEqual([['Produse', 'Produs', 'produse', 'product']]);
      // Turned on again, no second type is made.
      await call('PUT', '/api/shop', { on: false });
      await call('PUT', '/api/shop', { on: true });
      expect((await store.site()).types.filter((t) => t.sells)).toHaveLength(1);
    } finally {
      editor.stop();
      await store.close();
    }
  });

  test('the type of products takes an address no one has', async () => {
    const store = await site('taken');
    await store.savePage({ slug: 'products', title: 'Products page', blocks: [] });
    const { editor, call } = await admin(store);
    try {
      expect((await call('PUT', '/api/shop', { on: true })).status).toBe(200);
      expect((await store.site()).types.find((t) => t.sells)?.path).toBe('products-2');
    } finally {
      editor.stop();
      await store.close();
    }
  });

  test('only the owner changes the settings', async () => {
    const store = await site('owner');
    const gate = shopGate(store);
    const editor = { id: 'e', email: 'e@example.com', name: 'E', role: 'editor' as const, active: true };
    const answer = await gate.admin(new Request('https://x/api/shop', { method: 'PUT' }), new URL('https://x/api/shop'), editor as never, { on: true });
    expect(answer.status).toBe(403);
    expect((await gate.admin(new Request('https://x/api/shop', { method: 'POST' }), new URL('https://x/api/shop'), editor as never, {})).status).toBe(404);
    await store.close();
  });

  test('a product is written, its stock set, and its page offers it', async () => {
    const store = await site('product');
    const { editor, call } = await admin(store);
    // The runtime asks whether the site changed at most once a second: here, a clock moved by hand.
    let clock = 0;
    const later = (): void => {
      clock += 2000;
    };
    const runtime = startRuntime(store, { listen: false, log: () => {}, now: () => clock });
    try {
      await call('PUT', '/api/shop', { on: true });
      await store.setSite({ ...(await store.site()), business: { currency: 'EUR' } });
      await store.saveEntry('products', { title: 'Mug', product: { price: '12,50', sale: '10', counted: true, sku: 'MUG' } });
      await store.saveEntry('products', { title: 'Tee', product: { price: '20', options: [{ name: 'Size', values: ['S', 'M'] }], variants: { M: { price: '25' } }, counted: true } });
      await store.saveEntry('products', { title: 'Card', product: { price: '3' } });
      for (const slug of ['mug', 'tee', 'card']) await store.publishEntry('products', slug);

      // Nothing counted yet: the mug cannot be bought.
      let page = await (await runtime.fetch(new Request('https://example.com/products/mug/'))).text();
      expect(page).toContain('action="/_/cart"');
      expect(page).toContain('Out of stock');
      expect(page).toMatch(/<button type="submit" disabled/);
      expect(page).toContain('"@type":"Product"');
      expect(page).toContain('OutOfStock');

      const set = await call('PUT', '/api/shop/stock', { kind: 'products', slug: 'mug', stock: { '': '4', other: 9 } });
      expect(set.body).toEqual({ stock: { '': 4 } });
      expect((await call('GET', '/api/shop/stock?kind=products&slug=mug')).body).toEqual({ stock: { '': 4 } });
      await call('PUT', '/api/shop/stock', { kind: 'products', slug: 'tee', stock: { S: 0, M: 2 } });
      expect((await call('PUT', '/api/shop/stock', { kind: 'nothing', slug: 'mug', stock: {} })).status).toBe(404);
      expect((await call('PUT', '/api/shop/stock', { kind: 'products', slug: 'none', stock: {} })).status).toBe(404);
      expect((await call('DELETE', '/api/shop/stock?kind=products&slug=mug')).status).toBe(404);
      expect((await call('GET', '/api/shop/other')).status).toBe(404);

      later();
      page = await (await runtime.fetch(new Request('https://example.com/products/mug/'))).text();
      expect(page).toContain('In stock');
      expect(page).toContain('<del>');
      expect(page).toContain('€10.00');
      expect(page).toContain('VAT included');
      expect(page).toContain('name="product" value="products/mug"');
      expect(page).toContain('"price":10');
      expect(page).toContain('InStock');

      const tee = await (await runtime.fetch(new Request('https://example.com/products/tee/'))).text();
      expect(tee).toContain('From €20.00');
      expect(tee).toContain('<option value="S" disabled');
      expect(tee).toContain('<option value="M">M — €25.00</option>');
      expect(tee).toContain('AggregateOffer');

      // Not counted: always there, and nothing said of stock.
      const card = await (await runtime.fetch(new Request('https://example.com/products/card/'))).text();
      expect(card).toContain('€3.00');
      expect(card).not.toContain('buy-stock');

      // A static export has no cart.
      const files = await exportedFiles(store);
      expect(String(files.get('products/mug/index.html'))).not.toContain('/_/cart');

      // Turned off, the pages show no Buy part; the products stay.
      await call('PUT', '/api/shop', { on: false, vat: false });
      later();
      page = await (await runtime.fetch(new Request('https://example.com/products/mug/'))).text();
      expect(page).not.toContain('/_/cart');
      expect(page).toContain('Mug');
    } finally {
      runtime.stop();
      editor.stop();
      await store.close();
    }
  });

  test('a type page places the Buy part where the owner puts it', async () => {
    const store = await site('template');
    const { editor, call } = await admin(store);
    const runtime = startRuntime(store, { listen: false, log: () => {} });
    try {
      await call('PUT', '/api/shop', { on: true, vat: false });
      await store.saveEntry('products', { title: 'Lamp', product: { price: '80' } });
      await store.publishEntry('products', 'lamp');
      await store.setTemplate('products', [
        { id: 'b_title', type: 'entry', content: { part: 'title' } },
        { id: 'b_buy', type: 'entry', content: { part: 'buy' } },
      ]);
      await store.publishTemplate('products');
      const page = await (await runtime.fetch(new Request('https://example.com/products/lamp/'))).text();
      expect(page).toContain('action="/_/cart"');
      expect(page).not.toContain('VAT included');
    } finally {
      runtime.stop();
      editor.stop();
      await store.close();
    }
  });
});
