/**
 * Sameday (ADR 0079), an extension in the fourth format: the price of
 * delivery at checkout, easybox lockers in the buyer's town, the AWB with its
 * label and cash on delivery, and the parcel followed until it is delivered.
 * What the three couriers share is in `../courier/courier.ts`; this file only
 * talks to Sameday's API (api.sameday.ro, or its demo for a test account),
 * through `host.fetch`.
 */
import { call, type CommonSettings, type Courier, courierActions, type Locker, pdf, same, type Where } from '../courier/courier.ts';

type Host = import('../../src/site/extension-runner.ts').ExtensionHost;

export const API = 'https://api.sameday.ro';
export const DEMO = 'https://sameday-api.demo.zitec.com';

export interface Settings extends CommonSettings {
  username: string;
  password: string;
  /** The demo's account, for trying it before the contract's. */
  demo: boolean;
}

const base = (s: Settings): string => (s.demo ? DEMO : API);

/** What one run of the extension learnt from Sameday: its token, and the account's pick-up point and services. */
interface Session {
  token: string;
  pickup?: Promise<{ point: string; person: string }>;
  services?: Promise<{ home: string; locker: string }>;
}
const sessions = new WeakMap<Host, Promise<Session>>();

function session(host: Host, s: Settings): Promise<Session> {
  let given = sessions.get(host);
  if (!given) {
    given = (async () => {
      const answer = (await call(host, 'Sameday', `${base(s)}/api/authenticate`, {
        method: 'POST',
        headers: { 'x-auth-username': s.username, 'x-auth-password': s.password, 'content-type': 'application/x-www-form-urlencoded' },
        body: 'remember_me=1',
      })) as { token?: string };
      if (!answer?.token) throw new Error('Sameday did not give a token: check the user and password');
      return { token: answer.token };
    })();
    sessions.set(host, given);
  }
  return given;
}

const get = async (host: Host, s: Settings, path: string): Promise<unknown> => call(host, 'Sameday', `${base(s)}${path}`, { headers: { 'x-auth-token': (await session(host, s)).token, accept: 'application/json' } });

/** The account's default pick-up point, and its first contact person: where the courier comes for parcels. */
export function pickupOf(answer: unknown): { point: string; person: string } {
  const data = (answer as { data?: unknown })?.data;
  const points = (Array.isArray(data) ? data : []) as { id?: unknown; defaultPickupPoint?: unknown; contactPersons?: { id?: unknown; defaultContactPerson?: unknown }[] }[];
  const point = points.find((p) => p.defaultPickupPoint === true) ?? points[0];
  if (!point?.id) throw new Error('Sameday has no pick-up point for this account');
  const people = Array.isArray(point.contactPersons) ? point.contactPersons : [];
  const person = people.find((p) => p.defaultContactPerson === true) ?? people[0];
  return { point: String(point.id), person: String(person?.id ?? '') };
}

/** The account's services for the door (24H) and for an easybox (Locker NextDay). */
export function servicesOf(answer: unknown): { home: string; locker: string } {
  const data = (answer as { data?: unknown })?.data;
  const all = (Array.isArray(data) ? data : []) as { id?: unknown; name?: unknown; serviceCode?: unknown }[];
  const find = (code: string, name: RegExp) => all.find((x) => String(x.serviceCode ?? '').toUpperCase() === code) ?? all.find((x) => name.test(String(x.name ?? '')));
  const home = find('24', /^24\s*h/i);
  const locker = find('LN', /locker/i);
  if (!home?.id) throw new Error('Sameday has no 24H service on this account');
  return { home: String(home.id), locker: String(locker?.id ?? '') };
}

async function pickup(host: Host, s: Settings) {
  const one = await session(host, s);
  return (one.pickup ??= get(host, s, '/api/client/pickup-points').then(pickupOf));
}
async function services(host: Host, s: Settings) {
  const one = await session(host, s);
  return (one.services ??= get(host, s, '/api/client/services').then(servicesOf));
}

/** Sameday's forms, with nested names: `awbRecipient[name]`. */
export function form(values: Record<string, unknown>, prefix = ''): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null || value === '') continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (typeof value === 'object') out.push(...form(value as Record<string, unknown>, name));
    else out.push(`${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`);
  }
  return out;
}

