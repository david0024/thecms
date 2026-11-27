/**
 * The fourth format at the shop (ADR 0076 d4.1, d4.2, d4.4): a way to pay an
 * extension offers, which sends the buyer to the provider and hears back at
 * its route; ways to deliver it offers for a cart and an address, with places
 * to pick up; actions on an order in the Orders screen, and the files they
 * put on it, for the owner and the buyer.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXTENSION_FORMAT, EXTENSION_FORMAT_3, extensionAsks, parseExtension } from '../src/core/index.ts';
import { deliveryWays, extensionHost } from '../src/site/extensions.ts';
import { startRuntime } from '../src/site/runtime.ts';
import { startEditor } from '../src/site/server.ts';
import { Store } from '../src/site/store.ts';
import plain from '../themes/plain.json';

const dir = await mkdtemp(join(tmpdir(), 'uhlaka-checkout-x-'));
afterAll(() => rm(dir, { recursive: true, force: true }));

const CODE = `export const actions = {
  pay: async (input, host) => {
    if (input.order.buyer.name === 'Fails') throw new Error('the provider is down');
    await host.collections.insert('sessions', { session: 'cs_' + input.order.number, order: input.order.id });
    return { redirect: 'https://pay.example/c/cs_' + input.order.number + '?back=' + encodeURIComponent(input.back) + '&total=' + input.order.total + '&method=' + input.method };
  },
  hook: async (input, host) => {
    const { rows } = await host.collections.find('sessions', { where: { session: JSON.parse(input.body).session } });
    if (!rows.length) return { status: 404, body: 'no such session' };
    await host.orders.paid(rows[0].order);
    return 'ok';
  },
  quote: async (input) => [
    { id: 'courier', name: 'Fast courier', price: input.address ? (input.address.town === 'Cluj-Napoca' ? 1500 : 2500) : 1500 },
    { id: 'box', name: 'Locker', price: 990, points: [{ id: 'CJ1', name: 'Locker Central', address: 'Piața Unirii 1, Cluj' }, { id: 'bad id!', name: 'x', address: 'y' }] },
    { id: 'BAD', name: 'Wrong', price: 1 },
  ],
  invoice: async (input, host) => {
    await host.files.put({ order: input.order.id, name: 'invoice-' + input.order.number + '.pdf', type: 'application/pdf', data: btoa('%PDF-1.4 invoice ' + input.order.number), buyer: true });
    await host.files.put({ order: input.order.id, name: 'note.txt', type: 'text/plain', data: btoa('for the owner') });
    await host.orders.tracking(input.order.id, 'AWB123');
    return { message: 'Invoice ' + input.order.number + ' made.' };
  },
  sneak: async (input, host) => host.files.put({ order: input.order.id, name: 'x.html', type: 'text/html', data: btoa('<script>') }),
};`;

const manifest = {
  name: 'payer',
  displayName: 'Payer',
  version: '1.0.0',
  egress: ['pay.example'],
  uses: ['orders'],
  collections: [{ name: 'sessions', label: 'Sessions', fields: [{ key: 'session', label: 'Session', kind: 'text', unique: true }, { key: 'order', label: 'Order', kind: 'text' }] }],
  actions: [
    { name: 'pay', label: 'Pay', writes: ['sessions'] },
    { name: 'hook', label: 'Hook', reads: ['sessions'], uses: ['orders'] },
    { name: 'quote', label: 'Quote' },
    { name: 'invoice', label: 'Make the invoice', on: 'order', uses: ['orders'], files: true },
    { name: 'sneak', label: 'Sneak', on: 'order', uses: ['orders'], files: true },
  ],
  routes: [{ path: 'hook', action: 'hook', methods: ['POST'] }],
  answers: [
    { question: 'checkout.payment', action: 'pay', methods: [{ id: 'card', label: 'Card' }] },
    { question: 'checkout.delivery', action: 'quote' },
  ],
  messages: { ro: { Card: 'Card bancar', 'Make the invoice': 'Fă factura' } },
};
const PACKAGE = JSON.stringify({ format: EXTENSION_FORMAT, manifest, code: CODE });

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

async function admin(store: Store) {
  const editor = await startEditor(store, { listen: false, log: () => {} });
  const call = async (method: string, path: string, body?: unknown) => {
    const response = await editor.fetch(new Request(`http://127.0.0.1:4321${path}`, { method, headers: { host: '127.0.0.1:4321', 'x-uhlaka-token': editor.token, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }));
    const raw = await response.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      // A file.
    }
    return { status: response.status, body: parsed, text: raw, headers: response.headers };
  };
  return { editor, call };
}

function browser(fetch: (request: Request) => Promise<Response>) {
  const jar = new Map<string, string>();
  const go = async (method: string, path: string, fields?: Record<string, string>): Promise<Response> => {
    const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const response = await fetch(
      new Request(`https://example.com${path}`, { method, headers: { ...(cookie ? { cookie } : {}), ...(fields ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) }, body: fields ? new URLSearchParams(fields).toString() : undefined }),
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

const totalIn = (page: string): string => /name="total" value="(\d+)"/.exec(page)?.[1] as string;
const buyer = { name: 'Ana Pop', email: 'ana@example.com', phone: '0722 000 000', street: 'Str. Mare 2', town: 'Cluj-Napoca', county: 'Cluj', postcode: '400000', terms: 'yes' };

async function shopWithPayer(name: string) {
  const store = await site(name);
  const { editor, call } = await admin(store);
  await call('PUT', '/api/shop', { on: true, terms: '/terms/' });
  await store.saveEntry('products', { title: 'Mug', product: { price: '50', counted: true, vat: 21 } });
  await store.publishEntry('products', 'mug');
  await call('PUT', '/api/shop/stock', { kind: 'products', slug: 'mug', stock: { '': 5 } });
  const host = extensionHost(store);
  await host.install(PACKAGE, (await host.offer(PACKAGE)).sha256);
  host.close();
  const runtime = startRuntime(store, { listen: false, log: () => {} });
  return { store, editor, call, runtime, stop: () => (runtime.stop(), editor.stop()) };
}

describe('the fourth format at checkout', () => {
  test('declares ways to pay, to deliver, actions on an order and files; the owner is told; the third may not', () => {
    const { pkg, problems } = parseExtension(JSON.parse(PACKAGE));
    expect(problems).toEqual([]);
    expect(pkg!.manifest.answers.map((a) => [a.question, a.methods.map((m) => m.id)])).toEqual([
      ['checkout.payment', ['card']],
      ['checkout.delivery', []],
    ]);
    expect(extensionAsks(pkg!.manifest)).toMatchObject({ payments: ['Card'], delivery: true, files: ['Make the invoice', 'Sneak'], shop: true, points: [{ action: 'Make the invoice', on: 'order' }, { action: 'Sneak', on: 'order' }] });
    const third = parseExtension({ format: EXTENSION_FORMAT_3, manifest, code: CODE }).problems;
    expect(third).toContain('invoice: an action is on block or page, or on its own screen');
    expect(third).toContain('invoice: keeping files needs uhlaka.extension/4');
    expect(third).toContain('an extension answers one of comment.check ("checkout.payment")');
    const bad = parseExtension({
      format: EXTENSION_FORMAT,
      manifest: { ...manifest, answers: [{ question: 'checkout.payment', action: 'pay' }], actions: [...manifest.actions.slice(0, 3), { name: 'invoice', label: 'I', on: 'order' }] },
      code: CODE,
    }).problems;
    expect(bad).toContain('answering checkout.payment, it declares the ways to pay it offers in "methods"');
    expect(bad).toContain('invoice: an action on an order declares that it uses "orders"');
  });

  test('what a delivery extension answers is checked: a bad id, price or point is left out', () => {
    expect(deliveryWays('fan', [{ id: 'std', name: ' Standard\n', price: 1500 }, { id: 'x', name: 'Free?', price: -1 }, { id: 'y', name: '', price: 1 }, { id: 'z', name: 'Z', price: 1.5 }, 'nonsense'])).toEqual([
      { id: 'fan:std', name: 'Standard', price: 1500, free: null, pickup: '' },
    ]);
    expect(deliveryWays('box', [{ id: 'l', name: 'Locker', price: 0, points: [{ id: 'A1', name: 'Mall', address: 'Str. 1' }, { id: 'A2', address: '' }, { id: '../x', address: 'Str. 2' }] }])).toEqual([
      { id: 'box:l:A1', name: 'Locker: Mall', price: 0, free: null, pickup: 'Str. 1' },
    ]);
  });

  test('a buyer pays with the extension: sent to the provider, the order waits, the provider’s notice marks it paid', async () => {
    const { store, call, runtime, stop } = await shopWithPayer('pay');
    try {
      const tab = browser((r) => runtime.fetch(r));
      await tab.go('POST', '/_/cart', { product: 'products/mug', quantity: '2' });
      // The cart offers the extension's ways to deliver, before any address.
      let page = await tab.read('GET', '/_/cart');
      expect(page).toContain('<option value="payer:courier">Fast courier: RON 15.00</option>');
      expect(page).toContain('<option value="payer:box:CJ1">Locker: Locker Central: RON 9.90</option>');
      expect(page).not.toContain('Wrong');
      // No way of the shop's own: checkout is open with the extension's.
      page = await tab.read('GET', '/_/checkout');
      expect(page).toContain('value="payer:card"');
      expect(page).toContain('Card');
      expect(page).toContain('Piața Unirii 1, Cluj');
      // Away from Cluj the courier costs more: the price the buyer saw changed, and is shown again.
      const far = { ...buyer, town: 'Iași', county: 'Iași', shipping: 'payer:courier', payment: 'payer:card', total: totalIn(page) };
      let answer = await tab.go('POST', '/_/checkout', far);
      expect(answer.status).toBe(409);
      page = (await answer.text()).replace(/ /g, ' ');
      expect(page).toContain('RON 125.00');
      answer = await tab.go('POST', '/_/checkout', { ...far, total: totalIn(page) });
      expect(answer.status).toBe(303);
      const to = new URL(answer.headers.get('location') as string);
      expect(to.origin).toBe('https://pay.example');
      expect(to.searchParams.get('total')).toBe('12500');
      expect(to.searchParams.get('method')).toBe('card');
      const back = new URL(to.searchParams.get('back') as string);
      expect(back.searchParams.get('said')).toBe('paying');
      expect(back.pathname).toMatch(/^\/_\/order\/[A-Za-z0-9_-]{20,}$/);
      // Placed and waiting; the buyer coming back is told the payment is being confirmed.
      page = await tab.read('GET', `${back.pathname}${back.search}`);
      expect(page).toContain('data-order-state="waiting"');
      expect(page).toContain('The payment is confirmed in a moment');
      expect(page).toContain('Pay RON 125.00 with Card.');
      expect(page).toContain('data-order-pay-now');
      const orders = (await call('GET', '/api/shop/orders')).body.orders as { id: string; state: string }[];
      expect(orders).toMatchObject([{ state: 'waiting' }]);
      const order = (await call('GET', `/api/shop/orders?id=${orders[0]!.id}`)).body.order as { data: { payment: string; paymentName: string; shipping: { id: string; name: string } } };
      expect(order.data).toMatchObject({ payment: 'payer:card', paymentName: 'Card', shipping: { id: 'payer:courier', name: 'Fast courier' } });

      // The provider's notice, at the extension's route: the order is paid.
      const hook = (session: string) => runtime.fetch(new Request('https://example.com/_/x/payer/hook', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ session }) }));
      expect((await hook('cs_404')).status).toBe(404);
      expect(await (await hook('cs_1')).text()).toBe('ok');
      expect(await (await hook('cs_1')).text()).toBe('ok');
      page = await tab.read('GET', back.pathname);
      expect(page).toContain('data-order-state="paid"');
      expect(page).not.toContain('data-order-pay-now');
      expect(await store.extensionRows('payer', 'sessions')).toHaveLength(1);
    } finally {
      stop();
    }
  });

  test('a payment that cannot start leaves the order waiting, and the buyer pays again from its page', async () => {
    const { runtime, stop } = await shopWithPayer('pay-again');
    try {
      const tab = browser((r) => runtime.fetch(r));
      await tab.go('POST', '/_/cart', { product: 'products/mug', quantity: '1' });
      const page = await tab.read('GET', '/_/checkout');
      // Picked up at a locker: no address is needed.
      const answer = await tab.go('POST', '/_/checkout', { ...buyer, name: 'Fails', street: '', town: '', county: '', shipping: 'payer:box:CJ1', payment: 'payer:card', total: String(5000 + 990) });
      expect(totalIn(page)).toBeDefined();
      expect(answer.status).toBe(303);
      const at = answer.headers.get('location') as string;
      expect(at).toMatch(/^\/_\/order\/[A-Za-z0-9_-]+\?said=payfailed$/);
      const shown = await tab.read('GET', at);
      expect(shown).toContain('The payment could not be started.');
      expect(shown).toContain('Locker Central');
      const path = at.split('?')[0] as string;
      expect(shown).toContain(`action="${path}/pay"`);
      // Paying again goes through the extension again; it still fails, and says so.
      expect((await tab.go('POST', `${path}/pay`, {})).headers.get('location')).toBe(`${path}?said=payfailed`);
      expect((await tab.go('GET', `${path}/pay`)).status).toBe(404);
    } finally {
      stop();
    }
  });

  test('an action on an order: offered in the Orders screen, it puts files on the order; the buyer sees theirs', async () => {
    const { store, call, runtime, stop } = await shopWithPayer('order-actions');
    try {
      const tab = browser((r) => runtime.fetch(r));
      await tab.go('POST', '/_/cart', { product: 'products/mug', quantity: '1' });
      // The way to deliver chosen in the cart, as the shop's own are.
      await tab.go('POST', '/_/cart', { shipping: 'payer:courier' });
      const page = await tab.read('GET', '/_/checkout');
      expect(page).toContain('value="payer:courier" checked');
      const placed = await tab.go('POST', '/_/checkout', { ...buyer, shipping: 'payer:courier', payment: 'payer:card', total: totalIn(page) });
      const back = new URL(new URL(placed.headers.get('location') as string).searchParams.get('back') as string);
      const [{ id }] = (await call('GET', '/api/shop/orders')).body.orders as [{ id: string }];

      let extras = (await call('GET', `/api/shop/orders/extensions?id=${id}&l=ro`)).body;
      expect(extras).toEqual({ actions: [{ extension: 'payer', action: 'invoice', label: 'Fă factura' }, { extension: 'payer', action: 'sneak', label: 'Sneak' }], files: [] });
      expect((await call('POST', '/api/shop/orders/run', { id, extension: 'payer', action: 'nothing' })).status).toBe(404);
      const ran = await call('POST', '/api/shop/orders/run', { id, extension: 'payer', action: 'invoice' });
      expect(ran.body.said).toBe('Invoice 1 made.');
      expect((ran.body.order as { tracking: string }).tracking).toBe('AWB123');
      expect((ran.body.files as { name: string; buyer: boolean }[]).map((f) => [f.name, f.buyer])).toEqual([
        ['invoice-1.pdf', true],
        ['note.txt', false],
      ]);
      // Only kinds of file that cannot run in a browser.
      expect((await call('POST', '/api/shop/orders/run', { id, extension: 'payer', action: 'sneak' })).body.error).toMatch(/^a file is one of application\/pdf/);
      extras = (await call('GET', `/api/shop/orders/extensions?id=${id}`)).body;
      const [invoice, owners] = extras.files as { id: string }[];
      const file = await call('GET', `/api/shop/orders/file?id=${invoice!.id}`);
      expect(file.text).toBe('%PDF-1.4 invoice 1');
      expect(file.headers.get('content-disposition')).toBe("attachment; filename*=UTF-8''invoice-1.pdf");

      // The buyer's page lists the invoice, and only it, and gives it.
      const order = await tab.read('GET', back.pathname);
      expect(order).toContain('Documents');
      expect(order).toContain(`href="${back.pathname}/file/${invoice!.id}"`);
      expect(order).not.toContain('note.txt');
      const got = await tab.go('GET', `${back.pathname}/file/${invoice!.id}`);
      expect(got.headers.get('content-type')).toBe('application/pdf');
      expect(await got.text()).toBe('%PDF-1.4 invoice 1');
      expect((await tab.go('GET', `${back.pathname}/file/${owners!.id}`)).status).toBe(404);

      // Uninstalled, its files go with it.
      const host = extensionHost(store);
      await host.uninstall('payer');
      host.close();
      expect(await store.orderFiles(id)).toEqual([]);
    } finally {
      stop();
    }
  });
});
