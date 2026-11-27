/**
 * The Sameday extension (ADR 0079): the price at checkout, easybox lockers,
 * the AWB with its label and cash on delivery, and the parcel followed. What
 * all three couriers share is tested with Fan Courier; here, what Sameday's
 * API is asked and answers.
 */
import { describe, expect, test } from 'bun:test';
import { EXTENSION_FORMAT, parseExtension } from '../src/core/index.ts';
import { actions, costOf, form, lockersOf, pickupOf, servicesOf, whereOf } from '../extensions/sameday/index.ts';
import manifest from '../extensions/sameday/manifest.json';
import { anOrder, courierHost, PDF, type Reply } from './fixtures/courier-host.ts';

const account = { username: 'shop', password: 'pw', demo: false, pricing: 'fixed', home_price: 20, locker_price: 15, free_from: null, default_weight: 1, lockers: true, auto_awb: false };
const place = { street: 'Str. Mare 2', town: 'Cluj-Napoca', county: 'Cluj', postcode: '400000' };
const cart = { subtotal: 10000, weight: 800, lines: [{ quantity: 2, weight: 400 }], address: place };

const sameday =
  (over: Partial<Record<string, ReturnType<Reply>>> = {}): Reply =>
  (url) => {
    const path = url.pathname;
    if (over[path]) return over[path];
    if (path === '/api/authenticate') return { body: { token: 'tok-s', expire_at: '2026-12-01 00:00' } };
    if (path === '/api/client/pickup-points') return { body: { data: [{ id: 11, defaultPickupPoint: false, contactPersons: [{ id: 1 }] }, { id: 12, defaultPickupPoint: true, contactPersons: [{ id: 2 }, { id: 3, defaultContactPerson: true }] }] } };
    if (path === '/api/client/services') return { body: { data: [{ id: 7, name: '24H', serviceCode: '24' }, { id: 15, name: 'Locker NextDay', serviceCode: 'LN' }] } };
    if (path === '/api/client/lockers') return { body: [{ lockerId: 501, name: 'easybox Iulius', city: 'Cluj-Napoca', address: 'Str. Alexandru Vaida Voevod 53B' }, { lockerId: 502, name: 'easybox Turda', city: 'Turda', address: 'x' }] };
    if (path === '/api/awb/estimate-cost') return { body: { amount: 17.85, currency: 'RON' } };
    if (path === '/api/awb') return { body: { awbNumber: '1SDY24000123', parcels: [] } };
    if (path.startsWith('/api/awb/download/')) return { body: '', base64: PDF };
    if (/^\/api\/client\/awb\/.+\/status$/.test(path)) return { body: { expeditionSummary: { delivered: false }, expeditionHistory: [{ statusLabel: 'AWB emis' }] } };
    return { status: 404, body: { message: 'no such page' } };
  };

const ours = (over = {}) => anOrder({ shipping: { id: 'sameday:home', name: 'Sameday', price: 2000, pickup: '' }, ...over });
const sent = (calls: { url: URL; body: string }[], path: string) => new URLSearchParams(calls.find((c) => c.url.pathname === path)!.body);

