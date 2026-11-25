/**
 * The Stripe extension (ADR 0076 d5): a Checkout Session for the order, the
 * webhook checked by its signature, a payment checked later where no webhook
 * comes, and a refund from the order.
 */
import { describe, expect, test } from 'bun:test';
import { EXTENSION_FORMAT, extensionAsks, parseExtension } from '../src/core/index.ts';
import type { ExtensionHost } from '../src/site/extension-runner.ts';
import { actions, form, signed } from '../extensions/stripe/index.ts';
import manifest from '../extensions/stripe/manifest.json';

const SECRET = 'whsec_test';

/** A host with the extension's rows in memory, and Stripe answering as the test says. */
function fakeHost(stripe: (method: string, url: string, body: string) => { status?: number; body: unknown }) {
  const rows: Record<string, Record<string, unknown>[]> = { settings: [{ id: 's', secret_key: 'sk_test_1', webhook_secret: SECRET }], payments: [] };
  const sent: { method: string; url: string; body: string; headers: Record<string, string> }[] = [];
  const later: { action: string; input: unknown; minutes: number }[] = [];
  const orders: string[] = [];
  let n = 0;
  const host = {
    collections: {
      list: async (c: string) => rows[c] ?? [],
      insert: async (c: string, row: Record<string, unknown>) => {
        const made = { state: 'open', intent: '', ...row, id: `r${++n}` };
        rows[c]?.push(made);
        return made;
      },
      update: async (c: string, id: string, row: Record<string, unknown>) => Object.assign(rows[c]?.find((r) => r.id === id) ?? {}, row),
      find: async (c: string, q: { where?: Record<string, unknown> }) => {
        const found = (rows[c] ?? []).filter((r) => Object.entries(q.where ?? {}).every(([k, v]) => r[k] === v)).reverse();
        return { rows: found.slice(0, 1), count: found.length };
      },
    },
    fetch: async (url: string, init?: { method?: string; body?: string; headers?: Record<string, string> }) => {
      sent.push({ method: init?.method ?? 'GET', url, body: init?.body ?? '', headers: init?.headers ?? {} });
      const a = stripe(init?.method ?? 'GET', url, init?.body ?? '');
      return { status: a.status ?? 200, headers: {}, body: JSON.stringify(a.body) };
    },
    later: async (action: string, input: unknown, minutes: number) => (later.push({ action, input, minutes }), 'q1'),
    orders: {
      paid: async (id: string) => (orders.push(`paid ${id}`), {}),
      refunded: async (id: string) => (orders.push(`refunded ${id}`), {}),
    },
  } as unknown as ExtensionHost;
  return { host, rows, sent, later, orders };
}