async function post(host: Host, s: Settings, path: string, values: Record<string, unknown>): Promise<unknown> {
  return call(host, 'Sameday', `${base(s)}${path}`, {
    method: 'POST',
    headers: { 'x-auth-token': (await session(host, s)).token, accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body: form(values).join('&'),
  });
}

/** What an AWB, or its price, is asked with. */
async function parcelForm(host: Host, s: Settings, p: { weight: number; locker: string | boolean; cod: number; recipient: Record<string, unknown> }): Promise<Record<string, unknown>> {
  const [{ point, person }, { home, locker }] = await Promise.all([pickup(host, s), services(host, s)]);
  const toLocker = p.locker !== '' && p.locker !== false;
  if (toLocker && !locker) throw new Error('Sameday has no locker service on this account');
  const kg = Math.max(0.1, Math.round(p.weight / 100) / 10);
  return {
    pickupPoint: point,
    contactPerson: person,
    packageType: 0,
    packageNumber: 1,
    packageWeight: kg,
    service: toLocker ? locker : home,
    awbPayment: 1,
    cashOnDelivery: p.cod / 100,
    insuredValue: 0,
    thirdPartyPickup: 0,
    ...(typeof p.locker === 'string' && p.locker ? { lockerLastMile: p.locker } : {}),
    awbRecipient: p.recipient,
    parcels: { 0: { weight: kg } },
  };
}

/** Lei as Sameday answers an estimate, in bani. */
export function costOf(answer: unknown): number {
  const amount = Number((answer as { amount?: unknown })?.amount);
  if (!Number.isFinite(amount) || amount < 0) throw new Error('Sameday did not give a price');
  return Math.round(amount * 100);
}

/** Where a parcel is, from its status: delivered, sent back, taken (anything past the AWB), or waiting. */
export function whereOf(answer: unknown): Where {
  const a = (answer ?? {}) as { expeditionSummary?: { delivered?: unknown; canceled?: unknown }; expeditionHistory?: { status?: unknown; statusLabel?: unknown }[] };
  const history = Array.isArray(a.expeditionHistory) ? a.expeditionHistory : [];
  const said = history.map((h) => `${String(h.statusLabel ?? '')} ${String(h.status ?? '')}`.toLowerCase());
  if (a.expeditionSummary?.delivered === true || said.some((x) => /livrat|delivered/.test(x) && !/nelivrat|not delivered/.test(x))) return 'delivered';
  if (said.some((x) => /retur/.test(x))) return 'returned';
  return said.some((x) => !/emis|creat|asteptare|created/.test(x)) ? 'moving' : 'waiting';
}

/** The easyboxes Sameday lists, in the buyer's town. */
export function lockersOf(answer: unknown, town: string): Locker[] {
  const data = (answer as { data?: unknown })?.data ?? answer;
  const out: Locker[] = [];
  for (const raw of Array.isArray(data) ? data : []) {
    const l = raw as { lockerId?: unknown; id?: unknown; name?: unknown; city?: unknown; address?: unknown };
    const city = String(l.city ?? '');
    if (!same(city, town)) continue;
    out.push({ id: String(l.lockerId ?? l.id ?? ''), name: String(l.name ?? ''), address: [String(l.address ?? ''), city].filter(Boolean).join(', ') });
  }
  return out;
}

const recipient = (place: { town: string; county: string; street: string; postcode: string }, who: { name: string; phone: string; email: string; company: string }) => ({
  name: who.name,
  phoneNumber: who.phone,
  email: who.email,
  personType: who.company ? 1 : 0,
  ...(who.company ? { companyName: who.company } : {}),
  cityString: place.town,
  countyString: place.county,
  address: place.street,
  postalCode: place.postcode,
});

export const sameday: Courier<Settings> = {
  name: 'sameday',
  title: 'Sameday',
  lockerName: 'easybox',
  missing: (s) => (!s.username ? 'the user is missing' : !s.password ? 'the password is missing' : ''),

  async price(host, s, ask) {
    const values = await parcelForm(host, s, { weight: ask.weight, locker: ask.locker, cod: 0, recipient: recipient(ask.place, { name: 'Client', phone: '', email: '', company: '' }) });
    return costOf(await post(host, s, '/api/awb/estimate-cost', values));
  },

  async lockers(host, s, place) {
    return lockersOf(await get(host, s, '/api/client/lockers'), place.town);
  },

  async create(host, s, parcel) {
    const { order } = parcel;
    const b = order.buyer;
    const values = await parcelForm(host, s, {
      weight: parcel.weight,
      locker: parcel.locker,
      cod: parcel.cod,
      recipient: recipient(b, { name: b.name, phone: b.phone, email: b.email || order.email, company: b.company?.name ?? '' }),
    });
    const answer = (await post(host, s, '/api/awb', { ...values, clientInternalReference: `order-${order.number}`, observation: parcel.content })) as { awbNumber?: unknown };
    if (!answer?.awbNumber) throw new Error(`Sameday did not make the AWB: ${JSON.stringify(answer).slice(0, 300)}`);
    return String(answer.awbNumber);
  },

  async label(host, s, awb) {
    return pdf(host, 'Sameday', `${base(s)}/api/awb/download/${encodeURIComponent(awb)}`, { 'x-auth-token': (await session(host, s)).token });
  },

  async where(host, s, awb) {
    return whereOf(await get(host, s, `/api/client/awb/${encodeURIComponent(awb)}/status`));
  },
};

export const actions = courierActions(sameday);
