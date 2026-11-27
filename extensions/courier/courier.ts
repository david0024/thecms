/**
 * What the three couriers share (ADR 0079): the price of delivery at checkout,
 * lockers by the buyer's town, the AWB made from the order with its label and
 * cash on delivery, and the parcel followed until it is delivered. Each
 * courier's extension gives only how it talks to its own API; this file is
 * bundled into each of them when it is packed, so no extension depends on
 * another.
 *
 * Money is in bani (the smallest unit), weights in grams, as the shop keeps
 * them; the owner types lei and kilograms in the settings.
 */
type Host = import('../../src/site/extension-runner.ts').ExtensionHost;

/** What every courier's settings hold besides its own account. */
export interface CommonSettings {
  id: string;
  pricing: 'fixed' | 'courier';
  /** In lei, as the owner typed them. */
  home_price: number | null;
  locker_price: number | null;
  free_from: number | null;
  /** In kilograms: what a parcel weighs when its products do not say. */
  default_weight: number | null;
  lockers: boolean;
  auto_awb: boolean;
}

/** An order as the shop lends it (ADR 0065 d9). */
export interface LentOrder {
  id: string;
  number: number;
  state: string;
  email: string;
  language: string;
  buyer: { name: string; email: string; phone: string; street: string; town: string; county: string; postcode: string; company: { name: string } | null };
  lines: { name: string; quantity: number; price: number; weight?: number }[];
  shipping: { id: string; name: string; price: number; pickup: string };
  payment: string;
  totals: { total: number };
  currency: string;
  tracking: string;
}

/** Where the buyer is, as checkout asks once the address is typed. */
export interface Place {
  street: string;
  town: string;
  county: string;
  postcode: string;
}

/** What a courier is asked to send. */
export interface Parcel {
  order: LentOrder;
  /** Grams, at least 1. */
  weight: number;
  /** Cash to collect, in bani; 0 when the order is paid already. */
  cod: number;
  /** The locker it goes to, by the courier's id; '' for the buyer's door. */
  locker: string;
  /** What is inside, in a line: the products' names. */
  content: string;
}

/** Where a parcel is: not taken yet, on its way, delivered, or sent back. */
export type Where = 'waiting' | 'moving' | 'delivered' | 'returned';

export interface Locker {
  id: string;
  name: string;
  address: string;
}

/** How one courier talks to its API. Each call may throw: what the courier said is in the error. */
export interface Courier<S extends CommonSettings> {
  /** The extension's name, as the order's way to deliver starts: `fancourier`. */
  name: string;
  title: string;
  /** What its lockers are called: FANbox, easybox, Ship & Go. */
  lockerName: string;
  /** Says what is missing from the account, or '' when it can be used. */
  missing: (settings: S) => string;
  /** What it costs to send this, in bani with VAT. */
  price: (host: Host, settings: S, ask: { weight: number; place: Place; locker: boolean }) => Promise<number>;
  lockers: (host: Host, settings: S, place: Place) => Promise<Locker[]>;
  /** Makes the AWB: its number. */
  create: (host: Host, settings: S, parcel: Parcel) => Promise<string>;
  /** The AWB's label, a PDF, in base64. */
  label: (host: Host, settings: S, awb: string) => Promise<string>;
  where: (host: Host, settings: S, awb: string) => Promise<Where>;
}

/** How often a parcel is asked about, and for how long. */
export const FOLLOW_MINUTES = 180;
export const FOLLOW_DAYS = 30;
/** The first look, once the courier has had time to come for it. */
const FIRST_FOLLOW_MINUTES = 120;
/** What the courier's price may take at checkout, before the fixed one is offered instead. */
const LOCKERS_MAX = 20;

const bani = (lei: number | null): number | null => (typeof lei === 'number' && Number.isFinite(lei) && lei >= 0 ? Math.round(lei * 100) : null);

/** The settings, the first row of `settings`; without an account, nothing can be asked of the courier. */
export async function settingsOf<S extends CommonSettings>(host: Host, courier: Courier<S>): Promise<S> {
  const [row] = (await host.collections.list('settings')) as unknown as S[];
  if (!row) throw new Error(`${courier.title} is not set up yet: add the account in Extensions → ${courier.title}`);
  return row;
}

/** Whether an order is delivered by this courier, and to which locker. */
export function routeOf(courier: { name: string }, order: Pick<LentOrder, 'shipping'>): { ours: boolean; locker: string } {
  const [extension, way, point = ''] = order.shipping.id.split(':');
  return { ours: extension === courier.name, locker: way === 'locker' ? point : '' };
}

/** What an order weighs: its lines', or the owner's weight for a parcel when they say nothing; at least 1 gram. */
export function weightOf(lines: { quantity: number; weight?: number }[], defaultKg: number | null): number {
  const given = lines.reduce((sum, l) => sum + (Number(l.weight) > 0 ? Number(l.weight) * l.quantity : 0), 0);
  if (given > 0) return Math.round(given);
  return Math.max(1, Math.round((defaultKg && defaultKg > 0 ? defaultKg : 1) * 1000));
}