async function signature(body: string, at = Math.floor(Date.now() / 1000), secret = SECRET): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${at}.${body}`)));
  return `t=${at},v1=${[...mac].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

const order = { id: 'ord_1', number: 7, total: 12500, state: 'waiting', currency: 'RON', email: 'ana@example.com', language: 'ro' };

describe('the Stripe extension', () => {
  test('is a package of the fourth format, and says what it asks for', () => {
    const { pkg, problems } = parseExtension({ format: EXTENSION_FORMAT, manifest, code: 'export const actions = {};' });
    expect(problems).toEqual([]);
    expect(extensionAsks(pkg!.manifest)).toMatchObject({ payments: ['Card'], egress: ['api.stripe.com', 'checkout.stripe.com'], routes: ['/_/x/stripe/webhook'], later: ['Check a payment'], shop: true });
  });

  test('a form in Stripe\'s nested names', () => {
    expect(form({ a: 1, b: { c: 'x y', d: { 0: { e: 2 } } }, f: undefined })).toEqual(['a=1', 'b%5Bc%5D=x%20y', 'b%5Bd%5D%5B0%5D%5Be%5D=2']);
  });

  test('pays: a session for the total, the buyer sent to Stripe, a check queued', async () => {
    const { host, rows, sent, later } = fakeHost(() => ({ body: { id: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1' } }));
    const answer = await actions.pay({ method: 'card', order, back: 'https://example.com/_/order/s3cret?said=paying' }, host);
    expect(answer).toEqual({ redirect: 'https://checkout.stripe.com/c/pay/cs_1' });
    const body = new URLSearchParams(sent[0]!.body);
    expect(sent[0]!.url).toBe('https://api.stripe.com/v1/checkout/sessions');
    expect(sent[0]!.headers.authorization).toBe('Bearer sk_test_1');
    expect(Object.fromEntries(body)).toMatchObject({
      mode: 'payment',
      success_url: 'https://example.com/_/order/s3cret?said=paying',
      'line_items[0][price_data][currency]': 'ron',
      'line_items[0][price_data][unit_amount]': '12500',
      'metadata[order]': 'ord_1',
      locale: 'ro',
      customer_email: 'ana@example.com',
    });
    expect(rows.payments).toMatchObject([{ session: 'cs_1', order: 'ord_1', amount: 12500, state: 'open' }]);
    expect(later).toEqual([{ action: 'check', input: { session: 'cs_1' }, minutes: 15 }]);
  });

  test('without a key it says where to add one', async () => {
    const { host, rows } = fakeHost(() => ({ body: {} }));
    rows.settings = [];
    await expect(actions.pay({ method: 'card', order, back: 'https://example.com/x' }, host)).rejects.toThrow('Stripe has no secret key yet');
  });

  test('a webhook: only one Stripe signed, recently; a session paid marks the order paid, once', async () => {
    const { host, rows, orders } = fakeHost(() => ({ body: {} }));
    rows.payments!.push({ id: 'p1', session: 'cs_1', order: 'ord_1', number: 7, amount: 12500, currency: 'RON', intent: '', state: 'open' });
    const body = JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_1', payment_status: 'paid', payment_intent: 'pi_1' } } });
    expect(await actions.webhook({ body, headers: { 'stripe-signature': await signature(body, Math.floor(Date.now() / 1000), 'whsec_other') } }, host)).toEqual({ status: 400, body: 'not signed by Stripe' });
    expect(await actions.webhook({ body, headers: { 'stripe-signature': await signature(body, Math.floor(Date.now() / 1000) - 600) } }, host)).toMatchObject({ status: 400 });
    expect(await actions.webhook({ body: body.replace('paid"', 'paid" '), headers: { 'stripe-signature': await signature(body) } }, host)).toMatchObject({ status: 400 });
    expect(orders).toEqual([]);
    expect(await actions.webhook({ body, headers: { 'stripe-signature': await signature(body) } }, host)).toEqual({ status: 200, body: 'ok' });
    expect(rows.payments![0]).toMatchObject({ state: 'paid', intent: 'pi_1' });
    expect(orders).toEqual(['paid ord_1']);
    // A session of another site on the same account is heard and left.
    const other = JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_9', payment_status: 'paid' } } });
    expect(await actions.webhook({ body: other, headers: { 'stripe-signature': await signature(other) } }, host)).toEqual({ status: 200, body: 'ok' });
    // A refund made on Stripe's dashboard.
    const refunded = JSON.stringify({ type: 'charge.refunded', data: { object: { payment_intent: 'pi_1', refunded: true } } });
    await actions.webhook({ body: refunded, headers: { 'stripe-signature': await signature(refunded) } }, host);
    expect(orders).toEqual(['paid ord_1', 'refunded ord_1']);
    expect(await signed('nonsense', body, SECRET)).toBe(false);
  });

  test('a check: an open session fails so it is tried again; a paid one marks the order', async () => {
    let status = 'unpaid';
    const { host, rows, orders } = fakeHost(() => ({ body: { id: 'cs_1', status: 'open', payment_status: status, payment_intent: 'pi_1' } }));
    rows.payments!.push({ id: 'p1', session: 'cs_1', order: 'ord_1', number: 7, amount: 12500, currency: 'RON', intent: '', state: 'open' });
    await expect(actions.check({ input: { session: 'cs_1' } }, host)).rejects.toThrow('order 7 is not paid yet');
    status = 'paid';
    await actions.check({ input: { session: 'cs_1' } }, host);
    expect(orders).toEqual(['paid ord_1']);
    // Paid already: nothing more is asked.
    await actions.check({ input: { session: 'cs_1' } }, host);
    expect(orders).toEqual(['paid ord_1']);
    expect(await actions.checkOrder({ order }, host)).toBe('Stripe: paid.');
  });

  test('a refund from the order: the whole payment back, once, and the order refunded', async () => {
    const { host, rows, sent, orders } = fakeHost(() => ({ body: { id: 're_1' } }));
    await expect(actions.refund({ order }, host)).rejects.toThrow('This order has no card payment to refund.');
    rows.payments!.push({ id: 'p1', session: 'cs_1', order: 'ord_1', number: 7, amount: 12500, currency: 'RON', intent: 'pi_1', state: 'paid' });
    expect(await actions.refund({ order }, host)).toBe('Refunded.');
    expect(sent[0]).toMatchObject({ url: 'https://api.stripe.com/v1/refunds', headers: { 'idempotency-key': 'refund-pi_1' } });
    expect(new URLSearchParams(sent[0]!.body).get('payment_intent')).toBe('pi_1');
    expect(orders).toEqual(['refunded ord_1']);
    await expect(actions.refund({ order }, host)).rejects.toThrow('no card payment to refund');
  });

  test('what Stripe refuses is said', async () => {
    const { host } = fakeHost(() => ({ status: 401, body: { error: { message: 'Invalid API Key provided' } } }));
    await expect(actions.pay({ method: 'card', order, back: 'https://example.com/x' }, host)).rejects.toThrow('Stripe answered 401: Invalid API Key provided');
  });
});

describe('the Stripe extension, packed and installed', () => {
  test('runs in its own process: pays through the program\'s fetch, and a webhook not signed is refused', async () => {
    const { mkdtemp, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { packExtension } = await import('../tools/pack-extension.ts');
    const { extensionHost } = await import('../src/site/extensions.ts');
    const { Store } = await import('../src/site/store.ts');
    const dir = await mkdtemp(join(tmpdir(), 'uhlaka-stripe-'));
    try {
      const { file } = await packExtension('extensions/stripe', dir);
      const text = await Bun.file(file).text();
      expect(JSON.parse(text).format).toBe(EXTENSION_FORMAT);
      const store = await Store.open(join(dir, 'site.db'));
      const called: string[] = [];
      const host = extensionHost(store, {
        log: () => {},
        fetch: async (url) => (called.push(url), new Response(JSON.stringify({ id: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1' }))),
      });
      await host.install(text, (await host.offer(text)).sha256);
      await store.saveExtensionRow('stripe', 'settings', { secret_key: 'sk_test_1', webhook_secret: SECRET });
      expect(await host.checkout.payments('ro')).toEqual([{ id: 'stripe:card', label: 'Card', hint: '' }]);
      const to = await host.checkout.pay('stripe:card', { order: { ...order, buyer: {} as never, lines: [], shipping: {} as never, totals: {} as never }, back: 'https://example.com/_/order/s' });
      expect(to).toBe('https://checkout.stripe.com/c/pay/cs_1');
      expect(called).toEqual(['https://api.stripe.com/v1/checkout/sessions']);
      expect(await store.laterCount('stripe')).toBe(1);
      const refused = await host.route('stripe', 'webhook', new Request('https://example.com/_/x/stripe/webhook', { method: 'POST', body: '{}' }));
      expect(refused.status).toBe(400);
      host.close();
      await store.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
