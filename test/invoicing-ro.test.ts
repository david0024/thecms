/**
 * Invoicing for Romania (ADR 0081 d4): the shop's invoices made by the
 * owner's Oblio account. Oblio's API is answered here, as its documentation
 * describes it; the first invoices must still be tried on a real account.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXTENSION_FORMAT, extensionAsks, normalizeShopSettings, parseExtension } from '../src/core/index.ts';
import type { Invoicer } from '../src/parts/shop/pages.ts';
import { openShop } from '../src/parts/shop/shop.ts';
import { importOrders } from '../src/parts/shop/transfer.ts';
import { extensionHost } from '../src/site/extensions.ts';
import { Store, type User } from '../src/site/store.ts';
import { packExtension } from '../tools/pack-extension.ts';
import type { Order } from '../extensions/invoicing-ro/index.ts';
import { actions } from '../extensions/invoicing-ro/index.ts';
import { collectOf, deliveryRate, invoiceOf, stornoOf } from '../extensions/invoicing-ro/oblio.ts';
import manifest from '../extensions/invoicing-ro/manifest.json';
import { courierHost, PDF, type Reply } from './fixtures/courier-host.ts';

const account = { app: 'oblio', email: 'shop@example.com', secret: 's3cret', cif: 'RO37311090', series: 'UH', storno_series: '', management: '', collect: true };

const anOrder = (over: Partial<Order> = {}): Order => ({
  id: 'o1',
  number: 7,
  state: 'paid',
  email: 'ana@example.com',
  language: 'ro',
  buyer: { name: 'Ana Pop', email: 'ana@example.com', phone: '0722000000', street: 'Str. Mare 2', town: 'Cluj-Napoca', county: 'Cluj', postcode: '400000', company: null },
  lines: [
    { name: 'Mug', sku: 'M1', price: 5000, quantity: 2, rate: 21 },
    { name: 'Carte', sku: '', price: 3000, quantity: 1, rate: 11 },
  ],
  shipping: { id: 'm1', name: 'Curier', price: 2000, pickup: '' },
  payment: 'transfer',
  totals: { subtotal: 13000, coupon: 'TOAMNA', discount: 1300, shipping: 2000, total: 13700, vat: [[21, 1900], [11, 268]] },
  currency: 'RON',
  vat: true,
  ...over,
});

/** Oblio, as its API answers. */
const oblioReplies =
  (over: Partial<Record<string, ReturnType<Reply>>> = {}): Reply =>
  (url, init) => {
    const path = url.pathname;
    if (over[path]) return over[path];
    if (path === '/api/authorize/token') return { body: { access_token: 'tok-1', expires_in: '3600', token_type: 'Bearer' } };
    if (path === '/api/docs/invoice' && init.method === 'POST') {
      const storno = (JSON.parse(init.body) as { referenceDocument?: unknown }).referenceDocument;
      return { body: { status: 200, statusMessage: 'Success', data: { seriesName: storno ? 'ST' : 'UH', number: storno ? '0002' : '0053', link: 'https://www.oblio.eu/utils/show_file/?ic=1&id=2&it=3' } } };
    }
    if (path === '/utils/show_file/') return { body: '', base64: PDF };
    return { status: 404, body: { status: 404, statusMessage: 'Not found' } };
  };

