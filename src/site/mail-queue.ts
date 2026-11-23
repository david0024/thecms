/**
 * The site's mail queue (ADR 0064 d5, ADR 0065 d7): what visitor accounts and
 * the shop send waits here, and the site's clock sends it, so no request waits
 * for a mail server. It is the site's, not one part's: made when either part
 * is turned on, never before (ADR 0060 d3).
 */
import { siteMailer, type MailEnvironment } from './site-mail.ts';
import type { Database, DatabaseKind, Store } from './store.ts';

const MYSQL = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin';

// What waits to be sent, and what could not be, at its last try.
const SQLITE =
  'CREATE TABLE IF NOT EXISTS mail_queue (id TEXT PRIMARY KEY, to_address TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL, what TEXT NOT NULL, tries INTEGER NOT NULL, next_at TEXT NOT NULL, failed_at TEXT, error TEXT NOT NULL, created_at TEXT NOT NULL)';

/** The statement that makes the queue, for one database. Nothing of it is in a backup: it is sent, or given up. */
export function mailSchema(kind: DatabaseKind): string[] {
  if (kind === 'sqlite') return [SQLITE];
  const out = SQLITE.replace(/\bid TEXT\b/, 'id VARCHAR(64)')
    .replace(/\b(\w+_at) TEXT\b/g, '$1 VARCHAR(40)')
    .replace(/\bwhat TEXT\b/, 'what VARCHAR(100)')
    .replace(/\bto_address TEXT\b/, 'to_address VARCHAR(255)');
  return [kind === 'mysql' ? `${out.replace(/\bbody TEXT\b/, 'body LONGTEXT')} ${MYSQL}` : out];
}

/** After a failed try, a message is tried again after these minutes; after the last one it is given up (ADR 0064 d5). */
const RETRY_MINUTES = [1, 5, 30, 120];
/** At most this many messages are sent at one tick of the clock. */
const SENT_AT_ONCE = 20;

/** A message that could not be sent at its last try. */
export interface FailedMail {
  id: string;
  to: string;
  what: string;
  error: string;
  failedAt: string;
}

export interface MailQueue {
  /** Puts a message in the queue; `what` names it for the owner (`confirm`, `order-paid`). */
  queue: (to: string, what: string, message: { subject: string; text: string }) => Promise<void>;
  /** Sends what is due; without a mail server, it waits and nothing is counted as failed. */
  send: (now: Date) => Promise<void>;
  waiting: () => Promise<number>;
  failed: () => Promise<FailedMail[]>;
  retry: (id: string) => Promise<void>;
  drop: (id: string) => Promise<void>;
}

type Row = Record<string, unknown>;

/** The queue, its table made (only call this once a part that sends is on). */
export async function openMailQueue(store: Store, mail: MailEnvironment, log: (line: string) => void): Promise<MailQueue> {
  const db: Database = store.database();
  await db.make(mailSchema(db.kind));
  return {
    async queue(to, what, message) {
      const now = new Date().toISOString();
      await db.run('INSERT INTO mail_queue (id, to_address, subject, body, what, tries, next_at, failed_at, error, created_at) VALUES (?, ?, ?, ?, ?, 0, ?, NULL, ?, ?)', [crypto.randomUUID(), to, message.subject, message.text, what.slice(0, 100), now, '', now]);
    },
    async send(now) {
      const due = await db.rows<Row>(`SELECT * FROM mail_queue WHERE failed_at IS NULL AND next_at <= ? ORDER BY next_at, id LIMIT ${SENT_AT_ONCE}`, [now.toISOString()]);
      if (!due.length) return;
      // No mail server yet: the messages wait, and none is counted as failed.
      const sending = await siteMailer(store, mail);
      if (!sending) return;
      for (const row of due) {
        const id = String(row.id);
        // Taken by this process before it is sent: two processes never send one message twice.
        const later = new Date(now.getTime() + 15 * 60_000).toISOString();
        if ((await db.changed('UPDATE mail_queue SET next_at = ? WHERE id = ? AND next_at = ? AND failed_at IS NULL', [later, id, String(row.next_at)])) !== 1) continue;
        try {
          await sending.mailer({ from: sending.from, to: String(row.to_address), subject: String(row.subject), text: String(row.body) });
          // Sent: nothing of it is kept (ADR 0064 d6).
          await db.run('DELETE FROM mail_queue WHERE id = ?', [id]);
        } catch (error) {
          const tries = Number(row.tries) + 1;
          const said = (error instanceof Error ? error.message : String(error)).slice(0, 500);
          if (tries > RETRY_MINUTES.length) {
            await db.run('UPDATE mail_queue SET tries = ?, failed_at = ?, error = ? WHERE id = ?', [tries, now.toISOString(), said, id]);
            log(`A message could not be sent (${String(row.what)}, after ${tries} tries): ${said}`);
          } else {
            const next = new Date(now.getTime() + (RETRY_MINUTES[tries - 1] as number) * 60_000).toISOString();
            await db.run('UPDATE mail_queue SET tries = ?, next_at = ?, error = ? WHERE id = ?', [tries, next, said, id]);
          }
        }
      }
    },
    waiting: async () => Number((await db.rows<{ n: number | string }>('SELECT COUNT(*) AS n FROM mail_queue WHERE failed_at IS NULL'))[0]?.n ?? 0),
    failed: async () =>
      (await db.rows<Row>('SELECT id, to_address, what, error, failed_at FROM mail_queue WHERE failed_at IS NOT NULL ORDER BY failed_at DESC')).map((r) => ({
        id: String(r.id),
        to: String(r.to_address),
        what: String(r.what),
        error: String(r.error),
        failedAt: String(r.failed_at),
      })),
    retry: async (id) => {
      await db.run('UPDATE mail_queue SET failed_at = NULL, tries = 0, next_at = ? WHERE id = ?', [new Date().toISOString(), id]);
    },
    drop: async (id) => {
      await db.run('DELETE FROM mail_queue WHERE id = ? AND failed_at IS NOT NULL', [id]);
    },
  };
}
