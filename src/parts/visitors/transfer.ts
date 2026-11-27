/**
 * The visitors as a part of the content file (ADR 0057 d1, ADR 0064 d6):
 * chosen apart from the whole site, never with a password, a session, a
 * link sent by e-mail, what waits to be sent or the day of the last sign-in.
 * Read and written on the tables themselves, so the accounts' own code is
 * not loaded for it (ADR 0060 d3).
 */
import { cleanEmail, type Store } from '../../site/store.ts';
import { normalizeVisitorSettings } from './gate.ts';
import { visitorSchema } from './schema.ts';

/** A visitor as the content file holds them: whose address was confirmed, and nothing to sign in with. */
export interface ContentVisitor {
  email: string;
  name: string;
  language: string;
  /** The day of sign-up, and of the address confirmed. */
  createdAt: string;
  confirmedAt: string;
  /** The member levels held, by id. */
  levels: string[];
}

type Row = Record<string, unknown>;

/** Each visitor whose address is confirmed, by address; none when the accounts were never turned on. */
export async function exportVisitors(store: Store): Promise<ContentVisitor[]> {
  if (!(await store.hasTable('visitors'))) return [];
  const db = store.database();
  const levels = new Map<string, string[]>();
  for (const row of await db.rows<Row>('SELECT visitor_id, level FROM visitor_levels ORDER BY level')) {
    const id = String(row.visitor_id);
    levels.set(id, [...(levels.get(id) ?? []), String(row.level)]);
  }
  const rows = await db.rows<Row>('SELECT id, email, name, language, created_at, confirmed_at FROM visitors WHERE confirmed_at IS NOT NULL ORDER BY email');
  return rows.map((row) => ({
    email: String(row.email),
    name: String(row.name),
    language: String(row.language),
    createdAt: String(row.created_at),
    confirmedAt: String(row.confirmed_at),
    levels: levels.get(String(row.id)) ?? [],
  }));
}

/** What bringing the visitors did, for the import's report. */
export interface VisitorsBrought {
  added: number;
  /** Already here under the same address: left as they were. */
  kept: number;
  /** The accounts are off here: nobody was brought. */
  off: boolean;
}

/**
 * Brings the visitors of a content file into a site whose accounts are on.
 * Each comes confirmed and without a password: they choose one with "Forgot
 * your password?". No message is sent; extensions are told each account was
 * made (ADR 0064 d7). The levels they hold must be named here already.
 */
export async function importVisitors(store: Store, visitors: ContentVisitor[]): Promise<VisitorsBrought> {
  const settings = normalizeVisitorSettings(await store.visitorSettings());
  if (!settings.on) return { added: 0, kept: 0, off: true };
  const site = await store.site();
  const languages = [site.language, ...site.languages];
  const known = new Set(settings.levels.map((l) => l.id));
  const db = store.database();
  await db.make(visitorSchema(db.kind));
  let added = 0;
  let kept = 0;
  for (const visitor of visitors) {
    const email = cleanEmail(visitor.email);
    if (!email) continue;
    if ((await db.rows<Row>('SELECT id FROM visitors WHERE email = ?', [email])).length) {
      kept++;
      continue;
    }
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const day = (value: string): string => (Number.isNaN(Date.parse(value)) ? now : new Date(value).toISOString());
    const language = languages.includes(visitor.language) ? visitor.language : site.language;
    await db.run('INSERT INTO visitors (id, email, name, password, language, created_at, confirmed_at, last_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)', [
      id,
      email,
      visitor.name.trim().slice(0, 120),
      '',
      language,
      day(visitor.createdAt),
      day(visitor.confirmedAt),
    ]);
    const levels = [...new Set(visitor.levels)].filter((l) => known.has(l));
    for (const level of levels) await db.run('INSERT INTO visitor_levels (visitor_id, level) VALUES (?, ?)', [id, level]);
    store.tell('account.made', { id, levels: levels.sort() });
    added++;
  }
  return { added, kept, off: false };
}
