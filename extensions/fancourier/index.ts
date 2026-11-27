/**
 * Fan Courier (ADR 0079), an extension in the fourth format: the price of
 * delivery at checkout, FANbox lockers in the buyer's town, the AWB with its
 * label and cash on delivery, and the parcel followed until it is delivered.
 * What the three couriers share is in `../courier/courier.ts`; this file only
 * talks to Fan Courier's API (v2, api.fancourier.ro), through `host.fetch`.
 */
import { call, type CommonSettings, type Courier, courierActions, type Locker, pdf, same, type Where } from '../courier/courier.ts';

type Host = import('../../src/site/extension-runner.ts').ExtensionHost;

export const API = 'https://api.fancourier.ro';

export interface Settings extends CommonSettings {
  username: string;
  password: string;
  client_id: string;
}

/** A token for the account: asked once for each run. */
async function token(host: Host, s: Settings): Promise<string> {
  const answer = (await call(host, 'Fan Courier', `${API}/login?${new URLSearchParams({ username: s.username, password: s.password })}`, { method: 'POST' })) as { data?: { token?: string } };
  const given = answer?.data?.token;
  if (!given) throw new Error('Fan Courier did not give a token: check the user and password');
  return given;
}

const tokens = new WeakMap<Host, Promise<string>>();
async function headers(host: Host, s: Settings): Promise<Record<string, string>> {
  let given = tokens.get(host);
  if (!given) tokens.set(host, (given = token(host, s)));
  return { authorization: `Bearer ${await given}`, accept: 'application/json' };
}

/** Lei with VAT as Fan Courier answers a tariff, in bani. */
export function tariffOf(answer: unknown): number {
  const data = ((answer as { data?: unknown })?.data ?? {}) as { total?: unknown; vat?: unknown };
  const total = Number(data.total);
  if (!Number.isFinite(total) || total < 0) throw new Error('Fan Courier did not give a price');
  const vat = Number(data.vat);
  return Math.round((total + (Number.isFinite(vat) && vat > 0 ? vat : 0)) * 100);
}

/**
 * Where a parcel is, from its events: delivered (S2), sent back (S6, S7,
 * or "retur"), taken (any event past the AWB being made), or waiting.
 */
export function whereOf(answer: unknown): Where {
  const data = (answer as { data?: unknown })?.data;
  const first = (Array.isArray(data) ? data[0] : null) as { events?: { id?: unknown; name?: unknown }[] } | null;
  const events = Array.isArray(first?.events) ? first.events : [];
  const ids = events.map((e) => String(e.id ?? '').toUpperCase());
  const names = events.map((e) => String(e.name ?? '').toLowerCase());
  if (ids.includes('S2') || names.some((n) => /^livrat/.test(n))) return 'delivered';
  if (ids.some((i) => i === 'S6' || i === 'S7') || names.some((n) => /retur/.test(n))) return 'returned';
  return events.length ? 'moving' : 'waiting';
}

/** FANbox lockers, of the ones Fan Courier lists, in the buyer's town. */
export function lockersOf(answer: unknown, town: string): Locker[] {
  const data = (answer as { data?: unknown })?.data;
  const out: Locker[] = [];
  for (const raw of Array.isArray(data) ? data : []) {
    const p = raw as { id?: unknown; name?: unknown; address?: { locality?: unknown; street?: unknown; streetNo?: unknown; county?: unknown } };
    const locality = String(p.address?.locality ?? '');
    if (!same(locality, town)) continue;
    const street = [p.address?.street, p.address?.streetNo].filter(Boolean).join(' ');
    out.push({ id: String(p.id ?? ''), name: String(p.name ?? ''), address: [street, locality].filter(Boolean).join(', ') });
  }
  return out;
}

export const fancourier: Courier<Settings> = {
  name: 'fancourier',
  title: 'Fan Courier',
  lockerName: 'FANbox',
  missing: (s) => (!s.username ? 'the user is missing' : !s.password ? 'the password is missing' : !s.client_id ? 'the client id is missing' : ''),

  async price(host, s, ask) {
    const query = new URLSearchParams({
      clientId: s.client_id,
      'info[service]': ask.locker ? 'FANbox' : 'Standard',
      'info[payment]': 'sender',
      'info[weight]': String(Math.max(1, Math.ceil(ask.weight / 1000))),
      'info[packages][parcel]': '1',
      'recipient[locality]': ask.place.town,
      'recipient[county]': ask.place.county,
    });
    return tariffOf(await call(host, 'Fan Courier', `${API}/reports/awb/internal-tariff?${query}`, { headers: await headers(host, s) }));
  },

  async lockers(host, s, place) {
    const query = new URLSearchParams({ type: 'fanbox', 'filters[county]': place.county, 'filters[locality]': place.town });
    return lockersOf(await call(host, 'Fan Courier', `${API}/reports/pickup-points?${query}`, { headers: await headers(host, s) }), place.town);
  },

  async create(host, s, parcel) {
    const { order } = parcel;
    const b = order.buyer;
    const shipment = {
      info: {
        service: parcel.locker ? 'FANbox' : parcel.cod ? 'Cont Colector' : 'Standard',
        packages: { parcel: 1, envelope: 0 },
        weight: Math.max(1, Math.ceil(parcel.weight / 1000)),
        payment: 'sender',
        ...(parcel.cod ? { cod: parcel.cod / 100, declaredValue: parcel.cod / 100 } : {}),
        content: parcel.content,
        observation: `Order ${order.number}`,
        costCenter: `order-${order.number}`,
      },
      recipient: {
        name: b.company?.name || b.name,
        contactPerson: b.name,
        phone: b.phone,
        email: b.email || order.email,
        address: { county: b.county, locality: b.town, street: b.street, streetNo: '', zipCode: b.postcode },
        ...(parcel.locker ? { pickupLocation: parcel.locker } : {}),
      },
    };
    const answer = (await call(host, 'Fan Courier', `${API}/intern-awb`, {
      method: 'POST',
      headers: { ...(await headers(host, s)), 'content-type': 'application/json' },
      body: JSON.stringify({ clientId: s.client_id, shipments: [shipment] }),
    })) as { response?: { awbNumber?: unknown; errors?: unknown }[] };
    const made = answer?.response?.[0];
    if (!made?.awbNumber) throw new Error(`Fan Courier did not make the AWB: ${JSON.stringify(made?.errors ?? answer).slice(0, 300)}`);
    return String(made.awbNumber);
  },

  async label(host, s, awb) {
    const query = new URLSearchParams({ clientId: s.client_id, 'awbs[]': awb, pdf: '1' });
    return pdf(host, 'Fan Courier', `${API}/awb/label?${query}`, await headers(host, s));
  },

  async where(host, s, awb) {
    const query = new URLSearchParams({ clientId: s.client_id, 'awb[]': awb });
    return whereOf(await call(host, 'Fan Courier', `${API}/reports/awb/tracking?${query}`, { headers: await headers(host, s) }));
  },
};

export const actions = courierActions(fancourier);
