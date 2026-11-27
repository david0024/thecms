/**
 * Cargus (ADR 0079), an extension in the fourth format: the price of
 * delivery at checkout, Ship & Go lockers in the buyer's town, the AWB with
 * its label and cash on delivery, and the parcel followed until it is
 * delivered. What the three couriers share is in `../courier/courier.ts`;
 * this file only talks to Cargus's API (urgentcargus.azure-api.net), through
 * `host.fetch`.
 */
import { call, type CommonSettings, type Courier, courierActions, type Locker, same, type Where } from '../courier/courier.ts';

type Host = import('../../src/site/extension-runner.ts').ExtensionHost;

export const API = 'https://urgentcargus.azure-api.net/api';
/** Cargus's services: Standard to the door, Ship & Go to a locker. */
export const STANDARD = 34;
export const SHIP_AND_GO = 38;

export interface Settings extends CommonSettings {
  /** The API's subscription key (Ocp-Apim-Subscription-Key), from Cargus's developer portal. */
  api_key: string;
  username: string;
  password: string;
  /** The pick-up point the courier comes to; empty for the account's first. */
  location: string;
}

const tokens = new WeakMap<Host, Promise<string>>();

async function headers(host: Host, s: Settings): Promise<Record<string, string>> {
  let given = tokens.get(host);
  if (!given) {
    given = (async () => {
      const answer = await call(host, 'Cargus', `${API}/LoginUser`, {
        method: 'POST',
        headers: { 'ocp-apim-subscription-key': s.api_key, 'content-type': 'application/json' },
        body: JSON.stringify({ UserName: s.username, Password: s.password }),
      });
      if (typeof answer !== 'string' || !answer) throw new Error('Cargus did not give a token: check the user and password');
      return answer;
    })();
    tokens.set(host, given);
  }
  return { 'ocp-apim-subscription-key': s.api_key, authorization: `Bearer ${await given}`, 'content-type': 'application/json', accept: 'application/json' };
}

const get = async (host: Host, s: Settings, path: string): Promise<unknown> => call(host, 'Cargus', `${API}${path}`, { headers: await headers(host, s) });
const post = async (host: Host, s: Settings, path: string, body: unknown): Promise<unknown> => call(host, 'Cargus', `${API}${path}`, { method: 'POST', headers: await headers(host, s), body: JSON.stringify(body) });

/** The pick-up point the AWB leaves from: the one in the settings, or the account's first. */
async function location(host: Host, s: Settings): Promise<number> {
  if (/^\d+$/.test(String(s.location ?? '').trim())) return Number(String(s.location).trim());
  const all = (await get(host, s, '/PickupLocations')) as { LocationId?: unknown }[];
  const first = Array.isArray(all) ? all.find((l) => Number(l.LocationId) > 0) : undefined;
  if (!first) throw new Error('Cargus has no pick-up point for this account');
  return Number(first.LocationId);
}

/** Lei with VAT as Cargus answers a calculation, in bani. */
export function totalOf(answer: unknown): number {
  const total = Number((answer as { GrandTotal?: unknown })?.GrandTotal);
  if (!Number.isFinite(total) || total < 0) throw new Error('Cargus did not give a price');
  return Math.round(total * 100);
}

/** Where a parcel is, from its trace: delivered, sent back, taken (any event), or waiting. */
export function whereOf(answer: unknown): Where {
  const first = (Array.isArray(answer) ? answer[0] : null) as { Event?: { Description?: unknown; EventId?: unknown }[]; Status?: unknown } | null;
  const events = Array.isArray(first?.Event) ? first.Event : [];
  const said = [...events.map((e) => String(e.Description ?? '')), String(first?.Status ?? '')].map((x) => x.toLowerCase());
  if (said.some((x) => /livrat|confirmat/.test(x) && !/nelivrat/.test(x))) return 'delivered';
  if (said.some((x) => /retur/.test(x))) return 'returned';
  return events.length ? 'moving' : 'waiting';
}

