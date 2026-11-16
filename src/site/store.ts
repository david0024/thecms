/**
 * A site is one SQLite file (ADR 0001 d9): its settings, its theme and its
 * pages. Copying the file is a backup.
 *
 * A page keeps its working draft and, apart from it, a frozen copy of what was
 * last published. Visitors and the export only ever see the copy, so saving a
 * draft never changes the live site. (The same rule as in MYCMS, where it was
 * learned.)
 *
 * Everything is cleaned by the core on the way in and again on the way out:
 * a row written before a rule was tightened is read under today's rules.
 */
import { Database } from 'bun:sqlite';
import { normalizePage, normalizeSite, type Page, parseTheme, type Site, type Theme } from '../core/index.ts';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS pages (
  slug TEXT PRIMARY KEY,
  position INTEGER NOT NULL,
  draft TEXT NOT NULL,
  published TEXT,
  published_at TEXT,
  updated_at TEXT NOT NULL
);`;

export class Store {
  readonly db: Database;

  constructor(path: string) {
    this.db = new Database(path, { create: true, strict: true });
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  private getMeta(key: string): unknown {
    const row = this.db.query<{ value: string }, [string]>('SELECT value FROM meta WHERE key = ?').get(key);
    return row ? JSON.parse(row.value) : null;
  }

  private setMeta(key: string, value: unknown): void {
    this.db
      .query('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, JSON.stringify(value));
  }

  site(): Site {
    return normalizeSite(this.getMeta('site'));
  }

  setSite(input: unknown): Site {
    const site = normalizeSite(input);
    this.setMeta('site', site);
    return site;
  }

  /** The site's theme, or null when none was ever set. A stored theme that no longer passes is an error, not a silent default. */
  theme(): Theme | null {
    const raw = this.getMeta('theme');
    if (raw === null) return null;
    const { theme, issues } = parseTheme(raw);
    if (!theme) throw new Error(`the stored theme is not valid: ${issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`);
    return theme;
  }

  /** Replaces the theme. Refuses a document with any issue and says which. */
  setTheme(input: unknown): Theme {
    const { theme, issues } = parseTheme(input);
    if (!theme) throw new Error(`not a valid theme: ${issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`);
    this.setMeta('theme', theme);
    return theme;
  }

  /** Saves a page's draft. The published copy, if any, is left as it is. */
  savePage(input: unknown): Page {
    const { page } = normalizePage(input);
    if (!page.title) throw new Error('a page has a title');
    const now = new Date().toISOString();
    const next = this.db.query<{ n: number }, []>('SELECT COALESCE(MAX(position), 0) + 1 AS n FROM pages').get();
    this.db
      .query(
        `INSERT INTO pages (slug, position, draft, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(slug) DO UPDATE SET draft = excluded.draft, updated_at = excluded.updated_at`,
      )
      .run(page.slug, next?.n ?? 1, JSON.stringify(page), now);
    return page;
  }

  /** Freezes the current draft as what visitors see. */
  publish(slug: string): void {
    const done = this.db
      .query('UPDATE pages SET published = draft, published_at = ? WHERE slug = ?')
      .run(new Date().toISOString(), slug);
    if (done.changes === 0) throw new Error(`no page "${slug}"`);
  }

  draft(slug: string): Page | null {
    const row = this.db.query<{ draft: string }, [string]>('SELECT draft FROM pages WHERE slug = ?').get(slug);
    return row ? normalizePage(JSON.parse(row.draft)).page : null;
  }

  /** Every published page, in menu order. */
  published(): Page[] {
    return this.db
      .query<{ published: string }, []>('SELECT published FROM pages WHERE published IS NOT NULL ORDER BY position, slug')
      .all()
      .map((row) => normalizePage(JSON.parse(row.published)).page);
  }
}
