/**
 * The Cargus extension (ADR 0079): the price at checkout, Ship & Go
 * lockers, the AWB with its label and cash on delivery, and the parcel
 * followed. What all three couriers share is tested with Fan Courier; here,
 * what Cargus's API is asked and answers.
 */
import { describe, expect, test } from 'bun:test';
import { EXTENSION_FORMAT, parseExtension } from '../src/core/index.ts';
import { actions, labelOf, lockersOf, SHIP_AND_GO, STANDARD, totalOf, whereOf } from '../extensions/cargus/index.ts';
import manifest from '../extensions/cargus/manifest.json';
import { anOrder, courierHost, PDF, type Reply } from './fixtures/courier-host.ts';

const account = { api_key: 'sub-key', username: 'shop', password: 'pw', location: '', pricing: 'fixed', home_price: 20, locker_price: 15, free_from: null, default_weight: 1, lockers: true, auto_awb: false };
const place = { street: 'Str. Mare 2', town: 'Cluj-Napoca', county: 'Cluj', postcode: '400000' };
const cart = { subtotal: 10000, weight: 800, lines: [{ quantity: 2, weight: 400 }], address: place };

const cargus =
  (over: Partial<Record<string, ReturnType<Reply>>> = {}): Reply =>
  (url) => {
    const path = url.pathname.replace(/^\/api/, '');
    if (over[path]) return over[path];
    if (path === '/LoginUser') return { body: 'tok-c' };
    if (path === '/PickupLocations') return { body: [{ LocationId: 201234, Name: 'Depozit' }] };
    if (path === '/PudoPoints') return { body: [{ Id: 9001, Name: 'Ship & Go Kaufland', City: 'Cluj-Napoca', Address: 'Str. Fabricii 1' }, { Id: 9002, Name: 'Other', City: 'Dej', Address: 'x' }] };
    if (path === '/ShippingCalculation') return { body: { Subtotal: 15, Tax: 3.15, GrandTotal: 18.15 } };
    if (path === '/Awbs') return { body: 1012345678 };
    if (path === '/AwbDocuments') return { body: PDF };
    if (path === '/AwbTrace') return { body: [{ Code: '1012345678', Event: [] }] };
    return { status: 404, body: { message: 'no such page' } };
  };

const ours = (over = {}) => anOrder({ shipping: { id: 'cargus:home', name: 'Cargus', price: 2000, pickup: '' }, ...over });
const sentTo = (calls: { url: URL; body: string }[], path: string) => JSON.parse(calls.find((c) => c.url.pathname === `/api${path}`)!.body);

