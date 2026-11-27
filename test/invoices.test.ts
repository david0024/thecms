/**
 * Invoices (ADR 0081): the shop asks for them, an extension for the owner's
 * invoicing app makes them. Asked by themselves when an order is paid (sent,
 * when paid on delivery), or by the button; one for an order, its PDF kept on
 * it for the buyer, a storno when it is refunded, and what fails asked again.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXTENSION_FORMAT, extensionAsks, normalizeShopSettings, parseExtension } from '../src/core/index.ts';
import type { Invoicer, MadeInvoice } from '../src/parts/shop/pages.ts';
import { INVOICE_TRIES, openShop } from '../src/parts/shop/shop.ts';
import { importOrders } from '../src/parts/shop/transfer.ts';
import { Store, type User } from '../src/site/store.ts';

const dir = await mkdtemp(join(tmpdir(), 'uhlaka-invoices-'));
afterAll(() => rm(dir, { recursive: true, force: true }));

const PDF = Buffer.from('%PDF-1.4 an invoice').toString('base64');
const owner = { id: 'u1', role: 'owner', email: 'o@example.com', name: 'Owner' } as unknown as User;

const order = (number: number, payment = 'transfer', state = 'waiting') => ({
  number,
  state,
  email: 'ana@example.com',
  language: 'ro',
  total: 7000,
  createdAt: '2026-11-27T10:00:00Z',
  updatedAt: '2026-11-27T10:00:00Z',
  data: {
    buyer: { name: 'Ana Pop', email: 'ana@example.com', phone: '0722', street: 'Str. Mare 2', town: 'Cluj-Napoca', county: 'Cluj', postcode: '', company: { name: 'Ana SRL', taxCode: 'RO123', registration: '' } },
    lines: [{ product: 'products/mug', variant: '', name: 'Mug', sku: 'M1', price: 5000, quantity: 1, rate: 21 }],
    shipping: { id: 'm1', name: 'Courier', price: 2000, pickup: '' },
    payment,
    transfer: null,
    totals: { subtotal: 5000, shipping: 2000, total: 7000, vat: [[21, 1215]] },
    vat: true,
    currency: 'RON',
    note: '',
    tracking: '',
    history: [],
  },
});

/** An invoicing app in the extension's place: what it was asked, and what it answers. */
function app(answer: (question: string, n: number) => Partial<MadeInvoice> | Error = () => ({})) {
  const asked: { question: string; order: { number: number; vat: boolean }; of?: { series: string; number: string } }[] = [];
  let made = 0;
  const invoicer: Invoicer = {
    who: async () => ({ name: 'invoicing-ro', title: 'Facturare România' }),
    async make(question, order, of) {
      asked.push({ question, order: order as { number: number; vat: boolean }, of });
      const given = answer(question, asked.length);
      if (given instanceof Error) throw given;
      made++;
      return { extension: 'invoicing-ro', series: question === 'invoice.storno' ? 'ST' : 'UH', number: String(made), link: 'https://www.oblio.eu/x', pdf: PDF, ...given };
    },
  };
  return { invoicer, asked };
}

async function site(name: string, invoices: 'off' | 'auto' | 'manual', orders: ReturnType<typeof order>[]) {
  const store = await Store.open(join(dir, `${name}.db`));
  await store.setSite({ name: 'Atelier', url: 'https://example.com', language: 'ro', languages: [] });
  await store.setShopSettings(normalizeShopSettings({ on: true, invoices }));
  await importOrders(store, orders as unknown as Parameters<typeof importOrders>[1]);
  const id = async (number: number): Promise<string> => String((await store.database().rows<{ id: string }>('SELECT id FROM shop_orders WHERE number = ?', [number]))[0]?.id);
  return { store, id };
}

/** Waits for what the shop asked at once, without holding up the order's change. */
async function settled(store: Store): Promise<void> {
  for (let i = 0; i < 100; i++) {
    const busy = await store.database().rows("SELECT id FROM shop_invoices WHERE state = 'making' OR (state = 'waiting' AND tries = 0)");
    if (!busy.length) return;
    await Bun.sleep(10);
  }
}
const rows = async (store: Store) => store.database().rows<Record<string, unknown>>('SELECT * FROM shop_invoices ORDER BY created_at, id');

