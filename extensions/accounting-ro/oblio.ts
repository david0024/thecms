/**
 * Oblio (www.oblio.eu), the first invoicing app of `accounting-ro` (ADR 0081
 * d4). The invoice is made in the owner's account, with their series; Oblio
 * numbers it, keeps it and sends it to e-Factura (SPV) when the account is
 * set so. Its API, as https://www.oblio.eu/api describes it: a token from
 * `/api/authorize/token`, then `/api/docs/invoice`, the storno being an
 * invoice that names the one it cancels.
 */
import type { App, Made, Order, Settings } from './index.ts';

type Host = import('../../src/site/extension-runner.ts').ExtensionHost;

export const API = 'https://www.oblio.eu/api';

/** What Oblio answers: `{ status, statusMessage, data }`; an error says why in `statusMessage`. */
async function call(host: Host, url: string, init: { method?: string; headers?: Record<string, string>; body?: string }): Promise<Record<string, unknown>> {
  const answer = await host.fetch(url, init);
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(answer.body);
  } catch {
    // Not JSON: an error page.
  }
  const body = (parsed && typeof parsed === 'object' ? parsed : {}) as { statusMessage?: unknown; message?: unknown; error_description?: unknown };
  if (answer.status >= 400 || !parsed) {
    const said = body.statusMessage ?? body.error_description ?? body.message ?? answer.body;
    throw new Error(`Oblio answered ${answer.status}: ${String(typeof said === 'string' ? said : JSON.stringify(said)).replace(/\s+/g, ' ').slice(0, 300)}`);
  }
  return parsed as Record<string, unknown>;
}