/** The Ship & Go points Cargus lists, in the buyer's town. */
export function lockersOf(answer: unknown, town: string): Locker[] {
  const out: Locker[] = [];
  for (const raw of Array.isArray(answer) ? answer : []) {
    const p = raw as { Id?: unknown; Name?: unknown; City?: unknown; Address?: unknown; StreetName?: unknown; StreetNo?: unknown };
    const city = String(p.City ?? '');
    if (!same(city, town)) continue;
    const street = String(p.Address ?? '') || [p.StreetName, p.StreetNo].filter(Boolean).join(' ');
    out.push({ id: String(p.Id ?? ''), name: String(p.Name ?? ''), address: [street, city].filter(Boolean).join(', ') });
  }
  return out;
}

/** A label as Cargus gives it: the PDF in base64, as a JSON string. */
export function labelOf(answer: unknown): string {
  if (typeof answer !== 'string' || !answer.startsWith('JVBER')) throw new Error('Cargus did not give the label');
  return answer;
}

const kg = (grams: number): number => Math.max(1, Math.ceil(grams / 1000));

export const cargus: Courier<Settings> = {
  name: 'cargus',
  title: 'Cargus',
  lockerName: 'Ship & Go',
  missing: (s) => (!s.api_key ? 'the API key is missing' : !s.username ? 'the user is missing' : !s.password ? 'the password is missing' : ''),

  async price(host, s, ask) {
    const answer = await post(host, s, '/ShippingCalculation', {
      FromLocalityId: 0,
      PickupStartDate: null,
      Sender: { LocationId: await location(host, s) },
      Recipient: { CountyName: ask.place.county, LocalityName: ask.place.town, PostalCode: ask.place.postcode },
      Parcels: 1,
      Envelopes: 0,
      TotalWeight: kg(ask.weight),
      ServiceId: ask.locker ? SHIP_AND_GO : STANDARD,
      ShipmentPayer: 1,
      CashRepayment: 0,
      DeclaredValue: 0,
    });
    return totalOf(answer);
  },

  async lockers(host, s, place) {
    return lockersOf(await get(host, s, '/PudoPoints'), place.town);
  },

  async create(host, s, parcel) {
    const { order } = parcel;
    const b = order.buyer;
    const weight = kg(parcel.weight);
    const answer = await post(host, s, '/Awbs', {
      Sender: { LocationId: await location(host, s) },
      Recipient: {
        Name: b.company?.name || b.name,
        ContactPerson: b.name,
        CountyName: b.county,
        LocalityName: b.town,
        AddressText: b.street,
        PostalCode: b.postcode,
        PhoneNumber: b.phone,
        Email: b.email || order.email,
      },
      Parcels: 1,
      Envelopes: 0,
      TotalWeight: weight,
      ServiceId: parcel.locker ? SHIP_AND_GO : STANDARD,
      ...(parcel.locker ? { DeliveryPudoPoint: Number(parcel.locker) || parcel.locker } : {}),
      DeclaredValue: 0,
      CashRepayment: parcel.cod / 100,
      BankRepayment: 0,
      OtherRepayment: '',
      OpenPackage: false,
      ShipmentPayer: 1,
      Observations: `Order ${order.number}`,
      PackageContent: parcel.content,
      CustomString: `order-${order.number}`,
      ParcelCodes: [{ Code: '0', Type: 1, Weight: weight, Length: 10, Width: 10, Height: 10 }],
    });
    // Cargus answers the AWB's number alone.
    const awb = typeof answer === 'number' || typeof answer === 'string' ? String(answer) : '';
    if (!/^\d{6,}$/.test(awb)) throw new Error(`Cargus did not make the AWB: ${JSON.stringify(answer).slice(0, 300)}`);
    return awb;
  },

  async label(host, s, awb) {
    const query = new URLSearchParams({ barCodes: JSON.stringify([awb]), type: 'PDF', format: '1' });
    return labelOf(await get(host, s, `/AwbDocuments?${query}`));
  },

  async where(host, s, awb) {
    const query = new URLSearchParams({ barCode: JSON.stringify([awb]) });
    return whereOf(await get(host, s, `/AwbTrace?${query}`));
  },
};

export const actions = courierActions(cargus);
