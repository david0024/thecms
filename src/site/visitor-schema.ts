/**
 * The tables of visitor accounts (ADR 0064), apart from the site's own: they
 * are made the first time the owner turns the accounts on, never before
 * (ADR 0060 d3). Only words here, so that the store and the backups know them
 * without loading the accounts themselves.
 */
import type { DatabaseKind } from './store.ts';

const MYSQL = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin';

/** Each table's statement, in SQLite's words; the other two databases' follow from it. */
const SQLITE: Record<string, string> = {
  // A visitor (ADR 0064 d6): only what is needed to sign in and to write to them. No address (IP) is kept.
  visitors:
    'CREATE TABLE IF NOT EXISTS visitors (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, password TEXT NOT NULL, language TEXT NOT NULL, created_at TEXT NOT NULL, confirmed_at TEXT, last_at TEXT)',
  // The member levels a visitor holds (ADR 0064 d3): the levels themselves are named in the settings.
  visitor_levels: 'CREATE TABLE IF NOT EXISTS visitor_levels (visitor_id TEXT NOT NULL, level TEXT NOT NULL, PRIMARY KEY (visitor_id, level))',
  visitor_sessions: 'CREATE TABLE IF NOT EXISTS visitor_sessions (id TEXT PRIMARY KEY, visitor_id TEXT NOT NULL, expires_at TEXT NOT NULL)',
  // A one-time link sent by e-mail: to confirm an address, choose a new password, take up an invitation or a new address (`data`).
  visitor_links: 'CREATE TABLE IF NOT EXISTS visitor_links (id TEXT PRIMARY KEY, kind TEXT NOT NULL, visitor_id TEXT NOT NULL, data TEXT NOT NULL, expires_at TEXT NOT NULL)',
  // What waits to be sent (ADR 0064 d5), and what could not be, at its last try.
  mail_queue:
    'CREATE TABLE IF NOT EXISTS mail_queue (id TEXT PRIMARY KEY, to_address TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL, what TEXT NOT NULL, tries INTEGER NOT NULL, next_at TEXT NOT NULL, failed_at TEXT, error TEXT NOT NULL, created_at TEXT NOT NULL)',
};

/** Longer texts on MySQL; on Postgres and MySQL a key is never TEXT. */
const translate = (statement: string, kind: DatabaseKind): string => {
  if (kind === 'sqlite') return statement;
  const out = statement
    .replace(/\b(id|visitor_id) TEXT\b/g, '$1 VARCHAR(64)')
    .replace(/\bemail TEXT\b/g, 'email VARCHAR(255)')
    .replace(/\b(kind|language) TEXT\b/g, '$1 VARCHAR(20)')
    .replace(/\blevel TEXT\b/g, 'level VARCHAR(40)')
    .replace(/\b(\w+_at) TEXT\b/g, '$1 VARCHAR(40)')
    .replace(/\bwhat TEXT\b/g, 'what VARCHAR(40)')
    .replace(/\bto_address TEXT\b/g, 'to_address VARCHAR(255)');
  return kind === 'mysql' ? `${out.replace(/\bbody TEXT\b/g, 'body LONGTEXT')} ${MYSQL}` : out;
};

export const VISITOR_TABLES = Object.keys(SQLITE);

/** The statements that make the tables, for one database. */
export const visitorSchema = (kind: DatabaseKind): string[] => Object.values(SQLITE).map((s) => translate(s, kind));

/** The SQLite statement of a table, from which the backups read its columns and key. */
export const visitorTable = (table: string): string | undefined => SQLITE[table];

/**
 * The tables a backup holds once they exist (ADR 0064 d6): the visitors and
 * the levels they hold.
 * Sessions and links are not in it, as for the admin's accounts; neither is
 * what waits to be sent.
 */
export const BACKED_UP_VISITOR_TABLES = ['visitors', 'visitor_levels'] as const;