/** A token for the account (an hour long), asked once for each run. */
async function token(host: Host, s: Settings): Promise<string> {
  const answer = await call(host, `${API}/authorize/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ client_id: s.email, client_secret: s.secret }).toString(),
  });
  const given = answer.access_token;
  if (typeof given !== 'string' || !given) throw new Error('Oblio did not give a token: check the e-mail and the API secret');
  return given;
}

const tokens = new WeakMap<Host, Promise<string>>();
async function headers(host: Host, s: Settings): Promise<Record<string, string>> {
  let given = tokens.get(host);
  if (!given) {
    given = token(host, s);
    tokens.set(host, given);
    given.catch(() => tokens.delete(host));
  }
  return { authorization: `Bearer ${await given}`, accept: 'application/json', 'content-type': 'application/json' };
}

const lei = (bani: number): number => Math.round(bani) / 100;
const text = (value: unknown, max: number): string =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

/** How the buyer paid, as Oblio names it; null when it is not paid yet. */
export function collectOf(order: Order): { type: string; documentNumber: string } | null {
  const done = ['paid', 'preparing', 'sent', 'completed'].includes(order.state);
  if (!done) return null;
  const documentNumber = `Comanda ${order.number}`;
  if (order.payment === 'cod') return order.state === 'completed' ? { type: 'Ramburs', documentNumber } : null;
  if (order.payment === 'transfer') return { type: 'Ordin de plata', documentNumber };
  // A way to pay an extension offers: a card, online.
  return { type: 'Card', documentNumber };
}

/**
 * The rate delivery is taxed at: the site's first, which the shop lists first
 * in the order's VAT (ADR 0065 d5) when delivery was charged.
 */
export function deliveryRate(order: Order): number {
  if (!order.vat || !order.totals.shipping) return 0;
  return order.totals.vat[0]?.[0] ?? 0;
}

/** The invoice Oblio is asked to make for an order. */
export function invoiceOf(order: Order, s: Settings): Record<string, unknown> {
  const b = order.buyer;
  const company = b.company && b.company.name ? b.company : null;
  const stock = Boolean(s.management);
  const vat = (rate: number) => (order.vat ? { vatPercentage: rate, vatIncluded: 1 } : { vatIncluded: 1 });
  const products: Record<string, unknown>[] = order.lines.map((l) => ({
    name: text(l.name, 200) || `Product ${l.sku}`,
    ...(l.sku ? { code: text(l.sku, 60) } : {}),
    price: lei(l.price),
    measuringUnit: 'buc',
    quantity: l.quantity,
    ...vat(l.rate),
    ...(stock ? { management: s.management, productType: 'Marfa' } : {}),
    save: 0,
  }));
  const discount = order.totals.discount ?? 0;
  if (discount > 0) products.push({ name: text(`Cupon ${order.totals.coupon ?? ''}`, 200), discount: lei(discount), discountType: 'valoric', discountAllAbove: 1 });
  if (order.totals.shipping > 0)
    products.push({ name: text(order.shipping.name, 200) || 'Livrare', price: lei(order.totals.shipping), measuringUnit: 'buc', quantity: 1, ...vat(deliveryRate(order)), ...(stock ? { productType: 'Serviciu' } : {}), save: 0 });
  const collect = s.collect === false ? null : collectOf(order);
  return {
    cif: s.cif,
    client: {
      name: text(company ? company.name : b.name, 200),
      ...(company ? { cif: text(company.taxCode, 30), rc: text(company.registration, 40), contact: text(b.name, 100) } : {}),
      address: text(b.street, 300),
      state: text(b.county, 60),
      city: text(b.town, 60),
      country: 'Romania',
      email: text(b.email || order.email, 120),
      phone: text(b.phone, 40),
      save: 0,
    },
    issueDate: new Date().toISOString().slice(0, 10),
    seriesName: s.series,
    language: 'RO',
    currency: order.currency || 'RON',
    products,
    ...(collect ? { collect } : {}),
    ...(stock ? { useStock: 1 } : {}),
    mentions: `Comanda ${order.number}`,
    orderNumber: String(order.number),
    idempotencyKey: `uhlaka-${order.id}-invoice`,
  };
}

/** The storno of an invoice: an invoice that names it, all of it given back. */
export function stornoOf(order: Order, s: Settings, of: { series: string; number: string }): Record<string, unknown> {
  return {
    cif: s.cif,
    seriesName: s.storno_series || s.series,
    referenceDocument: { type: 'Factura', refund: 1, seriesName: of.series, number: of.number },
    mentions: `Storno, comanda ${order.number}`,
    idempotencyKey: `uhlaka-${order.id}-storno`,
  };
}

/** What Oblio made: its series, number and link. */
export function madeOf(answer: Record<string, unknown>): Made {
  const data = (answer.data ?? {}) as { seriesName?: unknown; number?: unknown; link?: unknown };
  const number = text(data.number, 40);
  if (!number) throw new Error(`Oblio did not answer the invoice's number: ${text(answer.statusMessage ?? JSON.stringify(answer), 200)}`);
  return { series: text(data.seriesName, 40), number, link: typeof data.link === 'string' ? data.link : '' };
}

/** The PDF behind Oblio's link, in base64; '' when it does not give one. */
async function pdfOf(host: Host, link: string): Promise<string> {
  if (!link.startsWith('https://www.oblio.eu/')) return '';
  try {
    const answer = await host.fetch(link, { as: 'base64' });
    return answer.status < 400 && answer.body.startsWith('JVBER') ? answer.body : '';
  } catch {
    return '';
  }
}

async function send(host: Host, s: Settings, body: Record<string, unknown>): Promise<Made & { pdf: string }> {
  const made = madeOf(await call(host, `${API}/docs/invoice`, { method: 'POST', headers: await headers(host, s), body: JSON.stringify(body) }));
  return { ...made, pdf: await pdfOf(host, made.link) };
}

export const oblio: App = {
  title: 'Oblio',
  missing: (s) => (!s.email ? 'the e-mail of the Oblio account is missing' : !s.secret ? 'the API secret is missing' : !s.cif ? "the company's CIF is missing" : !s.series ? "the invoices' series is missing" : ''),
  make: (host, s, order) => send(host, s, invoiceOf(order, s)),
  storno: (host, s, order, of) => send(host, s, stornoOf(order, s, of)),
};
