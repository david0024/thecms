/**
 * The shop (ADR 0065): what is left of each product, for now. Loaded only once
 * the owner has turned it on (`shop-gate.ts`, ADR 0060 d3); the cart, checkout
 * and orders come here with their pull request.
 *
 * Stock is not content (ADR 0065 d2): it changes with each order, so it lives
 * in a table of its own, set from the entry's editor, and nothing is published
 * for it. The site is built again only when a product runs out or comes back,
 * for its page says whether it can be bought.
 */
import { createHash } from 'node:crypto';
import { combinations, isObject, stockKey } from '../core/index.ts';
import { shopSchema } from './shop-schema.ts';
import type { Database, Store, User } from './store.ts';

type Row = Record<string, unknown>;
/** The most a stock may say: more than any shop counts. */
const STOCK_MAX = 1_000_000_000;

export interface Shop {
  /** What is left of everything counted, by {@link stockKey}. */
  stock: () => Promise<Record<string, number>>;
  admin: (request: Request, url: URL, me: User, body: Record<string, unknown>) => Promise<Response>;
}

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

const idOf = (key: string): string => createHash('sha256').update(key).digest('hex').slice(0, 40);

/** A stock as typed: a whole number from 0, or null for "not given". */
const quantityOf = (value: unknown): number | null => {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value.trim()) : Number.NaN;
  return Number.isInteger(n) && n >= 0 ? Math.min(n, STOCK_MAX) : null;
};

export async function openShop(store: Store): Promise<Shop> {
  const db: Database = store.database();
  await db.make(shopSchema(db.kind));

  /** What is left of one product: by its combination, '' for the product itself. */
  const left = async (product: string): Promise<Record<string, number>> =>
    Object.fromEntries((await db.rows<Row>('SELECT variant, quantity FROM shop_stock WHERE product = ?', [product])).map((r) => [String(r.variant), Number(r.quantity)]));

  return {
    async stock() {
      const out: Record<string, number> = {};
      for (const row of await db.rows<Row>('SELECT product, variant, quantity FROM shop_stock')) {
        const [type, ...rest] = String(row.product).split('/');
        out[stockKey(type as string, rest.join('/'), String(row.variant))] = Number(row.quantity);
      }
      return out;
    },

    /**
     * `/api/shop/stock?kind=<type>&slug=<entry>`: what is left of a product, by
     * combination ('' for the product itself). PUT sets it; a combination the
     * product is not sold in is not kept, and one left empty is forgotten.
     * Editors set it, as they write the product (ADR 0065 d2).
     */
    async admin(request, url, _me, body) {
      if (url.pathname !== '/api/shop/stock') return json({ error: 'not found' }, 404);
      const kind = String(url.searchParams.get('kind') ?? body.kind ?? '');
      const at = String(url.searchParams.get('slug') ?? body.slug ?? '');
      const type = (await store.site()).types.find((t) => t.id === kind && t.sells);
      if (!type) return json({ error: 'that type does not sell' }, 404);
      const slug = (await store.locateEntry(type.id, at))?.of ?? at;
      const entry = await store.entryDraft(type.id, slug);
      if (!entry?.product) return json({ error: 'there is no such product' }, 404);
      const product = `${type.id}/${slug}`;
      if (request.method === 'PUT') {
        const before = await left(product);
        const given = isObject(body.stock) ? body.stock : {};
        const keys = entry.product.options.length ? combinations(entry.product.options) : [''];
        let crossed = false;
        await db.run('DELETE FROM shop_stock WHERE product = ?', [product]);
        for (const key of keys) {
          const quantity = quantityOf(given[key]);
          if (quantity !== null) await db.run('INSERT INTO shop_stock (id, product, variant, quantity) VALUES (?, ?, ?, ?)', [idOf(`${product}#${key}`), product, key, quantity]);
          if ((quantity ?? 0) > 0 !== (before[key] ?? 0) > 0) crossed = true;
        }
        // A product that ran out or came back: its page says so once built again.
        if (crossed) await store.touch();
      } else if (request.method !== 'GET') return json({ error: 'not found' }, 404);
      return json({ stock: await left(product) });
    },
  };
}
