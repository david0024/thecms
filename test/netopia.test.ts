/**
 * The NETOPIA Payments extension (ADR 0076 d5): a payment started on
 * NETOPIA's page, and its notice believed only when NETOPIA signed it.
 */
import { describe, expect, test } from 'bun:test';
import { EXTENSION_FORMAT, extensionAsks, parseExtension } from '../src/core/index.ts';
import type { ExtensionHost } from '../src/site/extension-runner.ts';
import { actions, amountOf, names, verified } from '../extensions/netopia/index.ts';
import manifest from '../extensions/netopia/manifest.json';

const POS = 'AAAA-BBBB-CCCC-DDDD-EEEE';
const pair = (await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-512' }, true, ['sign', 'verify'])) as CryptoKeyPair;
const other = (await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-512' }, true, ['sign', 'verify'])) as CryptoKeyPair;
const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey));
const PEM = `-----BEGIN PUBLIC KEY-----\n${btoa(String.fromCharCode(...spki)).replace(/(.{64})/g, '$1\n')}\n-----END PUBLIC KEY-----`;

const b64url = (bytes: Uint8Array | string): string => btoa(typeof bytes === 'string' ? bytes : String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** A token as NETOPIA makes one for a notice's body. */
async function token(body: string, over: Record<string, unknown> = {}, key = pair.privateKey): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-512', new TextEncoder().encode(body)));
  const head = b64url(JSON.stringify({ alg: 'RS512', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({ iss: 'NETOPIA Payments', aud: [POS], sub: btoa(String.fromCharCode(...digest)), iat: Math.floor(Date.now() / 1000), ...over }));
  const signature = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${head}.${claims}`)));
  return `${head}.${claims}.${b64url(signature)}`;
}

function fakeHost(netopia: (url: string, body: Record<string, unknown>, headers: Record<string, string>) => { status?: number; body: unknown }) {
  const rows: Record<string, Record<string, unknown>[]> = { settings: [{ id: 's', api_key: 'key-1', pos_signature: POS, public_key: PEM, sandbox: true }], payments: [] };
  const sent: { url: string; body: Record<string, unknown>; headers: Record<string, string> }[] = [];
  const orders: string[] = [];
  let n = 0;
  const host = {
    collections: {
      list: async (c: string) => rows[c] ?? [],
      insert: async (c: string, row: Record<string, unknown>) => {
        const made = { ...row, id: `r${++n}` };
        rows[c]?.push(made);
        return made;
      },
      update: async (c: string, id: string, row: Record<string, unknown>) => Object.assign(rows[c]?.find((r) => r.id === id) ?? {}, row),
      find: async (c: string, q: { where?: Record<string, unknown> }) => {
        const found = (rows[c] ?? []).filter((r) => Object.entries(q.where ?? {}).every(([k, v]) => r[k] === v));
        return { rows: found, count: found.length };
      },
    },
    fetch: async (url: string, init?: { body?: string; headers?: Record<string, string> }) => {
      const body = JSON.parse(init?.body ?? '{}') as Record<string, unknown>;
      sent.push({ url, body, headers: init?.headers ?? {} });
      const a = netopia(url, body, init?.headers ?? {});
      return { status: a.status ?? 200, headers: {}, body: JSON.stringify(a.body) };
    },
    orders: { paid: async (id: string) => (orders.push(`paid ${id}`), {}) },
  } as unknown as ExtensionHost;
  return { host, rows, sent, orders };
}

const ask = {
  method: 'card',
  back: 'https://shop.example/_/order/s3cret?said=paying',
  order: {
    id: 'ord_1',
    number: 7,
    total: 12550,
    currency: 'RON',
    language: 'ro',
    email: 'ana@example.com',
    buyer: { name: 'Ana Maria Pop', email: 'ana@example.com', phone: '0722000000', street: 'Str. Mare 2', town: 'Cluj-Napoca', county: 'Cluj', postcode: '400000' },
    lines: [{ name: 'Mug', sku: 'MUG', price: 5000, quantity: 2, rate: 21 }],
  },
};

describe('the NETOPIA extension', () => {
  test('is a package of the fourth format, and says what it asks for', () => {
    const { pkg, problems } = parseExtension({ format: EXTENSION_FORMAT, manifest, code: 'export const actions = {};' });
    expect(problems).toEqual([]);
    expect(extensionAsks(pkg!.manifest)).toMatchObject({ payments: ['Card (NETOPIA)'], routes: ['/_/x/netopia/notify'], shop: true });
  });

  test('amounts with two decimals, a name in two', () => {
    expect(amountOf(12550)).toBe(125.5);
    expect(names('Ana Maria Pop')).toEqual({ firstName: 'Ana', lastName: 'Maria Pop' });
    expect(names('Ana')).toEqual({ firstName: 'Ana', lastName: 'Ana' });
  });

  test('pays: a payment started without a card, the buyer sent to NETOPIA\'s page; each try with its own reference', async () => {
    const { host, rows, sent } = fakeHost(() => ({ body: { payment: { ntpID: '1310396', status: 1, paymentURL: 'https://secure.sandbox.netopia-payments.com/ui/card?p=abc' }, error: { code: '101', message: 'Redirect user to payment page' } } }));
    expect(await actions.pay(ask, host)).toEqual({ redirect: 'https://secure.sandbox.netopia-payments.com/ui/card?p=abc' });
    expect(sent[0]!.url).toBe('https://secure.sandbox.netopia-payments.com/payment/card/start');
    expect(sent[0]!.headers.authorization).toBe('key-1');
    expect(sent[0]!.body).toMatchObject({
      config: { notifyUrl: 'https://shop.example/_/x/netopia/notify', redirectUrl: ask.back, language: 'ro' },
      payment: { instrument: null },
      order: { posSignature: POS, orderID: '7-1', amount: 125.5, currency: 'RON', billing: { firstName: 'Ana', lastName: 'Maria Pop', city: 'Cluj-Napoca', country: 642, email: 'ana@example.com' }, products: [{ name: 'Mug', code: 'MUG', price: 100, vat: 21 }] },
    });
    await actions.pay(ask, host);
    expect(rows.payments!.map((p) => p.reference)).toEqual(['7-1', '7-2']);
    expect(rows.payments![0]).toMatchObject({ ntp: '1310396', state: 'open', amount: 12550 });
  });

  test('what NETOPIA refuses is said', async () => {
    const { host } = fakeHost(() => ({ status: 401, body: { error: { code: '401', message: 'Unauthorized' } } }));
    await expect(actions.pay(ask, host)).rejects.toThrow('NETOPIA answered 401: Unauthorized');
  });

  test('a notice: believed only when NETOPIA signed it, for this point of sale and this body; paid marks the order', async () => {
    const { host, rows, orders } = fakeHost(() => ({ body: {} }));
    rows.payments!.push({ id: 'p1', reference: '7-1', order: 'ord_1', number: 7, amount: 12550, state: 'open', ntp: '' });
    const body = JSON.stringify({ order: { orderID: '7-1' }, payment: { status: 3, ntpID: '1310396', amount: 125.5 } });
    const s = { public_key: PEM, pos_signature: POS };
    expect(await verified(await token(body), body, s)).toBe(true);
    expect(await verified(await token(body, {}, other.privateKey), body, s)).toBe(false);
    expect(await verified(await token(body, { aud: ['ZZZZ'] }), body, s)).toBe(false);
    expect(await verified(await token(body, { iss: 'someone' }), body, s)).toBe(false);
    expect(await verified(await token(body), body.replace('3', '5'), s)).toBe(false);
    expect(await verified('not.a.token', body, s)).toBe(false);

    expect(await actions.notify({ body, headers: { 'verification-token': await token(body, {}, other.privateKey) } }, host)).toMatchObject({ status: 400 });
    expect(orders).toEqual([]);
    const heard = await actions.notify({ body, headers: { 'verification-token': await token(body) } }, host);
    expect(heard).toMatchObject({ status: 200 });
    expect(JSON.parse(heard.body)).toEqual({ errorType: 0, errorCode: null, errorMessage: '' });
    expect(orders).toEqual(['paid ord_1']);
    expect(rows.payments![0]).toMatchObject({ state: 'paid', ntp: '1310396' });
    // A payment of another shop on the account is heard and left.
    const elsewhere = JSON.stringify({ order: { orderID: '99-1' }, payment: { status: 3 } });
    expect(await actions.notify({ body: elsewhere, headers: { 'verification-token': await token(elsewhere) } }, host)).toMatchObject({ status: 200 });
    expect(orders).toEqual(['paid ord_1']);
  });
});
