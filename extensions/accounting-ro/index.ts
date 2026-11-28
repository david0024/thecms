/**
 * Romanian accounting software integration (ADR 0081 d4), an extension in the fourth format: it
 * answers the shop's `invoice.make` and `invoice.storno` with an invoice made
 * by the owner's invoicing app (Oblio for now), which reports it to
 * e-Factura (SPV) itself. It makes no invoice of its own and keeps none: the
 * shop keeps what it answers on the order.
 */
import { oblio } from './oblio.ts';

type Host = import('../../src/site/extension-runner.ts').ExtensionHost;

/** The extension's settings, the first row of `settings`. */
export interface Settings {
  id: string;
  app: 'oblio';
  email: string;
  secret: string;
  /** The company's tax code (CIF), as the app knows it. */
  cif: string;
  series: string;
  /** The series of the storno invoices; '' for the invoices' own. */
  storno_series: string;
  /** The app's warehouse (gestiune), when it keeps stock; '' for none. */
  management: string;
  /** Mark a paid order's invoice as collected. */
  collect: boolean;
}

/** An order as the shop lends it to an extension that uses `orders` (ADR 0065 d9, ADR 0081 d3). Money is in bani, with VAT. */
export interface Order {
  id: string;
  number: number;
  state: string;
  email: string;
  language: string;
  buyer: { name: string; email: string; phone: string; street: string; town: string; county: string; postcode: string; company: { name: string; taxCode: string; registration: string } | null };
  lines: { name: string; sku: string; price: number; quantity: number; rate: number }[];
  shipping: { id: string; name: string; price: number; pickup: string };
  payment: string;
  totals: { subtotal: number; coupon?: string; discount?: number; shipping: number; total: number; vat: [number, number][] };
  currency: string;
  vat: boolean;
}

/** What an app made: the invoice's series and number, and its link in the app. */
export interface Made {
  series: string;
  number: string;
  link: string;
}

export interface App {
  title: string;
  /** Says what is missing from the settings, or '' when they can be used. */
  missing: (settings: Settings) => string;
  make: (host: Host, settings: Settings, order: Order) => Promise<Made & { pdf: string }>;
  storno: (host: Host, settings: Settings, order: Order, of: { series: string; number: string }) => Promise<Made & { pdf: string }>;
}

/** Each invoicing app is a file of its own behind `App`: Oblio first, SmartBill and FGO later. */

export const APPS: Record<Settings['app'], App> = { oblio };

/** The app the owner chose, with settings it can use; otherwise what to add, and where. */
export async function ready(host: Host): Promise<{ app: App; settings: Settings }> {
  const [row] = (await host.collections.list('settings')) as unknown as Settings[];
  if (!row) throw new Error('Romanian accounting software integration is not set up yet: add the account in Extensions → Romanian accounting software integration');
  const app = APPS[row.app] ?? oblio;
  const missing = app.missing(row);
  if (missing) throw new Error(`${app.title}: ${missing}. Add it in Extensions → Romanian accounting software integration.`);
  return { app, settings: row };
}

interface Ask {
  question: string;
  order: Order;
  invoice?: { series: string; number: string };
}

export const actions = {
  async make(input: Ask, host: Host) {
    const { app, settings } = await ready(host);
    return app.make(host, settings, input.order);
  },
  async storno(input: Ask, host: Host) {
    if (!input.invoice?.number) throw new Error('the invoice to cancel was not given');
    const { app, settings } = await ready(host);
    return app.storno(host, settings, input.order, input.invoice);
  },
};