describe('the Cargus extension', () => {
  test('is a valid extension of the fourth format, and every action it declares is in its code', () => {
    const { problems, pkg } = parseExtension({ format: EXTENSION_FORMAT, manifest, code: 'export const actions = {}' });
    expect(problems).toEqual([]);
    for (const a of pkg!.manifest.actions) expect(Object.keys(actions)).toContain(a.name);
    expect(pkg!.manifest.egress).toEqual(['urgentcargus.azure-api.net']);
  });

  test('reads what Cargus answers', () => {
    expect(totalOf({ GrandTotal: 18.15 })).toBe(1815);
    expect(() => totalOf({})).toThrow('did not give a price');
    expect(whereOf([{ Event: [] }])).toBe('waiting');
    expect(whereOf([{ Event: [{ Description: 'Preluat de curier' }] }])).toBe('moving');
    expect(whereOf([{ Event: [{ Description: 'Preluat' }, { Description: 'Livrat' }] }])).toBe('delivered');
    expect(whereOf([{ Event: [{ Description: 'Nelivrat - adresa gresita' }] }])).toBe('moving');
    expect(whereOf([{ Event: [{ Description: 'Retur la expeditor' }] }])).toBe('returned');
    expect(lockersOf([{ Id: 1, Name: 'Box', City: 'Iaşi', StreetName: 'Str. Lungă', StreetNo: '3' }], 'iasi')).toEqual([{ id: '1', name: 'Box', address: 'Str. Lungă 3, Iaşi' }]);
    expect(labelOf(PDF)).toBe(PDF);
    expect(() => labelOf('error')).toThrow('did not give the label');
  });

  test('at checkout: the fixed price and Ship & Go points in the buyer’s town; Cargus’s price when chosen', async () => {
    const { host, calls } = courierHost(account, cargus());
    expect(await actions.quote(cart, host)).toEqual([
      { id: 'home', name: 'Cargus', price: 2000 },
      { id: 'locker', name: 'Ship & Go', price: 1500, points: [{ id: '9001', name: 'Ship & Go Kaufland', address: 'Str. Fabricii 1, Cluj-Napoca' }] },
    ]);
    expect(JSON.parse(calls[0]!.body)).toEqual({ UserName: 'shop', Password: 'pw' });
    expect(calls[1]!.headers).toMatchObject({ 'ocp-apim-subscription-key': 'sub-key', authorization: 'Bearer tok-c' });
    const priced = courierHost({ ...account, pricing: 'courier', lockers: false }, cargus());
    expect(await actions.quote(cart, priced.host)).toEqual([{ id: 'home', name: 'Cargus', price: 1815 }]);
    expect(sentTo(priced.calls, '/ShippingCalculation')).toMatchObject({ Sender: { LocationId: 201234 }, Recipient: { LocalityName: 'Cluj-Napoca', CountyName: 'Cluj' }, TotalWeight: 1, ServiceId: STANDARD });
  });

  test('the AWB: with cash on delivery, from the chosen pick-up point, to the door or a Ship & Go point; the label as Cargus gives it', async () => {
    const cod = ours({ payment: 'cod' });
    const { host, calls, files, moved } = courierHost({ ...account, location: '777' }, cargus(), [cod]);
    expect(await actions.awb({ order: cod }, host)).toBe('AWB 1012345678 made. Its label is on the order.');
    const made = sentTo(calls, '/Awbs');
    expect(made).toMatchObject({ Sender: { LocationId: 777 }, ServiceId: STANDARD, CashRepayment: 120, TotalWeight: 1, PackageContent: '2 × Mug', CustomString: 'order-7' });
    expect(made.Recipient).toMatchObject({ Name: 'Ana Pop', LocalityName: 'Cluj-Napoca', AddressText: 'Str. Mare 2', PhoneNumber: '0722000000' });
    expect(made).not.toHaveProperty('DeliveryPudoPoint');
    expect(calls.some((c) => c.url.pathname === '/api/PickupLocations')).toBe(false);
    const label = calls.find((c) => c.url.pathname === '/api/AwbDocuments')!;
    expect(label.url.searchParams.get('barCodes')).toBe('["1012345678"]');
    expect(files[0]).toMatchObject({ name: 'awb-1012345678.pdf', data: PDF });
    expect(moved).toEqual(['tracking o1 1012345678']);

    const boxed = ours({ id: 'b', shipping: { id: 'cargus:locker:9001', name: 'Ship & Go: Kaufland', price: 1500, pickup: 'x' } });
    const box = courierHost(account, cargus(), [boxed]);
    await actions.awb({ order: boxed }, box.host);
    expect(sentTo(box.calls, '/Awbs')).toMatchObject({ ServiceId: SHIP_AND_GO, DeliveryPudoPoint: 9001, CashRepayment: 0, Sender: { LocationId: 201234 } });
  });

  test('what Cargus refuses is said', async () => {
    const order = ours();
    const refused = courierHost(account, cargus({ '/LoginUser': { status: 401, body: { message: 'Access denied due to invalid subscription key.' } } }), [order]);
    await expect(actions.awb({ order }, refused.host)).rejects.toThrow('Cargus answered 401: Access denied due to invalid subscription key.');
    const odd = courierHost(account, cargus({ '/Awbs': { body: { Error: 'Localitate invalida' } } }), [order]);
    await expect(actions.awb({ order }, odd.host)).rejects.toThrow('Cargus did not make the AWB: {"Error":"Localitate invalida"}');
    expect(odd.rows.shipments).toEqual([]);
    const missing = courierHost({ ...account, api_key: '' }, cargus(), [order]);
    await expect(actions.awb({ order }, missing.host)).rejects.toThrow('Cargus: the API key is missing.');
  });

  test('the parcel followed until it is delivered', async () => {
    const order = ours();
    let trace: unknown = [{ Event: [{ Description: 'Preluat de curier' }] }];
    const { host, moved } = courierHost(account, (url, init) => (url.pathname === '/api/AwbTrace' ? { body: trace } : cargus()(url, init)), [order]);
    await actions.awb({ order }, host);
    await actions.follow({ input: { order: 'o1' } }, host);
    trace = [{ Event: [{ Description: 'Preluat de curier' }, { Description: 'Livrat' }] }];
    await actions.follow({ input: { order: 'o1' } }, host);
    expect(moved).toEqual(['tracking o1 1012345678', 'sent o1 1012345678', 'completed o1']);
  });
});

describe('the Cargus extension, packed and installed', () => {
  test('answers checkout through the program, from its own process', async () => {
    const { mkdtemp, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { packExtension } = await import('../tools/pack-extension.ts');
    const { extensionHost } = await import('../src/site/extensions.ts');
    const { Store } = await import('../src/site/store.ts');
    const dir = await mkdtemp(join(tmpdir(), 'uhlaka-cargus-'));
    try {
      const { file } = await packExtension('extensions/cargus', dir);
      const text = await Bun.file(file).text();
      const store = await Store.open(join(dir, 'site.db'));
      const reply = cargus();
      const host = extensionHost(store, {
        log: () => {},
        fetch: async (url, init) => {
          const a = reply(new URL(url), { method: String(init.method ?? 'GET'), headers: {}, body: String(init.body ?? '') });
          return new Response(JSON.stringify(a.body), { status: a.status ?? 200 });
        },
      });
      await host.install(text, (await host.offer(text)).sha256);
      await store.saveExtensionRow('cargus', 'settings', account);
      const ways = await host.checkout.deliveries({ lines: [], subtotal: 10000, weight: 800, currency: 'RON', address: place }, 'ro');
      expect(ways.map((w) => w.id)).toEqual(['cargus:home', 'cargus:locker:9001']);
      host.close();
      await store.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