describe('the Sameday extension', () => {
  test('is a valid extension of the fourth format, and every action it declares is in its code', () => {
    const { problems, pkg } = parseExtension({ format: EXTENSION_FORMAT, manifest, code: 'export const actions = {}' });
    expect(problems).toEqual([]);
    for (const a of pkg!.manifest.actions) expect(Object.keys(actions)).toContain(a.name);
    expect(pkg!.manifest.egress).toEqual(['api.sameday.ro', 'sameday-api.demo.zitec.com']);
  });

  test('reads what Sameday answers', () => {
    expect(pickupOf({ data: [{ id: 1, contactPersons: [{ id: 9 }] }] })).toEqual({ point: '1', person: '9' });
    expect(() => pickupOf({ data: [] })).toThrow('no pick-up point');
    expect(servicesOf({ data: [{ id: 3, name: '24H' }, { id: 4, name: 'Locker NextDay' }] })).toEqual({ home: '3', locker: '4' });
    expect(() => servicesOf({ data: [] })).toThrow('no 24H service');
    expect(costOf({ amount: 17.85 })).toBe(1785);
    expect(() => costOf({})).toThrow('did not give a price');
    expect(whereOf({ expeditionHistory: [{ statusLabel: 'AWB emis' }] })).toBe('waiting');
    expect(whereOf({ expeditionHistory: [{ statusLabel: 'AWB emis' }, { statusLabel: 'Preluat de curier' }] })).toBe('moving');
    expect(whereOf({ expeditionSummary: { delivered: true }, expeditionHistory: [] })).toBe('delivered');
    expect(whereOf({ expeditionHistory: [{ statusLabel: 'Nelivrat - destinatar absent' }] })).toBe('moving');
    expect(whereOf({ expeditionHistory: [{ statusLabel: 'Returnat la expeditor' }] })).toBe('returned');
    expect(lockersOf({ data: [{ lockerId: 1, name: 'Box', city: 'Bucureşti', address: 'Str. 1' }] }, 'Bucuresti')).toEqual([{ id: '1', name: 'Box', address: 'Str. 1, Bucureşti' }]);
    expect(form({ a: 1, b: { c: 'x y', d: '' }, e: null })).toEqual(['a=1', 'b%5Bc%5D=x%20y']);
  });

  test('at checkout: the fixed price and easyboxes in the buyer’s town; Sameday’s price when chosen', async () => {
    const { host } = courierHost(account, sameday());
    expect(await actions.quote(cart, host)).toEqual([
      { id: 'home', name: 'Sameday', price: 2000 },
      { id: 'locker', name: 'easybox', price: 1500, points: [{ id: '501', name: 'easybox Iulius', address: 'Str. Alexandru Vaida Voevod 53B, Cluj-Napoca' }] },
    ]);
    const priced = courierHost({ ...account, pricing: 'courier', lockers: false }, sameday());
    expect(await actions.quote(cart, priced.host)).toEqual([{ id: 'home', name: 'Sameday', price: 1785 }]);
    const asked = sent(priced.calls, '/api/awb/estimate-cost');
    expect(asked.get('service')).toBe('7');
    expect(asked.get('packageWeight')).toBe('0.8');
    expect(asked.get('awbRecipient[cityString]')).toBe('Cluj-Napoca');
    expect(priced.calls[0]!.headers).toMatchObject({ 'x-auth-username': 'shop', 'x-auth-password': 'pw' });
    expect(priced.calls[1]!.headers['x-auth-token']).toBe('tok-s');
  });

  test('the demo account is called on its own host', async () => {
    const { host, calls } = courierHost({ ...account, demo: true, pricing: 'courier', lockers: false }, sameday());
    await actions.quote(cart, host);
    expect(new Set(calls.map((c) => c.url.host))).toEqual(new Set(['sameday-api.demo.zitec.com']));
  });

  test('the AWB: from the account’s default pick-up point, with cash on delivery, to the door or an easybox', async () => {
    const cod = ours({ payment: 'cod' });
    const { host, calls, files, moved } = courierHost(account, sameday(), [cod]);
    expect(await actions.awb({ order: cod }, host)).toBe('AWB 1SDY24000123 made. Its label is on the order.');
    const made = sent(calls, '/api/awb');
    expect(made.get('pickupPoint')).toBe('12');
    expect(made.get('contactPerson')).toBe('3');
    expect(made.get('service')).toBe('7');
    expect(made.get('cashOnDelivery')).toBe('120');
    expect(made.get('awbRecipient[name]')).toBe('Ana Pop');
    expect(made.get('awbRecipient[phoneNumber]')).toBe('0722000000');
    expect(made.get('clientInternalReference')).toBe('order-7');
    expect(made.get('lockerLastMile')).toBeNull();
    expect(files[0]).toMatchObject({ name: 'awb-1SDY24000123.pdf', data: PDF });
    expect(calls.some((c) => c.url.pathname === '/api/awb/download/1SDY24000123')).toBe(true);
    expect(moved).toEqual(['tracking o1 1SDY24000123']);

    const boxed = ours({ id: 'b', shipping: { id: 'sameday:locker:501', name: 'easybox: Iulius', price: 1500, pickup: 'x' } });
    const box = courierHost(account, sameday(), [boxed]);
    await actions.awb({ order: boxed }, box.host);
    const toBox = sent(box.calls, '/api/awb');
    expect(toBox.get('service')).toBe('15');
    expect(toBox.get('lockerLastMile')).toBe('501');
    expect(toBox.get('cashOnDelivery')).toBe('0');
  });

  test('what Sameday refuses is said', async () => {
    const order = ours();
    const refused = courierHost(account, sameday({ '/api/authenticate': { status: 401, body: { message: 'Bad credentials' } } }), [order]);
    await expect(actions.awb({ order }, refused.host)).rejects.toThrow('Sameday answered 401: Bad credentials');
    const noAwb = courierHost(account, sameday({ '/api/awb': { status: 400, body: { message: 'Validation failed' } } }), [order]);
    await expect(actions.awb({ order }, noAwb.host)).rejects.toThrow('Sameday answered 400: Validation failed');
    expect(noAwb.rows.shipments).toEqual([]);
  });

  test('the parcel followed until it is delivered', async () => {
    const order = ours();
    let status: unknown = { expeditionHistory: [{ statusLabel: 'Preluat de curier' }] };
    const { host, moved } = courierHost(account, (url, init) => (url.pathname.endsWith('/status') ? { body: status } : sameday()(url, init)), [order]);
    await actions.awb({ order }, host);
    await actions.follow({ input: { order: 'o1' } }, host);
    status = { expeditionSummary: { delivered: true }, expeditionHistory: [] };
    await actions.follow({ input: { order: 'o1' } }, host);
    expect(moved).toEqual(['tracking o1 1SDY24000123', 'sent o1 1SDY24000123', 'completed o1']);
  });
});

describe('the Sameday extension, packed and installed', () => {
  test('answers checkout through the program, from its own process', async () => {
    const { mkdtemp, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { packExtension } = await import('../tools/pack-extension.ts');
    const { extensionHost } = await import('../src/site/extensions.ts');
    const { Store } = await import('../src/site/store.ts');
    const dir = await mkdtemp(join(tmpdir(), 'uhlaka-sameday-'));
    try {
      const { file } = await packExtension('extensions/sameday', dir);
      const text = await Bun.file(file).text();
      const store = await Store.open(join(dir, 'site.db'));
      const reply = sameday();
      const host = extensionHost(store, {
        log: () => {},
        fetch: async (url, init) => {
          const a = reply(new URL(url), { method: String(init.method ?? 'GET'), headers: {}, body: String(init.body ?? '') });
          return new Response(typeof a.body === 'string' ? a.body : JSON.stringify(a.body), { status: a.status ?? 200 });
        },
      });
      await host.install(text, (await host.offer(text)).sha256);
      await store.saveExtensionRow('sameday', 'settings', account);
      const ways = await host.checkout.deliveries({ lines: [], subtotal: 10000, weight: 800, currency: 'RON', address: place }, 'ro');
      expect(ways.map((w) => w.id)).toEqual(['sameday:home', 'sameday:locker:501']);
      host.close();
      await store.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
