/**
 * The Fan Courier extension (ADR 0079): the price at checkout, FANbox
 * lockers, the AWB with its label and cash on delivery, and the parcel
 * followed until it is delivered. Fan Courier's API is answered here.
 */
import { describe, expect, test } from 'bun:test';
import { EXTENSION_FORMAT, parseExtension } from '../src/core/index.ts';
import { routeOf, same, weightOf } from '../extensions/courier/courier.ts';
import { actions, lockersOf, tariffOf, whereOf } from '../extensions/fancourier/index.ts';
import manifest from '../extensions/fancourier/manifest.json';
import { anOrder, courierHost, PDF, type Reply } from './fixtures/courier-host.ts';

const account = { username: 'shop', password: 'pw', client_id: '7032158', pricing: 'fixed', home_price: 20, locker_price: 15, free_from: null, default_weight: 1, lockers: true, auto_awb: false };
const place = { street: 'Str. Mare 2', town: 'Cluj-Napoca', county: 'Cluj', postcode: '400000' };
const cart = { subtotal: 10000, weight: 800, lines: [{ quantity: 2, weight: 400 }], address: place };

/** Fan Courier, as its API answers. */
const fan =
  (over: Partial<Record<string, ReturnType<Reply>>> = {}): Reply =>
  (url) => {
    const path = url.pathname;
    if (over[path]) return over[path];
    if (path === '/login') return { body: { status: 'success', data: { token: 'tok-1' } } };
    if (path === '/reports/awb/internal-tariff') return { body: { status: 'success', data: { total: 18.5, vat: 3.89 } } };
    if (path === '/reports/pickup-points')
      return {
        body: {
          data: [
            { id: 'FB001', name: 'FANbox Mall', address: { locality: 'Cluj Napoca', street: 'Str. Avram Iancu', streetNo: '1' } },
            { id: 'FB002', name: 'FANbox Gara', address: { locality: 'Turda', street: 'Str. Garii' } },
            { id: 'bad id!', name: 'x', address: { locality: 'Cluj-Napoca', street: 'y' } },
          ],
        },
      };
    if (path === '/intern-awb') return { body: { response: [{ awbNumber: 2345678901, errors: null }] } };
    if (path === '/awb/label') return { body: '', base64: PDF };
    if (path === '/reports/awb/tracking') return { body: { data: [{ events: [] }] } };
    return { status: 404, body: { message: 'no such page' } };
  };

