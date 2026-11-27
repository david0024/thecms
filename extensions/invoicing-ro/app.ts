/**
 * What every invoicing app of `invoicing-ro` gives (ADR 0081 d4): Oblio
 * first, SmartBill and FGO later, each a file of its own that talks to its
 * app's API through `host.fetch`.
 */
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
