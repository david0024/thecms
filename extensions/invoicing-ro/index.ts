/**
 * Invoicing for Romania (ADR 0081 d4), an extension in the fourth format: it
 * answers the shop's `invoice.make` and `invoice.storno` with an invoice made
 * by the owner's invoicing app (Oblio for now), which reports it to
 * e-Factura (SPV) itself. It makes no invoice of its own and keeps none: the
 * shop keeps what it answers on the order.
 */
import type { App, Order, Settings } from './app.ts';
import { oblio } from './oblio.ts';

type Host = import('../../src/site/extension-runner.ts').ExtensionHost;

export const APPS: Record<Settings['app'], App> = { oblio };

/** The app the owner chose, with settings it can use; otherwise what to add, and where. */
export async function ready(host: Host): Promise<{ app: App; settings: Settings }> {
  const [row] = (await host.collections.list('settings')) as unknown as Settings[];
  if (!row) throw new Error('Invoicing (Romania) is not set up yet: add the account in Extensions → Invoicing (Romania)');
  const app = APPS[row.app] ?? oblio;
  const missing = app.missing(row);
  if (missing) throw new Error(`${app.title}: ${missing}. Add it in Extensions → Invoicing (Romania).`);
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