describe('the Fan Courier extension', () => {
  test('is a valid extension of the fourth format, and every action it declares is in its code', () => {
    const { problems, pkg } = parseExtension({ format: EXTENSION_FORMAT, manifest, code: 'export const actions = {}' });
    expect(problems).toEqual([]);
    for (const a of pkg!.manifest.actions) expect(Object.keys(actions)).toContain(a.name);
    expect(pkg!.manifest.egress).toEqual(['api.fancourier.ro']);
  });

  test('reads what Fan Courier answers', () => {
    expect(tariffOf({ data: { total: 18.5, vat: 3.89 } })).toBe(2239);
    expect(tariffOf({ data: { total: '20' } })).toBe(2000);
    expect(() => tariffOf({ data: {} })).toThrow('did not give a price');
    expect(whereOf({ data: [{ events: [] }] })).toBe('waiting');
    expect(whereOf({ data: [{ events: [{ id: 'C0', name: 'Ridicat' }] }] })).toBe('moving');
    expect(whereOf({ data: [{ events: [{ id: 'C0' }, { id: 'S2', name: 'Livrat' }] }] })).toBe('delivered');
    expect(whereOf({ data: [{ events: [{ id: 'C0' }, { id: 'S7', name: 'Retur' }] }] })).toBe('returned');
    expect(lockersOf({ data: [{ id: 'A', name: 'Box', address: { locality: 'Bucureşti', street: 'Str. 1' } }] }, 'bucuresti')).toEqual([{ id: 'A', name: 'Box', address: 'Str. 1, Bucureşti' }]);
    expect(same('Cluj-Napoca', 'cluj napoca')).toBe(true);
    expect(weightOf([{ quantity: 2, weight: 400 }], 1)).toBe(800);
    expect(weightOf([{ quantity: 2 }], 0.5)).toBe(500);
    expect(weightOf([], null)).toBe(1000);
    expect(routeOf({ name: 'fancourier' }, { shipping: { id: 'fancourier:locker:FB001', name: '', price: 0, pickup: '' } })).toEqual({ ours: true, locker: 'FB001' });
    expect(routeOf({ name: 'fancourier' }, { shipping: { id: 'm1', name: '', price: 0, pickup: '' } }).ours).toBe(false);
  });

  test('at checkout: the owner’s fixed price, FANbox lockers in the buyer’s town, free above a sum', async () => {
    const { host, calls } = courierHost(account, fan());
    expect(await actions.quote(cart, host)).toEqual([
      { id: 'home', name: 'Fan Courier', price: 2000 },
      { id: 'locker', name: 'FANbox', price: 1500, points: [{ id: 'FB001', name: 'FANbox Mall', address: 'Str. Avram Iancu 1, Cluj Napoca' }] },
    ]);
    // The fixed price asks Fan Courier only for its lockers.
    expect(calls.map((c) => c.url.pathname)).toEqual(['/login', '/reports/pickup-points']);
    // Before the address: the door only, and nothing asked.
    const before = courierHost(account, fan());
    expect(await actions.quote({ ...cart, address: null }, before.host)).toEqual([{ id: 'home', name: 'Fan Courier', price: 2000 }]);
    expect(before.calls).toEqual([]);
    const free = courierHost({ ...account, free_from: 100, lockers: false }, fan());
    expect(await actions.quote(cart, free.host)).toEqual([{ id: 'home', name: 'Fan Courier', price: 0 }]);
    // Not set up: nothing offered.
    const none = courierHost(account, fan());
    none.rows.settings = [];
    expect(await actions.quote(cart, none.host)).toEqual([]);
  });

  test('at checkout with Fan Courier’s price: asked by weight and town; when Fan Courier is down, the fixed price stands in', async () => {
    const { host, calls } = courierHost({ ...account, pricing: 'courier', lockers: false }, fan());
    expect(await actions.quote(cart, host)).toEqual([{ id: 'home', name: 'Fan Courier', price: 2239 }]);
    const tariff = calls.find((c) => c.url.pathname === '/reports/awb/internal-tariff')!;
    expect(tariff.url.searchParams.get('info[weight]')).toBe('1');
    expect(tariff.url.searchParams.get('recipient[locality]')).toBe('Cluj-Napoca');
    expect(tariff.headers.authorization).toBe('Bearer tok-1');
    const down = courierHost({ ...account, pricing: 'courier', lockers: false }, fan({ '/reports/awb/internal-tariff': { status: 503, body: 'down' } }));
    expect(await actions.quote(cart, down.host)).toEqual([{ id: 'home', name: 'Fan Courier', price: 2000 }]);
  });

  test('the AWB: made once, with the label on the order and its number as the tracking; cash on delivery filled in', async () => {
    const cod = anOrder({ shipping: { id: 'fancourier:home', name: 'Fan Courier', price: 2000, pickup: '' }, payment: 'cod' });
    const { host, calls, files, moved, later, rows } = courierHost(account, fan(), [cod]);
    expect(await actions.awb({ order: cod }, host)).toBe('AWB 2345678901 made. Its label is on the order.');
    const made = JSON.parse(calls.find((c) => c.url.pathname === '/intern-awb')!.body);
    expect(made.clientId).toBe('7032158');
    expect(made.shipments[0].info).toMatchObject({ service: 'Cont Colector', weight: 1, cod: 120, content: '2 × Mug', observation: 'Order 7' });
    expect(made.shipments[0].recipient).toMatchObject({ name: 'Ana Pop', phone: '0722000000', address: { locality: 'Cluj-Napoca', county: 'Cluj', street: 'Str. Mare 2', zipCode: '400000' } });
    expect(files).toEqual([{ order: 'o1', name: 'awb-2345678901.pdf', type: 'application/pdf', data: PDF }]);
    expect(moved).toEqual(['tracking o1 2345678901']);
    expect(later).toEqual([{ action: 'follow', input: { order: 'o1' }, minutes: 120 }]);
    expect(rows.shipments).toMatchObject([{ order: 'o1', number: 7, awb: '2345678901', state: 'made', labelled: true }]);
    // Asked again: the one it has, and Fan Courier not asked to make another.
    expect(await actions.awb({ order: cod }, host)).toBe('This order has AWB 2345678901. Its label is on the order.');
    expect(calls.filter((c) => c.url.pathname === '/intern-awb')).toHaveLength(1);
  });

  test('to a FANbox, paid already: no cash to collect; an order sent another way is refused', async () => {
    const boxed = anOrder({ shipping: { id: 'fancourier:locker:FB001', name: 'FANbox: Mall', price: 1500, pickup: 'Str. Avram Iancu 1' } });
    const { host, calls } = courierHost(account, fan(), [boxed]);
    await actions.awb({ order: boxed }, host);
    const made = JSON.parse(calls.find((c) => c.url.pathname === '/intern-awb')!.body).shipments[0];
    expect(made.info.service).toBe('FANbox');
    expect(made.info).not.toHaveProperty('cod');
    expect(made.recipient.pickupLocation).toBe('FB001');
    await expect(actions.awb({ order: anOrder() }, host)).rejects.toThrow('Order 7 is not delivered by Fan Courier.');
  });

  test('what Fan Courier refuses is said, nothing is kept, and it may be asked again; a label that fails is fetched on the next press', async () => {
    const order = anOrder({ shipping: { id: 'fancourier:home', name: 'Fan Courier', price: 2000, pickup: '' } });
    const refused = courierHost(account, fan({ '/intern-awb': { body: { response: [{ errors: { recipient: 'phone is invalid' } }] } } }), [order]);
    await expect(actions.awb({ order }, refused.host)).rejects.toThrow('Fan Courier did not make the AWB: {"recipient":"phone is invalid"}');
    expect(refused.rows.shipments).toEqual([]);
    const bad = courierHost(account, fan({ '/login': { status: 401, body: { message: 'Invalid credentials' } } }), [order]);
    await expect(actions.awb({ order }, bad.host)).rejects.toThrow('Fan Courier answered 401: Invalid credentials');
    const missing = courierHost({ ...account, password: '' }, fan(), [order]);
    await expect(actions.awb({ order }, missing.host)).rejects.toThrow('Fan Courier: the password is missing. Add it in Extensions → Fan Courier.');

    let label: ReturnType<Reply> = { status: 500, body: 'error' };
    const late = courierHost(account, (url, init) => (url.pathname === '/awb/label' ? label : fan()(url, init)), [order]);
    expect(await actions.awb({ order }, late.host)).toBe('AWB 2345678901 made. The label could not be fetched from Fan Courier: press again to try.');
    expect(late.files).toEqual([]);
    label = { body: '', base64: PDF };
    expect(await actions.awb({ order }, late.host)).toBe('This order has AWB 2345678901. Its label is on the order.');
    expect(late.files).toHaveLength(1);
  });

  test('by itself, when the owner chose it: a paid order, or one paid on delivery as soon as it is placed', async () => {
    const card = anOrder({ id: 'c', shipping: { id: 'fancourier:home', name: '', price: 0, pickup: '' }, payment: 'stripe:card' });
    const cod = anOrder({ id: 'd', shipping: { id: 'fancourier:home', name: '', price: 0, pickup: '' }, payment: 'cod' });
    const other = anOrder({ id: 'e', payment: 'transfer' });
    const off = courierHost(account, fan(), [card]);
    await actions.paid({ id: 'c' }, off.host);
    expect(off.later).toEqual([]);
    const on = courierHost({ ...account, auto_awb: true }, fan(), [card, cod, other]);
    await actions.paid({ id: 'c' }, on.host);
    await actions.paid({ id: 'd' }, on.host);
    await actions.made({ id: 'd' }, on.host);
    await actions.made({ id: 'c' }, on.host);
    await actions.paid({ id: 'e' }, on.host);
    expect(on.later).toEqual([
      { action: 'make', input: { order: 'c' }, minutes: 0 },
      { action: 'make', input: { order: 'd' }, minutes: 0 },
    ]);
    await actions.make({ input: { order: 'c' } }, on.host);
    expect(on.rows.shipments).toMatchObject([{ order: 'c', awb: '2345678901' }]);
    // Cancelled meanwhile: no AWB.
    const gone = courierHost({ ...account, auto_awb: true }, fan(), [{ ...cod, state: 'cancelled' }]);
    await actions.make({ input: { order: 'd' } }, gone.host);
    expect(gone.rows.shipments).toEqual([]);
  });

  test('the parcel followed: taken, the order is sent; delivered, it is completed; and it stops', async () => {
    const order = anOrder({ shipping: { id: 'fancourier:home', name: '', price: 0, pickup: '' } });
    let events: unknown[] = [];
    const { host, later, moved, rows } = courierHost(account, (url, init) => (url.pathname === '/reports/awb/tracking' ? { body: { data: [{ events }] } } : fan()(url, init)), [order]);
    await actions.awb({ order }, host);
    later.length = 0;
    moved.length = 0;
    await actions.follow({ input: { order: 'o1' } }, host);
    expect(moved).toEqual([]);
    expect(later).toEqual([{ action: 'follow', input: { order: 'o1' }, minutes: 180 }]);
    events = [{ id: 'C0', name: 'Ridicat' }];
    await actions.follow({ input: { order: 'o1' } }, host);
    expect(moved).toEqual(['sent o1 2345678901']);
    expect(rows.shipments![0]!.state).toBe('sent');
    events = [{ id: 'C0' }, { id: 'S2', name: 'Livrat' }];
    await actions.follow({ input: { order: 'o1' } }, host);
    expect(moved).toEqual(['sent o1 2345678901', 'completed o1']);
    expect(rows.shipments![0]!.state).toBe('delivered');
    expect(later).toHaveLength(2);
    // Delivered: not asked again.
    await actions.follow({ input: { order: 'o1' } }, host);
    expect(later).toHaveLength(2);
  });

  test('a parcel not delivered in 30 days is no longer followed; Fan Courier down is asked again later', async () => {
    const order = anOrder({ shipping: { id: 'fancourier:home', name: '', price: 0, pickup: '' } });
    const { host, later, rows } = courierHost(account, (url, init) => (url.pathname === '/reports/awb/tracking' ? { status: 502, body: 'bad gateway' } : fan()(url, init)), [order]);
    await actions.awb({ order }, host);
    later.length = 0;
    await actions.follow({ input: { order: 'o1' } }, host);
    expect(later).toHaveLength(1);
    rows.shipments![0]!.since = new Date(Date.now() - 31 * 86_400_000).toISOString();
    await actions.follow({ input: { order: 'o1' } }, host);
    expect(later).toHaveLength(1);
  });
});

