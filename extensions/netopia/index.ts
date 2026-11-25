/**
 * Card payments through NETOPIA Payments, API v2 (ADR 0076 d3, d5), an
 * extension in the fourth format. At checkout it starts a payment for the
 * order's total without a card, and sends the buyer to NETOPIA's page
 * (`payment.paymentURL`). NETOPIA tells this extension's route when it is
 * paid; the notice is believed only with its `Verification-token`, a JWT
 * NETOPIA signs with RS512, whose `sub` is the body's SHA-512 and whose `aud`
 * is this point of sale.
 *
 * NETOPIA's status API is announced for later, so a payment is learned of by
 * its notice only.
 */
type Host = import('../../src/site/extension-runner.ts').ExtensionHost;

const LIVE = 'https://secure.mobilpay.ro/pay';
const SANDBOX = 'https://secure.sandbox.netopia-payments.com';
/** What NETOPIA's notice says of a payment made: 3 paid, 5 confirmed. */
export const PAID = [3, 5];
/** Romania, as ISO 3166-1 numbers it: the shop's addresses are Romanian. */
const ROMANIA = 642;
const ISSUER = 'NETOPIA Payments';

interface Settings {
  api_key: string;
  pos_signature: string;
  public_key: string;
  sandbox: boolean;
}

interface Payment {
  id: string;
  reference: string;
  order: string;
  number: number;
  amount: number;
  state: 'open' | 'paid' | 'rejected';
}

interface PayAsk {
  method: string;
  back: string;
  order: {
    id: string;
    number: number;
    total: number;
    currency: string;
    language: string;
    email: string;
    buyer: { name: string; email: string; phone: string; street: string; town: string; county: string; postcode: string };
    lines: { name: string; sku: string; price: number; quantity: number; rate: number }[];
  };
}

async function settings(host: Host): Promise<Settings> {
  const [row] = (await host.collections.list('settings')) as unknown as Settings[];
  if (!row?.api_key || !row.pos_signature) throw new Error('NETOPIA has no API key or point of sale signature yet: add them in Extensions → NETOPIA Payments');
  return row;
}

/** An amount in the smallest unit, as NETOPIA takes it: a number with two decimals. */
export const amountOf = (cents: number): number => Math.round(cents) / 100;

/** A name in two, as NETOPIA asks: the first word, and the rest (or the first again). */
export function names(full: string): { firstName: string; lastName: string } {
  const words = full.trim().split(/\s+/).filter(Boolean);
  return { firstName: words[0] ?? '-', lastName: words.slice(1).join(' ') || words[0] || '-' };
}

/** The request that starts a payment on NETOPIA's page (`/payment/card/start`), with no card in it. */
export function startRequest(ask: PayAsk, s: Settings, reference: string, at: Date): Record<string, unknown> {
  const { order } = ask;
  const b = order.buyer;
  const address = {
    email: order.email || b.email,
    phone: b.phone || '-',
    ...names(b.name),
    city: b.town || '-',
    country: ROMANIA,
    countryName: 'Romania',
    state: b.county || '-',
    postalCode: b.postcode || '-',
    details: b.street || '-',
  };
  const notify = new URL('/_/x/netopia/notify', ask.back).href;
  return {
    config: { emailTemplate: '', notifyUrl: notify, redirectUrl: ask.back, cancelUrl: ask.back, language: order.language.split('-')[0] === 'ro' ? 'ro' : 'en' },
    payment: { options: { installments: 0, bonus: 0 }, instrument: null, data: {} },
    order: {
      ntpID: '',
      posSignature: s.pos_signature,
      dateTime: at.toISOString().replace(/\.\d{3}Z$/, 'Z'),
      description: `#${order.number}`,
      orderID: reference,
      amount: amountOf(order.total),
      currency: order.currency,
      billing: address,
      shipping: address,
      products: order.lines.map((l) => ({ name: l.name.slice(0, 100), code: l.sku || '-', category: '-', price: amountOf(l.price * l.quantity), vat: l.rate })),
      installments: { selected: 0, available: [0] },
      data: { order: order.id },
    },
  };
}

const base64url = (text: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(text.length / 4) * 4, '=')), (c) => c.charCodeAt(0));