describe('invoices made by themselves', () => {
  test('an order paid gets one invoice, its PDF on the order for the buyer', async () => {
    const { store, id } = await site('auto', 'auto', [order(1)]);
    const { invoicer, asked } = app();
    const shop = await openShop(store, () => invoicer);
    const one = await id(1);
    await shop.lent.paid(one);
    await settled(store);
    await shop.chores(new Date());
    expect(asked).toHaveLength(1);
    expect(asked[0]?.question).toBe('invoice.make');
    expect(asked[0]?.order.number).toBe(1);
    expect(asked[0]?.order.vat).toBe(true);
    const [row] = await rows(store);
    expect(row).toMatchObject({ order_id: one, kind: 'invoice', state: 'made', series: 'UH', number: '1', link: 'https://www.oblio.eu/x' });
    const files = await store.orderFiles(one);
    expect(files.map((f) => [f.name, f.buyer, f.extension])).toEqual([['invoice-UH1.pdf', true, 'invoicing-ro']]);
    // Paid again, as a webhook may say it twice: still one.
    await shop.lent.paid(one);
    await shop.chores(new Date());
    expect(asked).toHaveLength(1);
  });

  test('paid on delivery: invoiced when it is sent, not when it is placed', async () => {
    const { store, id } = await site('cod', 'auto', [order(1, 'cod')]);
    const { invoicer, asked } = app();
    const shop = await openShop(store, () => invoicer);
    const one = await id(1);
    await shop.lent.tracking(one, 'AWB1');
    expect(asked).toHaveLength(0);
    await shop.lent.sent(one, 'AWB1');
    await settled(store);
    expect(asked.map((a) => a.question)).toEqual(['invoice.make']);
    await shop.lent.completed(one);
    await settled(store);
    expect(asked).toHaveLength(1);
  });

  test('refunded: a storno of the invoice made', async () => {
    const { store, id } = await site('storno', 'auto', [order(1)]);
    const { invoicer, asked } = app();
    const shop = await openShop(store, () => invoicer);
    const one = await id(1);
    await shop.lent.paid(one);
    await settled(store);
    await shop.lent.refunded(one);
    await settled(store);
    expect(asked.map((a) => a.question)).toEqual(['invoice.make', 'invoice.storno']);
    expect(asked[1]?.of).toEqual({ series: 'UH', number: '1' });
    expect((await rows(store)).map((r) => [r.kind, r.state, r.series])).toEqual([
      ['invoice', 'made', 'UH'],
      ['storno', 'made', 'ST'],
    ]);
    expect((await store.orderFiles(one)).map((f) => f.name)).toEqual(['invoice-UH1.pdf', 'storno-ST2.pdf']);
  });

  test('off, or only by hand: nothing is asked when an order is paid', async () => {
    for (const when of ['off', 'manual'] as const) {
      const { store, id } = await site(`quiet-${when}`, when, [order(1)]);
      const { invoicer, asked } = app();
      const shop = await openShop(store, () => invoicer);
      await shop.lent.paid(await id(1));
      await shop.chores(new Date());
      expect(asked).toHaveLength(0);
      expect(await rows(store)).toHaveLength(0);
    }
  });

  test('no extension that makes invoices: nothing is queued', async () => {
    const { store, id } = await site('nobody', 'auto', [order(1)]);
    const shop = await openShop(store, () => null);
    await shop.lent.paid(await id(1));
    expect(await rows(store)).toHaveLength(0);
  });
});

describe('what fails', () => {
  test('asked again later, waiting longer each time, then given up and said', async () => {
    const { store, id } = await site('fails', 'auto', [order(1)]);
    const { invoicer, asked } = app(() => new Error('Oblio answered 503: try later'));
    const shop = await openShop(store, () => invoicer);
    await shop.lent.paid(await id(1));
    await settled(store);
    let [row] = await rows(store);
    expect(row).toMatchObject({ state: 'waiting', tries: 1, said: 'Oblio answered 503: try later' });
    // Not again before it is due.
    await shop.chores(new Date());
    expect(asked).toHaveLength(1);
    let now = Date.now();
    for (let n = 2; n <= INVOICE_TRIES; n++) {
      now += 2 ** n * 5 * 60_000;
      await shop.chores(new Date(now));
    }
    expect(asked).toHaveLength(INVOICE_TRIES);
    [row] = await rows(store);
    expect(row).toMatchObject({ state: 'failed', tries: INVOICE_TRIES });
    await shop.chores(new Date(now + 86_400_000));
    expect(asked).toHaveLength(INVOICE_TRIES);
  });

  test('left half made: given up, for the owner to look in the app first', async () => {
    const { store, id } = await site('stuck', 'manual', [order(1)]);
    const shop = await openShop(store, () => app().invoicer);
    const one = await id(1);
    await store.database().run("INSERT INTO shop_invoices (id, order_id, kind, state, extension, series, number, link, file, tries, said, due_at, created_at, updated_at) VALUES (?, ?, 'invoice', 'making', '', '', '', '', '', 0, '', ?, ?, ?)", [
      `${one}:invoice`,
      one,
      '2026-11-27T10:00:00Z',
      '2026-11-27T10:00:00Z',
      '2026-11-27T10:00:00Z',
    ]);
    await shop.chores(new Date('2026-11-27T11:00:00Z'));
    expect((await rows(store))[0]).toMatchObject({ state: 'failed' });
    expect(String((await rows(store))[0]?.said)).toContain('look in the invoicing app');
  });
});