describe('the Invoicing (Romania) extension', () => {
  test('is a valid extension of the fourth format that answers both questions, reading the order', () => {
    const { problems, pkg } = parseExtension({ format: EXTENSION_FORMAT, manifest, code: 'export const actions = {}' });
    expect(problems).toEqual([]);
    for (const a of pkg!.manifest.actions) expect(Object.keys(actions)).toContain(a.name);
    expect(pkg!.manifest.egress).toEqual(['www.oblio.eu']);
    expect(pkg!.manifest.answers.map((a) => [a.question, a.action])).toEqual([
      ['invoice.make', 'make'],
      ['invoice.storno', 'storno'],
    ]);
    const asks = extensionAsks(pkg!.manifest);
    expect(asks.invoices).toBe(true);
    expect(asks.shop).toBe(true);
    // Nothing besides the order: no file of its own, no other data of the program.
    expect(pkg!.manifest.uses).toEqual(['orders']);
    expect(pkg!.manifest.actions.every((a) => !a.files && !a.on)).toBe(true);
  });

  test('the invoice asked of Oblio: the buyer, each line with its VAT, the coupon, delivery, how it was paid', () => {
    const body = invoiceOf(anOrder(), account as never);
    expect(body).toMatchObject({
      cif: 'RO37311090',
      seriesName: 'UH',
      currency: 'RON',
      language: 'RO',
      mentions: 'Comanda 7',
      orderNumber: '7',
      idempotencyKey: 'uhlaka-o1-invoice',
      client: { name: 'Ana Pop', address: 'Str. Mare 2', state: 'Cluj', city: 'Cluj-Napoca', country: 'Romania', email: 'ana@example.com', phone: '0722000000' },
      collect: { type: 'Ordin de plata', documentNumber: 'Comanda 7' },
    });
    // A person: no tax code.
    expect((body.client as Record<string, unknown>).cif).toBeUndefined();
    expect(body.products).toEqual([
      { name: 'Mug', code: 'M1', price: 50, measuringUnit: 'buc', quantity: 2, vatPercentage: 21, vatIncluded: 1, save: 0 },
      { name: 'Carte', price: 30, measuringUnit: 'buc', quantity: 1, vatPercentage: 11, vatIncluded: 1, save: 0 },
      { name: 'Cupon TOAMNA', discount: 13, discountType: 'valoric', discountAllAbove: 1 },
      { name: 'Curier', price: 20, measuringUnit: 'buc', quantity: 1, vatPercentage: 21, vatIncluded: 1, save: 0 },
    ]);
    expect(body.useStock).toBeUndefined();
  });

  test('a company, stock kept by the app, VAT not charged, nothing collected', () => {
    const company = anOrder({ buyer: { ...anOrder().buyer, company: { name: 'Ana SRL', taxCode: 'RO123', registration: 'J12/1/2020' } }, vat: false, totals: { subtotal: 13000, shipping: 0, total: 13000, vat: [] }, state: 'waiting' });
    const body = invoiceOf(company, { ...account, management: 'Depozit' } as never);
    expect(body.client).toMatchObject({ name: 'Ana SRL', cif: 'RO123', rc: 'J12/1/2020', contact: 'Ana Pop' });
    expect(body.useStock).toBe(1);
    expect(body.collect).toBeUndefined();
    const products = body.products as Record<string, unknown>[];
    expect(products).toHaveLength(2);
    expect(products[0]).toMatchObject({ management: 'Depozit', productType: 'Marfa', vatIncluded: 1 });
    expect(products[0]!.vatPercentage).toBeUndefined();
    // The owner asked not to mark them collected.
    expect(invoiceOf(anOrder(), { ...account, collect: false } as never).collect).toBeUndefined();
  });

  test('how it was paid, as Oblio names it, and the rate of delivery', () => {
    expect(collectOf(anOrder({ payment: 'stripe:card' }))?.type).toBe('Card');
    expect(collectOf(anOrder({ payment: 'cod', state: 'sent' }))).toBeNull();
    expect(collectOf(anOrder({ payment: 'cod', state: 'completed' }))?.type).toBe('Ramburs');
    expect(collectOf(anOrder({ state: 'waiting' }))).toBeNull();
    expect(deliveryRate(anOrder())).toBe(21);
    expect(deliveryRate(anOrder({ vat: false }))).toBe(0);
  });

  test('the storno names the invoice it cancels, in the storno series', () => {
    expect(stornoOf(anOrder(), { ...account, storno_series: 'ST' } as never, { series: 'UH', number: '0053' })).toEqual({
      cif: 'RO37311090',
      seriesName: 'ST',
      referenceDocument: { type: 'Factura', refund: 1, seriesName: 'UH', number: '0053' },
      mentions: 'Storno, comanda 7',
      idempotencyKey: 'uhlaka-o1-storno',
    });
    expect(stornoOf(anOrder(), account as never, { series: 'UH', number: '1' }).seriesName).toBe('UH');
  });

  test('makes the invoice in Oblio: a token, the invoice, its PDF from the link', async () => {
    const { host, calls } = courierHost(account, oblioReplies());
    const made = await actions.make({ question: 'invoice.make', order: anOrder() }, host);
    expect(made).toEqual({ series: 'UH', number: '0053', link: 'https://www.oblio.eu/utils/show_file/?ic=1&id=2&it=3', pdf: PDF });
    expect(calls.map((c) => `${c.method} ${c.url.pathname}`)).toEqual(['POST /api/authorize/token', 'POST /api/docs/invoice', 'GET /utils/show_file/']);
    expect(new URLSearchParams(calls[0]!.body).get('client_id')).toBe('shop@example.com');
    expect(new URLSearchParams(calls[0]!.body).get('client_secret')).toBe('s3cret');
    expect(calls[1]!.headers.authorization).toBe('Bearer tok-1');
    expect(calls.every((c) => c.url.hostname === 'www.oblio.eu')).toBe(true);
    // The storno, in the same run: the token asked once.
    const storno = await actions.storno({ question: 'invoice.storno', order: anOrder(), invoice: { series: 'UH', number: '0053' } }, host);
    expect([storno.series, storno.number]).toEqual(['ST', '0002']);
    expect(calls.filter((c) => c.url.pathname === '/api/authorize/token')).toHaveLength(1);
  });

  test('says what Oblio answered, and what is missing from the settings', async () => {
    const refused = courierHost(account, oblioReplies({ '/api/docs/invoice': { status: 400, body: { status: 400, statusMessage: 'Seria UH nu exista' } } }));
    await expect(actions.make({ question: 'invoice.make', order: anOrder() }, refused.host)).rejects.toThrow('Oblio answered 400: Seria UH nu exista');
    const badKey = courierHost(account, oblioReplies({ '/api/authorize/token': { status: 401, body: { statusMessage: 'Invalid client' } } }));
    await expect(actions.make({ question: 'invoice.make', order: anOrder() }, badKey.host)).rejects.toThrow('Oblio answered 401: Invalid client');
    const noNumber = courierHost(account, oblioReplies({ '/api/docs/invoice': { body: { status: 200, data: {} } } }));
    await expect(actions.make({ question: 'invoice.make', order: anOrder() }, noNumber.host)).rejects.toThrow("did not answer the invoice's number");
    // A link that gives no PDF: the invoice, without it.
    const noPdf = courierHost(account, oblioReplies({ '/utils/show_file/': { body: '<html>' } }));
    expect((await actions.make({ question: 'invoice.make', order: anOrder() }, noPdf.host)).pdf).toBe('');
    const half = courierHost({ ...account, secret: '' }, oblioReplies());
    await expect(actions.make({ question: 'invoice.make', order: anOrder() }, half.host)).rejects.toThrow('Oblio: the API secret is missing');
    expect(half.calls).toEqual([]);
    await expect(actions.storno({ question: 'invoice.storno', order: anOrder() }, courierHost(account, oblioReplies()).host)).rejects.toThrow('the invoice to cancel was not given');
  });
});