/** The fixed price of a way, or free above the owner's sum. Null when the owner gave none. */
function fixed(settings: CommonSettings, locker: boolean, subtotal: number): number | null {
  const free = bani(settings.free_from);
  if (free !== null && free > 0 && subtotal >= free) return 0;
  return bani(locker ? settings.locker_price : settings.home_price);
}

/** A line short enough for any courier's field. */
const line = (value: unknown, max: number): string =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

/** What goes in the parcel, as one line. */
export const contentOf = (order: LentOrder): string => line(order.lines.map((l) => `${l.quantity} × ${l.name}`).join(', '), 100) || `Order ${order.number}`;

const POINT_ID = /^[A-Za-z0-9._-]{1,40}$/;

interface Shipment {
  id: string;
  order: string;
  number: number;
  awb: string;
  state: 'making' | 'made' | 'sent' | 'delivered' | 'returned';
  labelled: boolean;
  since: string;
}

async function shipmentOf(host: Host, order: string): Promise<Shipment | null> {
  const { rows } = await host.collections.find('shipments', { where: { order }, limit: 1 });
  return (rows[0] as unknown as Shipment | undefined) ?? null;
}

/** The actions every courier's extension declares, worked by its own `courier`. */
export function courierActions<S extends CommonSettings>(courier: Courier<S>) {
  const ready = async (host: Host): Promise<S> => {
    const settings = await settingsOf(host, courier);
    const missing = courier.missing(settings);
    if (missing) throw new Error(`${courier.title}: ${missing}. Add it in Extensions → ${courier.title}.`);
    return settings;
  };

  /** Puts the label on the order; says whether it could. */
  const labelled = async (host: Host, settings: S, shipment: Shipment, order: string): Promise<boolean> => {
    try {
      const data = await courier.label(host, settings, shipment.awb);
      await host.files.put({ order, name: `awb-${shipment.awb}.pdf`, type: 'application/pdf', data });
      await host.collections.update('shipments', shipment.id, { labelled: true });
      return true;
    } catch {
      return false;
    }
  };

  /**
   * Makes the AWB of an order, once: a second ask, from the button or from
   * the job, finds the one made. The row is kept before the courier is
   * asked, so that two asks at once do not make two AWBs.
   */
  async function make(host: Host, order: LentOrder): Promise<{ awb: string; label: boolean; made: boolean }> {
    const route = routeOf(courier, order);
    if (!route.ours) throw new Error(`Order ${order.number} is not delivered by ${courier.title}.`);
    const settings = await ready(host);
    const had = await shipmentOf(host, order.id);
    if (had?.awb) return { awb: had.awb, label: had.labelled || (await labelled(host, settings, had, order.id)), made: false };
    if (had) throw new Error(`The AWB of order ${order.number} is being made: look again in a minute.`);
    const row = (await host.collections.insert('shipments', { order: order.id, number: order.number, awb: '', state: 'making', labelled: false, since: new Date().toISOString() })) as unknown as Shipment;
    let awb: string;
    try {
      awb = line(
        await courier.create(host, settings, {
          order,
          weight: weightOf(order.lines, settings.default_weight),
          cod: order.payment === 'cod' ? order.totals.total : 0,
          locker: route.locker,
          content: contentOf(order),
        }),
        40,
      );
      if (!awb) throw new Error(`${courier.title} did not give an AWB number`);
    } catch (error) {
      // Nothing was made: it may be asked again.
      await host.collections.delete('shipments', row.id);
      throw error;
    }
    const shipment = (await host.collections.update('shipments', row.id, { awb, state: 'made' })) as unknown as Shipment;
    await host.orders.tracking(order.id, awb);
    const label = await labelled(host, settings, { ...row, ...shipment, awb }, order.id);
    await host.later('follow', { order: order.id }, FIRST_FOLLOW_MINUTES);
    return { awb, label, made: true };
  }

  /** When the owner chose it, the AWB is made by itself: queued, so that what fails is tried again. */
  async function auto(host: Host, id: string, when: (order: LentOrder) => boolean): Promise<void> {
    const [settings] = (await host.collections.list('settings')) as unknown as S[];
    if (!settings?.auto_awb) return;
    const order = (await host.orders.get(id)) as unknown as LentOrder | null;
    if (!order || !routeOf(courier, order).ours || !when(order)) return;
    await host.later('make', { order: id }, 0);
  }

  return {
    /**
     * `checkout.delivery`: to the door and, with the buyer's town, to each of
     * its lockers. The fixed price is the owner's; the courier's, when chosen,
     * is asked once the address is known, and the fixed one stands in when
     * the courier does not answer.
     */
    async quote(input: { subtotal: number; weight: number; lines: { quantity: number; weight?: number }[]; address: Place | null }, host: Host): Promise<unknown[]> {
      const [settings] = (await host.collections.list('settings')) as unknown as S[];
      if (!settings) return [];
      const place = input.address;
      const weight = input.weight > 0 ? input.weight : weightOf(input.lines ?? [], settings.default_weight);
      const priced = async (locker: boolean): Promise<number | null> => {
        const own = fixed(settings, locker, input.subtotal);
        if (own === 0 || settings.pricing !== 'courier' || !place?.town || courier.missing(settings)) return own;
        try {
          const asked = await courier.price(host, settings, { weight, place, locker });
          return Number.isInteger(asked) && asked >= 0 ? asked : own;
        } catch {
          return own;
        }
      };
      const out: unknown[] = [];
      const home = await priced(false);
      if (home !== null) out.push({ id: 'home', name: courier.title, price: home });
      if (settings.lockers && place?.town && !courier.missing(settings)) {
        const price = await priced(true);
        if (price !== null) {
          let points: Locker[] = [];
          try {
            points = (await courier.lockers(host, settings, place)).filter((p) => POINT_ID.test(p.id) && p.address).slice(0, LOCKERS_MAX);
          } catch {
            points = [];
          }
          if (points.length) out.push({ id: 'locker', name: courier.lockerName, price, points });
        }
      }
      return out;
    },

    /** On an order, in the Orders screen: makes the AWB, or says the one it has. */
    async awb(input: { order: LentOrder }, host: Host): Promise<string> {
      const done = await make(host, input.order);
      const label = done.label ? 'Its label is on the order.' : `The label could not be fetched from ${courier.title}: press again to try.`;
      return done.made ? `AWB ${done.awb} made. ${label}` : `This order has AWB ${done.awb}. ${label}`;
    },

    /** Queued by itself (`auto_awb`): tried again, waiting longer, when it fails. */
    async make(input: { input: { order: string } }, host: Host): Promise<void> {
      const order = (await host.orders.get(input.input.order)) as unknown as LentOrder | null;
      if (!order || order.state === 'cancelled' || order.state === 'refunded') return;
      await make(host, order);
    },

    /** `order.paid`: an order paid by card or by transfer gets its AWB. */
    async paid(input: { id: string }, host: Host): Promise<void> {
      await auto(host, input.id, (o) => o.payment !== 'cod');
    },

    /** `order.made`: an order paid on delivery gets its AWB as soon as it is placed. */
    async made(input: { id: string }, host: Host): Promise<void> {
      await auto(host, input.id, (o) => o.payment === 'cod');
    },

    /**
     * Queued after the AWB: asks where the parcel is. Taken by the courier,
     * the order is sent and the buyer told; delivered, it is completed. Asked
     * again every few hours, for at most FOLLOW_DAYS.
     */
    async follow(input: { input: { order: string } }, host: Host): Promise<void> {
      const shipment = await shipmentOf(host, input.input.order);
      if (!shipment?.awb || shipment.state === 'delivered' || shipment.state === 'returned') return;
      const settings = await ready(host);
      let where: Where = 'waiting';
      try {
        where = await courier.where(host, settings, shipment.awb);
      } catch {
        // The courier did not answer: asked again at the next look.
      }
      const id = shipment.order;
      if ((where === 'moving' || where === 'delivered') && shipment.state === 'made') {
        await host.orders.sent(id, shipment.awb);
        await host.collections.update('shipments', shipment.id, { state: 'sent' });
      }
      if (where === 'delivered') {
        await host.orders.completed(id);
        await host.collections.update('shipments', shipment.id, { state: 'delivered' });
        return;
      }
      if (where === 'returned') {
        await host.collections.update('shipments', shipment.id, { state: 'returned' });
        return;
      }
      if (Date.now() - Date.parse(shipment.since) < FOLLOW_DAYS * 86_400_000) await host.later('follow', { order: id }, FOLLOW_MINUTES);
    },
  };
}

