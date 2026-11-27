/**
 * The door to the shop (ADR 0065 d10, ADR 0060 d3): while the owner has not
 * turned it on, nothing of it is loaded, its tables do not exist, and the
 * admin's calls about it say only that it is off. Turned on, the shop is
 * loaded the first time it is needed, and makes its tables then.
 */
import { type ContentType, normalizeShopSettings, type ShopSettings, type ShopShown, slugify } from '../../core/index.ts';
import { wordsFor } from '../../blocks/words.ts';
import type { OrdersLent, Shop, ShopDeps } from './shop.ts';
import type { Store, User } from '../../site/store.ts';

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

export interface ShopGate {
  settings: () => Promise<ShopSettings>;
  /** The admin's calls under `/api/shop`: the settings (the owner's), a product's stock, and the orders. */
  admin: (request: Request, url: URL, me: User, body: Record<string, unknown>) => Promise<Response>;
  /** What a page is drawn with (ADR 0065 d3): null while the shop is off. */
  shown: () => Promise<ShopShown | null>;
  /** `/_/cart`, `/_/checkout` and `/_/order/…` (ADR 0065 d4): not found while the shop is off. */
  fetch: (request: Request, url: URL, deps: ShopDeps) => Promise<Response>;
  /** What the site's clock does for the shop: nothing while it is off. */
  chores: (now: Date) => Promise<void>;
  /** A visitor's orders for "My account": nothing while the shop is off. */
  ordersOf: (visitorId: string, language: string) => Promise<string>;
  /** What an extension that uses `orders` is lent (ADR 0065 d9): each call says the shop is off while it is. */
  lent: OrdersLent;
  /** Whether the shop's code was loaded in this process: never, while it stays off (the tests ask). */
  loaded: () => boolean;
}

/** One gate a store: the admin and the build share what was loaded. */
const gates = new WeakMap<Store, ShopGate>();

export function shopGate(store: Store): ShopGate {
  const known = gates.get(store);
  if (known) return known;
  let loading: Promise<Shop> | null = null;
  const open = (): Promise<Shop> => {
    loading ??= import('./shop.ts').then((m) => m.openShop(store)).catch((error: unknown) => {
      loading = null;
      throw error;
    });
    return loading;
  };
  const settings = async (): Promise<ShopSettings> => normalizeShopSettings(await store.shopSettings());

  /**
   * Turning the shop on makes an ordinary type of products when no type sells
   * yet (ADR 0065 d1): named in the site's language, at an address no type or
   * page has. The owner renames it, or marks another type, as for any type.
   */
  const products = async (): Promise<void> => {
    const site = await store.site();
    if (site.types.some((t) => t.sells)) return;
    const said = wordsFor(site.language);
    const taken = new Set(site.types.flatMap((t) => [t.id, t.path]));
    const base = slugify(said.shopProducts) || 'products';
    let path = base;
    for (let n = 2; taken.has(path) || (await store.draft(path)); n++) path = `${base}-${n}`;
    const type: ContentType = { id: path, name: said.shopProducts, singular: said.shopProduct, path, dated: false, categories: true, feed: false, fields: [], schema: 'product', sells: true };
    await store.setSite({ ...site, types: [...site.types, type] });
  };

  const lend = async <T>(use: (lent: OrdersLent) => Promise<T>): Promise<T> => {
    if (!(await settings()).on) throw new Error('the shop is off');
    return use((await open()).lent);
  };

  const gate: ShopGate = {
    settings,
    async admin(request, url, me, body) {
      const now = await settings();
      if (url.pathname === '/api/shop') {
        if (request.method === 'GET') return json({ settings: now });
        if (request.method !== 'PUT') return json({ error: 'not found' }, 404);
        if (me.role !== 'owner') return json({ error: 'only the owner may do this' }, 403);
        const asked = normalizeShopSettings({ ...now, ...body });
        // Paying by transfer needs an account to pay into (ADR 0065 d6): an IBAN that is not one is said, not dropped.
        const transfer = body.transfer && typeof body.transfer === 'object' ? (body.transfer as Record<string, unknown>) : null;
        if (transfer?.on === true && !asked.transfer.on) return json({ error: 'that is not an IBAN: check it and try again' }, 400);
        if (asked.on) {
          // The tables are made, and the type of products, before the shop says it is on.
          await open();
          await products();
        }
        await store.setShopSettings(asked);
        return json({ settings: asked, site: await store.site() });
      }
      // Off: only the settings, and nothing is loaded or made.
      if (!now.on) return json({ error: 'the shop is off' }, 404);
      return (await open()).admin(request, url, me, body);
    },
    async shown() {
      const now = await settings();
      if (!now.on) return null;
      const site = await store.site();
      return { currency: site.business?.currency || 'RON', vat: now.vat, stock: await (await open()).stock() };
    },
    async fetch(request, url, deps) {
      if (!(await settings()).on) return new Response('not found\n', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
      return (await open()).fetch(request, url, deps);
    },
    async chores(now) {
      if ((await settings()).on) await (await open()).chores(now);
    },
    async ordersOf(visitorId, language) {
      return (await settings()).on ? (await open()).ordersOf(visitorId, language) : '';
    },
    lent: {
      get: (id) => lend((l) => l.get(id)),
      paid: (id) => lend((l) => l.paid(id)),
      refunded: (id) => lend((l) => l.refunded(id)),
      tracking: (id, tracking) => lend((l) => l.tracking(id, tracking)),
    },
    loaded: () => loading !== null,
  };
  gates.set(store, gate);
  return gate;
}