describe('the shop and the extension together', () => {
  const dir = mkdtemp(join(tmpdir(), 'uhlaka-invoicing-ro-'));
  afterAll(async () => rm(await dir, { recursive: true, force: true }));

  test('an order the shop lends becomes an Oblio invoice, and its refund a storno', async () => {
    const store = await Store.open(join(await dir, 'site.db'));
    await store.setSite({ name: 'Atelier', url: 'https://example.com', language: 'ro', languages: [] });
    await store.setShopSettings(normalizeShopSettings({ on: true, invoices: 'manual' }));
    await importOrders(store, [
      {
        number: 1,
        state: 'paid',
        email: 'ana@example.com',
        language: 'ro',
        total: 7000,
        createdAt: '2026-11-27T10:00:00Z',
        updatedAt: '2026-11-27T10:00:00Z',
        data: {
          buyer: { name: 'Ana Pop', email: 'ana@example.com', phone: '0722', street: 'Str. Mare 2', town: 'Cluj-Napoca', county: 'Cluj', postcode: '', company: { name: 'Ana SRL', taxCode: 'RO123', registration: '' } },
          lines: [{ product: 'products/mug', variant: '', name: 'Mug', sku: 'M1', price: 5000, quantity: 1, rate: 21 }],
          shipping: { id: 'm1', name: 'Curier', price: 2000, pickup: '' },
          payment: 'transfer',
          transfer: null,
          totals: { subtotal: 5000, shipping: 2000, total: 7000, vat: [[21, 1215]] },
          vat: true,
          currency: 'RON',
          note: '',
          tracking: '',
          history: [],
        },
      },
    ] as unknown as Parameters<typeof importOrders>[1]);
    const [{ id }] = (await store.database().rows<{ id: string }>('SELECT id FROM shop_orders WHERE number = 1')) as [{ id: string }];
    const { host, calls } = courierHost(account, oblioReplies());
    // The program's part, as `extensionHost` does it: the action asked with the order.
    const invoicer: Invoicer = {
      who: async () => ({ name: 'invoicing-ro', title: 'Invoicing (Romania)' }),
      async make(question, order, of) {
        const given = question === 'invoice.make' ? await actions.make({ question, order: order as Order }, host) : await actions.storno({ question, order: order as Order, invoice: of }, host);
        return { extension: 'invoicing-ro', ...given };
      },
    };
    const shop = await openShop(store, () => invoicer);
    const owner = { id: 'u1', role: 'owner', email: 'o@example.com', name: 'Owner' } as unknown as User;
    const pressed = await shop.admin(new Request('http://x/api/shop/invoice', { method: 'POST' }), new URL('http://x/api/shop/invoice'), owner, { id });
    expect(((await pressed.json()) as { said?: string }).said).toBe('made');
    const sent = () => calls.filter((c) => c.url.pathname === '/api/docs/invoice').map((c) => JSON.parse(c.body) as Record<string, unknown>);
    expect(sent()).toHaveLength(1);
    expect(sent()[0]).toMatchObject({ seriesName: 'UH', client: { name: 'Ana SRL', cif: 'RO123' }, collect: { type: 'Ordin de plata' } });
    expect((sent()[0]!.products as unknown[]).length).toBe(2);
    await shop.lent.refunded(id);
    for (let i = 0; i < 100 && sent().length < 2; i++) await Bun.sleep(10);
    expect(sent()[1]).toMatchObject({ referenceDocument: { type: 'Factura', seriesName: 'UH', number: '0053' } });
    expect((await store.orderFiles(id)).map((f) => f.name)).toEqual(['invoice-UH0053.pdf', 'storno-ST0002.pdf']);
  });
});