/**
 * Checks NETOPIA's `Verification-token` against the notice's body: a JWT
 * signed RS512 by the public key the owner gave, from NETOPIA Payments, for
 * this point of sale, whose `sub` is the body's SHA-512 in base64.
 */
export async function verified(token: string, body: string, s: Pick<Settings, 'public_key' | 'pos_signature'>, now = Date.now()): Promise<boolean> {
  try {
    const [head, payload, signature] = token.split('.');
    if (!head || !payload || !signature) return false;
    if ((JSON.parse(new TextDecoder().decode(base64url(head))) as { alg?: string }).alg !== 'RS512') return false;
    const pem = s.public_key.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');
    const key = await crypto.subtle.importKey('spki', Uint8Array.from(atob(pem), (c) => c.charCodeAt(0)), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-512' }, false, ['verify']);
    if (!(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, base64url(signature), new TextEncoder().encode(`${head}.${payload}`)))) return false;
    const claims = JSON.parse(new TextDecoder().decode(base64url(payload))) as { iss?: string; aud?: string | string[]; sub?: string; exp?: number };
    if (claims.iss !== ISSUER) return false;
    if (!(Array.isArray(claims.aud) ? claims.aud : [claims.aud]).includes(s.pos_signature)) return false;
    if (typeof claims.exp === 'number' && claims.exp * 1000 < now) return false;
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-512', new TextEncoder().encode(body)));
    return claims.sub === btoa(String.fromCharCode(...digest));
  } catch {
    return false;
  }
}

/** What NETOPIA expects back from a notice it sent: no error, or one it will send again for. */
const answer = (errorType: number, errorMessage = '') => ({ status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ errorType, errorCode: null, errorMessage }) });

export const actions = {
  /** `checkout.payment`: a payment started on NETOPIA's page, and where the buyer pays it. */
  async pay(input: PayAsk, host: Host): Promise<{ redirect: string }> {
    const s = await settings(host);
    // Each try has its own reference: NETOPIA refuses an order id it has seen.
    const { count } = await host.collections.find('payments', { where: { order: input.order.id }, limit: 0 });
    const reference = `${input.order.number}-${count + 1}`;
    const answered = await host.fetch(`${s.sandbox ? SANDBOX : LIVE}/payment/card/start`, {
      method: 'POST',
      headers: { authorization: s.api_key, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(startRequest(input, s, reference, new Date())),
    });
    let parsed: { payment?: { paymentURL?: string; ntpID?: string }; customerAction?: { url?: string }; error?: { code?: string | number; message?: string } } = {};
    try {
      parsed = JSON.parse(answered.body);
    } catch {
      // Said below.
    }
    const url = parsed.payment?.paymentURL || parsed.customerAction?.url || '';
    if (answered.status >= 400 || !url) throw new Error(`NETOPIA answered ${answered.status}: ${parsed.error?.message ?? answered.body.slice(0, 200)}`);
    await host.collections.insert('payments', { reference, order: input.order.id, number: input.order.number, amount: input.order.total, currency: input.order.currency, ntp: String(parsed.payment?.ntpID ?? ''), state: 'open' });
    return { redirect: url };
  },

  /** NETOPIA's notice: a payment made marks the order paid; one rejected is kept as such. */
  async notify(input: { body: string; headers: Record<string, string> }, host: Host): Promise<{ status: number; headers: Record<string, string>; body: string }> {
    const s = await settings(host);
    if (!(await verified(input.headers['verification-token'] ?? '', input.body, s))) return { status: 400, headers: {}, body: 'not signed by NETOPIA' };
    const notice = JSON.parse(input.body) as { order?: { orderID?: string }; payment?: { status?: number; ntpID?: string } };
    const { rows } = await host.collections.find('payments', { where: { reference: String(notice.order?.orderID ?? '') } });
    const payment = rows[0] as unknown as Payment | undefined;
    // An order of another shop on the same account: heard, and left.
    if (!payment) return answer(0);
    const status = Number(notice.payment?.status);
    if (PAID.includes(status)) {
      if (payment.state !== 'paid') await host.collections.update('payments', payment.id, { state: 'paid', ntp: String(notice.payment?.ntpID ?? '') });
      await host.orders.paid(payment.order);
    } else if (status === 12 && payment.state === 'open') await host.collections.update('payments', payment.id, { state: 'rejected' });
    return answer(0);
  },
};
