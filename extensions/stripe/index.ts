/**
 * Card payments through Stripe Checkout (ADR 0076 d3, d5), an extension in
 * the fourth format. At checkout it makes a Checkout Session for the order's
 * total and sends the buyer to Stripe's page; Stripe tells this extension's
 * route when the payment is made, and the order is marked paid. A check
 * queued once, tried again with a growing wait, marks it paid too where the
 * webhook was never set up. A refund is an action on the order.
 *
 * Every call to Stripe goes through `host.fetch`, to the hosts the manifest
 * declares; the keys are the owner's, kept as secrets.
 */
type Host = import('../../src/site/extension-runner.ts').ExtensionHost;

const API = 'https://api.stripe.com/v1';
/** How far a webhook's time may be from now, as Stripe's own libraries allow. */
export const TOLERANCE_SECONDS = 300;
/** The first check of a payment, when the buyer has had time to pay. */
const FIRST_CHECK_MINUTES = 15;

interface Settings {
  secret_key: string;
  webhook_secret: string;
}

interface Payment {
  id: string;
  session: string;
  order: string;
  number: number;
  amount: number;
  currency: string;
  intent: string;
  state: 'open' | 'paid' | 'expired' | 'refunded';
}

interface LentOrder {
  id: string;
  number: number;
  total?: number;
  state: string;
  currency: string;
  email: string;
  language: string;
  totals?: { total: number };
}

async function settings(host: Host): Promise<Settings> {
  const [row] = (await host.collections.list('settings')) as unknown as Settings[];
  if (!row?.secret_key) throw new Error('Stripe has no secret key yet: add it in Extensions → Stripe');
  return row;
}

/** Stripe's API takes forms, with nested names: `line_items[0][price_data][currency]`. */
export function form(values: Record<string, unknown>, prefix = ''): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (typeof value === 'object') out.push(...form(value as Record<string, unknown>, name));
    else out.push(`${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`);
  }
  return out;
}

async function stripe(host: Host, key: string, method: 'GET' | 'POST', path: string, body?: Record<string, unknown>, idempotency?: string): Promise<Record<string, unknown>> {
  const answer = await host.fetch(`${API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${key}`,
      ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
      ...(idempotency ? { 'idempotency-key': idempotency } : {}),
      'stripe-version': '2024-06-20',
    },
    body: body ? form(body).join('&') : undefined,
  });
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(answer.body) as Record<string, unknown>;
  } catch {
    // Not JSON: said below by the status.
  }
  if (answer.status >= 400) {
    const error = (parsed.error ?? {}) as { message?: string };
    throw new Error(`Stripe answered ${answer.status}: ${error.message ?? answer.body.slice(0, 200)}`);
  }
  return parsed;
}

/** The languages Stripe Checkout speaks, of those a site may be in; the rest is left to the buyer's browser. */
const LOCALES = ['bg', 'cs', 'da', 'de', 'el', 'en', 'es', 'et', 'fi', 'fr', 'hr', 'hu', 'it', 'lt', 'lv', 'nl', 'pl', 'pt', 'ro', 'sk', 'sl', 'sv'];

/**
 * Checks Stripe's signature on a webhook: HMAC-SHA256 of `<t>.<body>` with
 * the signing secret, one of the `v1` values in the header, and a time no
 * further than TOLERANCE_SECONDS from now.
 */