describe('packed and run by the program', () => {
  test('the bundle answers invoice.make through the runner, calling only Oblio, and the program keeps its answer', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'uhlaka-invoicing-ro-pack-'));
    const store = await Store.open(join(folder, 'site.db'));
    try {
      const { file } = await packExtension('extensions/invoicing-ro', folder);
      const text = await Bun.file(file).text();
      const out: string[] = [];
      const host = extensionHost(store, {
        log: () => {},
        fetch: async (url, init) => {
          out.push(`${init.method} ${url}`);
          const u = new URL(url);
          const a = oblioReplies()(u, { method: String(init.method), headers: {}, body: String(init.body ?? '') });
          return new Response(a.base64 ? Buffer.from(a.base64, 'base64') : typeof a.body === 'string' ? a.body : JSON.stringify(a.body), { status: a.status ?? 200 });
        },
      });
      await host.install(text, (await host.offer(text)).sha256);
      await store.saveExtensionRow('invoicing-ro', 'settings', account);
      expect(await host.invoicing.who()).toEqual({ name: 'invoicing-ro', title: 'Invoicing (Romania)' });
      const made = await host.invoicing.make('invoice.make', anOrder());
      expect(made).toEqual({ extension: 'invoicing-ro', series: 'UH', number: '0053', link: 'https://www.oblio.eu/utils/show_file/?ic=1&id=2&it=3', pdf: PDF });
      const storno = await host.invoicing.make('invoice.storno', anOrder(), { series: 'UH', number: '0053' });
      expect([storno.series, storno.number]).toEqual(['ST', '0002']);
      expect(out.every((o) => o.includes('https://www.oblio.eu/'))).toBe(true);
      host.close();
    } finally {
      await store.close();
      await rm(folder, { recursive: true, force: true });
    }
  }, 20000);
});