/** The response of a courier's API as JSON; what it refused is thrown with its words. */
export async function call(host: Host, title: string, url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<unknown> {
  const answer = await host.fetch(url, init);
  // Not JSON (a token some couriers answer bare): the words as they came.
  let parsed: unknown = answer.body;
  try {
    parsed = JSON.parse(answer.body);
  } catch {
    // Kept as text.
  }
  if (answer.status >= 400) {
    const said = typeof parsed === 'string' ? parsed : parsed && typeof parsed === 'object' ? ((parsed as { message?: unknown; error?: unknown; Message?: unknown }).message ?? (parsed as { error?: unknown }).error ?? (parsed as { Message?: unknown }).Message) : null;
    throw new Error(`${title} answered ${answer.status}: ${line(typeof said === 'string' ? said : JSON.stringify(said ?? answer.body), 200)}`);
  }
  return parsed;
}

/** A PDF in base64, checked: a courier that answers an error page instead is said. */
export async function pdf(host: Host, title: string, url: string, headers: Record<string, string>): Promise<string> {
  const answer = await host.fetch(url, { headers, as: 'base64' });
  if (answer.status >= 400 || !answer.body.startsWith('JVBER')) throw new Error(`${title} did not give the label (${answer.status})`);
  return answer.body;
}

/** Romanian place names compared without diacritics, case or spaces: `Bucureşti` and `bucuresti`. */
export const same = (a: string, b: string): boolean => {
  const plain = (s: string) =>
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  return plain(a) === plain(b);
};
