/**
 * The shop's tables (ADR 0065), apart from the site's own: made the first time
 * the owner turns the shop on, never before (ADR 0060 d3). Only words here, so
 * that the store and the backups know them without loading the shop.
 */
import type { DatabaseKind } from './store.ts';

const MYSQL = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin';

/** Each table's statement, in SQLite's words; the other two databases' follow from it. */
const SQLITE: Record<string, string> = {
  // What is left of each product, and of each combination of one, whose stock is counted (ADR 0065 d2).
  // `id` is the hash of the stock's key, which may be longer than a key MySQL allows; `product` is `type/slug`.
  shop_stock: 'CREATE TABLE IF NOT EXISTS shop_stock (id TEXT PRIMARY KEY, product TEXT NOT NULL, variant TEXT NOT NULL, quantity INTEGER NOT NULL)',
  // A cart (ADR 0065 d4): the hash of the secret in the visitor's cookie, what is in it, and when it was last changed (kept 30 days).
  shop_carts: 'CREATE TABLE IF NOT EXISTS shop_carts (id TEXT PRIMARY KEY, items TEXT NOT NULL, shipping TEXT NOT NULL, updated_at TEXT NOT NULL)',
  // An order (ADR 0065 d7): its number follows the last; `secret` is in the buyer's link to it; the rest, as bought, in `data`.
  shop_orders:
    'CREATE TABLE IF NOT EXISTS shop_orders (id TEXT PRIMARY KEY, number INTEGER NOT NULL UNIQUE, secret TEXT NOT NULL, state TEXT NOT NULL, email TEXT NOT NULL, visitor_id TEXT NOT NULL, language TEXT NOT NULL, total INTEGER NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)',
  // A coupon (ADR 0065 d8): its code, what it takes off, until when, how many times and from how much; `used` counts the orders that took it.
  shop_coupons:
    'CREATE TABLE IF NOT EXISTS shop_coupons (code TEXT PRIMARY KEY, kind TEXT NOT NULL, value INTEGER NOT NULL, ends TEXT NOT NULL, uses INTEGER, used INTEGER NOT NULL, minimum INTEGER, created_at TEXT NOT NULL)',
};

const translate = (statement: string, kind: DatabaseKind): string => {
  if (kind === 'sqlite') return statement;
  const out = statement
    .replace(/\b(id|secret|visitor_id|code) TEXT\b/g, '$1 VARCHAR(64)')
    .replace(/\b(product|variant|email) TEXT\b/g, '$1 VARCHAR(255)')
    .replace(/\b(state|language|kind|ends) TEXT\b/g, '$1 VARCHAR(20)')
    .replace(/\b(\w+_at) TEXT\b/g, '$1 VARCHAR(40)')
    .replace(/\b(total|value|minimum) INTEGER\b/g, '$1 BIGINT');
  return kind === 'mysql' ? `${out.replace(/\b(items|data) TEXT\b/g, '$1 LONGTEXT')} ${MYSQL}` : out;
};

export const SHOP_TABLES = Object.keys(SQLITE);

/** The statements that make the tables, for one database. */
export const shopSchema = (kind: DatabaseKind): string[] => Object.values(SQLITE).map((s) => translate(s, kind));

/** The SQLite statement of a table, from which the backups read its columns and key. */
export const shopTable = (table: string): string | undefined => SQLITE[table];

/**
 * The tables a backup holds once they exist (ADR 0065, PR c): what is left of
 * each product, the orders and the coupons. A cart is not in it: like a
 * session, it belongs to a browser, and is forgotten in 30 days anyway.
 */
export const BACKED_UP_SHOP_TABLES = ['shop_stock', 'shop_orders', 'shop_coupons'] as const;