describe('the Fan Courier extension, packed and installed', () => {
  test('answers checkout through the program, from its own process', async () => {
    const { mkdtemp, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { packExtension } = await import('../tools/pack-extension.ts');
    const { extensionHost } = await import('../src/site/extensions.ts');
    const { Store } = await import('../src/site/store.ts');
    const dir = await mkdtemp(join(tmpdir(), 'uhlaka-fan-'));
    try {
      const { file } = await packExtension('extensions/fancourier', dir);
      const text = await Bun.file(file).text();
      expect(JSON.parse(text).format).toBe(EXTENSION_FORMAT);
      const store = await Store.open(join(dir, 'site.db'));
      const reply = fan();
      const host = extensionHost(store, {
        log: () => {},
        fetch: async (url, init) => {
          const a = reply(new URL(url), { method: String(init.method ?? 'GET'), headers: {}, body: String(init.body ?? '') });
          return new Response(typeof a.body === 'string' ? a.body : JSON.stringify(a.body), { status: a.status ?? 200 });
        },
      });
      await host.install(text, (await host.offer(text)).sha256);
      await store.saveExtensionRow('fancourier', 'settings', account);
      const ways = await host.checkout.deliveries({ lines: [{ product: 'products/mug', variant: '', name: 'Mug', sku: '', weight: 400, price: 5000, quantity: 2 }], subtotal: 10000, weight: 800, currency: 'RON', address: place }, 'ro');
      expect(ways).toEqual([
        { id: 'fancourier:home', name: 'Fan Courier', price: 2000, free: null, pickup: '' },
        { id: 'fancourier:locker:FB001', name: 'FANbox: FANbox Mall', price: 1500, free: null, pickup: 'Str. Avram Iancu 1, Cluj Napoca' },
      ]);
      host.close();
      await store.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