export async function signed(header: string, body: string, secret: string, now = Date.now()): Promise<boolean> {
  const parts = header.split(',').map((p) => p.trim().split('='));
  const t = parts.find(([k]) => k === 't')?.[1] ?? '';
  const given = parts.filter(([k]) => k === 'v1').map(([, v]) => v ?? '');
  if (!/^\d+$/.test(t) || !given.length || Math.abs(now / 1000 - Number(t)) > TOLERANCE_SECONDS) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${body}`)));
  const hex = [...mac].map((b) => b.toString(16).padStart(2, '0')).join('');
  // Compared in a time that does not depend on where they differ.
  return given.some((v) => v.length === hex.length && [...v].reduce((d, c, i) => d | (c.charCodeAt(0) ^ hex.charCodeAt(i)), 0) === 0);
}

async function paymentOf(host: Host, where: Record<string, unknown>): Promise<Payment | null> {
  const { rows } = await host.collections.find('payments', { where, order: '-id', limit: 1 });
  return (rows[0] as unknown as Payment | undefined) ?? null;
}

/** A session Stripe says is paid: the payment is kept as paid, and so is the order. */
async function settle(host: Host, payment: Payment, session: Record<string, unknown>): Promise<'paid' | 'open' | 'expired'> {
  const intent = typeof session.payment_intent === 'string' ? session.payment_intent : payment.intent;
  if (session.payment_status === 'paid' || session.payment_status === 'no_payment_required') {
    if (payment.state !== 'paid' && payment.state !== 'refunded') await host.collections.update('payments', payment.id, { state: 'paid', intent });
    await host.orders.paid(payment.order);
    return 'paid';
  }
  if (session.status === 'expired') {
    if (payment.state === 'open') await host.collections.update('payments', payment.id, { state: 'expired' });
    return 'expired';
  }
  return 'open';
}

export const actions = {
  /** `checkout.payment`: a Checkout Session for the order's total, and where the buyer pays it. */
  async pay(input: { method: string; order: LentOrder & { total: number }; back: string }, host: Host): Promise<{ redirect: string }> {
    const { secret_key } = await settings(host);
    const order = input.order;
    const language = order.language.split('-')[0] ?? '';
    const session = await stripe(
      host,
      secret_key,
      'POST',
      '/checkout/sessions',
      {
        mode: 'payment',
        success_url: input.back,
        cancel_url: input.back,
        client_reference_id: order.id,
        customer_email: order.email || undefined,
        locale: LOCALES.includes(language) ? language : 'auto',
        metadata: { order: order.id, number: order.number },
        payment_intent_data: { metadata: { order: order.id, number: order.number } },
        line_items: { 0: { quantity: 1, price_data: { currency: order.currency.toLowerCase(), unit_amount: order.total, product_data: { name: `#${order.number}` } } } },
      },
    );
    const id = String(session.id ?? '');
    const url = String(session.url ?? '');
    if (!id || !url) throw new Error('Stripe did not give a session');
    await host.collections.insert('payments', { session: id, order: order.id, number: order.number, amount: order.total, currency: order.currency, state: 'open' });
    // In case the webhook is not set up, or does not come: the payment is asked about later.
    await host.later('check', { session: id }, FIRST_CHECK_MINUTES);
    return { redirect: url };
  },

  /** Stripe's webhook: a session paid, or a payment refunded on Stripe's dashboard. */
  async webhook(input: { body: string; headers: Record<string, string> }, host: Host): Promise<{ status: number; body: string }> {
    const { webhook_secret } = await settings(host);
    if (!webhook_secret) return { status: 503, body: 'the webhook signing secret is not set' };
    if (!(await signed(input.headers['stripe-signature'] ?? '', input.body, webhook_secret))) return { status: 400, body: 'not signed by Stripe' };
    const event = JSON.parse(input.body) as { type?: string; data?: { object?: Record<string, unknown> } };
    const object = event.data?.object ?? {};
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded' || event.type === 'checkout.session.expired') {
      const payment = await paymentOf(host, { session: String(object.id ?? '') });
      // A session this site did not make (another site on the same account): heard, and left.
      if (payment) await settle(host, payment, object);
      return { status: 200, body: 'ok' };
    }
    if (event.type === 'charge.refunded' && object.refunded === true) {
      const payment = await paymentOf(host, { intent: String(object.payment_intent ?? '') });
      if (payment && payment.state !== 'refunded') {
        await host.collections.update('payments', payment.id, { state: 'refunded' });
        await host.orders.refunded(payment.order);
      }
    }
    return { status: 200, body: 'ok' };
  },

  /** Queued once for each session: still open, it is asked again, waiting longer each time. */
  async check(input: { input: { session: string } }, host: Host): Promise<void> {
    const payment = await paymentOf(host, { session: input.input.session });
    if (!payment || payment.state !== 'open') return;
    const { secret_key } = await settings(host);
    const session = await stripe(host, secret_key, 'GET', `/checkout/sessions/${encodeURIComponent(payment.session)}`);
    if ((await settle(host, payment, session)) === 'open') throw new Error(`order ${payment.number} is not paid yet`);
  },

  /** On an order: asks Stripe now, for the owner who does not want to wait. */
  async checkOrder(input: { order: LentOrder }, host: Host): Promise<string> {
    const payment = await paymentOf(host, { order: input.order.id });
    if (!payment) return 'This order was not paid by card.';
    if (payment.state === 'paid' || payment.state === 'refunded') return `Stripe: ${payment.state}.`;
    const { secret_key } = await settings(host);
    const said = await settle(host, payment, await stripe(host, secret_key, 'GET', `/checkout/sessions/${encodeURIComponent(payment.session)}`));
    return `Stripe: ${said}.`;
  },

  /** On an order: gives the whole payment back to the card, and marks the order refunded. */
  async refund(input: { order: LentOrder }, host: Host): Promise<string> {
    const payment = await paymentOf(host, { order: input.order.id, state: 'paid' });
    if (!payment?.intent) throw new Error('This order has no card payment to refund.');
    const { secret_key } = await settings(host);
    await stripe(host, secret_key, 'POST', '/refunds', { payment_intent: payment.intent, metadata: { order: payment.order } }, `refund-${payment.intent}`);
    await host.collections.update('payments', payment.id, { state: 'refunded' });
    await host.orders.refunded(payment.order);
    return 'Refunded.';
  },
};
