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
};

const translate = (statement: string, kind: DatabaseKind): string => {
  if (kind === 'sqlite') return statement;
  const out = statement.replace(/\bid TEXT\b/g, 'id VARCHAR(64)').replace(/\bproduct TEXT\b/g, 'product VARCHAR(255)').replace(/\bvariant TEXT\b/g, 'variant VARCHAR(255)');
  return kind === 'mysql' ? `${out} ${MYSQL}` : out;
};

export const SHOP_TABLES = Object.keys(SQLITE);

/** The statements that make the tables, for one database. */
export const shopSchema = (kind: DatabaseKind): string[] => Object.values(SQLITE).map((s) => translate(s, kind));
