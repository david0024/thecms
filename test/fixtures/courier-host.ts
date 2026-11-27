/**
 * A host for a courier's extension (ADR 0079), kept in memory: its
 * collections (with `order` unique in `shipments`), the work it queues, the
 * files it puts on an order, the orders it moves, and the calls it makes,
 * answered by the test.
 */
import type { ExtensionHost } from '../../src/site/extension-runner.ts';

export type Answer = { status?: number; body: unknown; base64?: string };
export type Reply = (url: URL, init: { method: string; headers: Record<string, string>; body: string }) => Answer;

export interface Order {
  id: string;
  number: number;
  state: string;
  email: string;
  language: string;
  buyer: { name: string; email: string; phone: string; street: string; town: string; county: string; postcode: string; company: null };
  lines: { name: string; quantity: number; price: number; weight?: number }[];
  shipping: { id: string; name: string; price: number; pickup: string };
  payment: string;
  totals: { total: number };
  currency: string;
  tracking: string;
}

export const anOrder = (over: Partial<Order> = {}): Order => ({
  id: 'o1',
  number: 7,
  state: 'paid',
  email: 'ana@example.com',
  language: 'ro',
  buyer: { name: 'Ana Pop', email: 'ana@example.com', phone: '0722000000', street: 'Str. Mare 2', town: 'Cluj-Napoca', county: 'Cluj', postcode: '400000', company: null },
  lines: [{ name: 'Mug', quantity: 2, price: 5000, weight: 400 }],
  shipping: { id: 'courier:home', name: 'Courier', price: 2000, pickup: '' },
  payment: 'transfer',
  totals: { total: 12000 },
  currency: 'RON',
  tracking: '',
  ...over,
});

/** A small PDF's first bytes, in base64, as a courier gives a label. */
export const PDF = btoa('%PDF-1.4 label');

export function courierHost(settings: Record<string, unknown>, reply: Reply, orders: Order[] = [anOrder()]) {
  const rows: Record<string, Record<string, unknown>[]> = { settings: [{ id: 's', ...settings }], shipments: [] };
  const calls: { url: URL; method: string; headers: Record<string, string>; body: string }[] = [];
  const later: { action: string; input: unknown; minutes: number }[] = [];
  const files: { order: string; name: string; type: string; data: string }[] = [];
  const moved: string[] = [];
  let n = 0;
  const order = (id: string) => orders.find((o) => o.id === id) ?? null;
  const host = {
    collections: {
      list: async (c: string) => rows[c] ?? [],
      insert: async (c: string, row: Record<string, unknown>) => {
        if (c === 'shipments' && rows.shipments!.some((r) => r.order === row.order)) throw new Error('order: there is one with this value already');
        const made = { ...row, id: `r${++n}` };
        rows[c]?.push(made);
        return made;
      },
      update: async (c: string, id: string, row: Record<string, unknown>) => Object.assign(rows[c]?.find((r) => r.id === id) ?? {}, row),
      delete: async (c: string, id: string) => void (rows[c] = (rows[c] ?? []).filter((r) => r.id !== id)),
      find: async (c: string, q: { where?: Record<string, unknown> }) => {
        const found = (rows[c] ?? []).filter((r) => Object.entries(q.where ?? {}).every(([k, v]) => r[k] === v));
        return { rows: found, count: found.length };
      },
    },
    later: async (action: string, input: unknown, minutes = 0) => (later.push({ action, input, minutes }), `l${later.length}`),
    files: { put: async (file: { order: string; name: string; type: string; data: string }) => (files.push(file), `f${files.length}`), remove: async () => {} },
    fetch: async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; as?: string }) => {
      const asked = { url: new URL(url), method: init?.method ?? 'GET', headers: init?.headers ?? {}, body: init?.body ?? '' };
      calls.push(asked);
      const a = reply(asked.url, asked);
      return { status: a.status ?? 200, headers: {}, body: init?.as === 'base64' ? (a.base64 ?? btoa(JSON.stringify(a.body))) : typeof a.body === 'string' ? a.body : JSON.stringify(a.body) };
    },
    orders: {
      get: async (id: string) => order(id),
      tracking: async (id: string, tracking: string) => (moved.push(`tracking ${id} ${tracking}`), Object.assign(order(id) ?? {}, { tracking })),
      sent: async (id: string, tracking: string) => (moved.push(`sent ${id} ${tracking}`), Object.assign(order(id) ?? {}, { state: 'sent' })),
      completed: async (id: string) => (moved.push(`completed ${id}`), Object.assign(order(id) ?? {}, { state: 'completed' })),
    },
  } as unknown as ExtensionHost;
  return { host, rows, calls, later, files, moved, orders };
}