describe('the button on the order', () => {
  test('makes the invoice once, asks again after a failure, and refuses when off', async () => {
    let fail = true;
    const { store, id } = await site('button', 'manual', [order(1, 'transfer', 'paid'), order(2, 'transfer', 'cancelled')]);
    const { invoicer, asked } = app(() => (fail ? new Error('the series is missing') : {}));
    const shop = await openShop(store, () => invoicer);
    const press = async (number: number) => {
      const response = await shop.admin(new Request('http://x/api/shop/invoice', { method: 'POST' }), new URL('http://x/api/shop/invoice'), owner, { id: await id(number) });
      return { status: response.status, body: (await response.json()) as { said?: string; error?: string; invoices?: { list: { state: string; said: string }[]; by: string; when: string } } };
    };
    let done = await press(1);
    expect(done.status).toBe(200);
    expect(done.body.said).toBe('the series is missing');
    expect(done.body.invoices?.list[0]?.state).toBe('waiting');
    fail = false;
    done = await press(1);
    expect(done.body.said).toBe('made');
    expect(done.body.invoices).toMatchObject({ when: 'manual', by: 'Facturare România' });
    done = await press(1);
    expect(done.body.said).toBe('made');
    expect(asked).toHaveLength(2);
    expect((await press(2)).status).toBe(409);
    // The order's page in the Orders screen carries them.
    const one = await id(1);
    const page = await shop.admin(new Request(`http://x/api/shop/orders?id=${one}`), new URL(`http://x/api/shop/orders?id=${one}`), owner, {});
    expect(((await page.json()) as { invoices: { list: unknown[] } }).invoices.list).toHaveLength(1);
    await store.setShopSettings(normalizeShopSettings({ on: true, invoices: 'off' }));
    expect((await press(1)).status).toBe(409);
  });
});

describe('the format', () => {
  const manifest = (uses: string[]) => ({
    name: 'invoicing-ro',
    displayName: 'Facturare România',
    version: '1.0.0',
    publisher: 'uhlaka',
    egress: ['www.oblio.eu'],
    uses,
    actions: [
      { name: 'make', label: 'Make an invoice', uses },
      { name: 'storno', label: 'Cancel an invoice', uses },
    ],
    answers: [
      { question: 'invoice.make', action: 'make' },
      { question: 'invoice.storno', action: 'storno' },
    ],
  });

  test('an extension answers invoice.make and invoice.storno, reading the order', () => {
    const parsed = parseExtension({ format: EXTENSION_FORMAT, manifest: manifest(['orders']), code: 'export const actions = {};' });
    expect(parsed.problems).toEqual([]);
    expect(parsed.pkg?.manifest.answers.map((a) => a.question)).toEqual(['invoice.make', 'invoice.storno']);
    const asks = extensionAsks(parsed.pkg!.manifest);
    expect(asks.invoices).toBe(true);
    expect(asks.shop).toBe(true);
    expect(parseExtension({ format: EXTENSION_FORMAT, manifest: manifest([]), code: 'export const actions = {};' }).problems.join(' ')).toContain('which reads the order');
  });

  test('the settings: off unless one of the three', () => {
    expect(normalizeShopSettings({}).invoices).toBe('off');
    expect(normalizeShopSettings({ invoices: 'auto' }).invoices).toBe('auto');
    expect(normalizeShopSettings({ invoices: 'always' }).invoices).toBe('off');
  });
});
