/**
 * A site is one SQLite file (ADR 0001 d9): its settings, its theme, its pages
 * and the images on them. Copying the file is a backup.
 *
 * A page, and the theme, each keep a working draft and, apart from it, a frozen
 * copy of what was last published. Visitors and the export only ever see the copy, so saving a
 * draft never changes the live site. (The same rule as in MYCMS, where it was
 * learned.)
 *
 * Everything is cleaned by the core on the way in and again on the way out:
 * a row written before a rule was tightened is read under today's rules.
 */
import { Database } from 'bun:sqlite';
import {
  imageExt,
  imageSources,
  isMediaName,
  MEDIA_MAX_BYTES,
  MEDIA_TYPES,
  type MediaExt,
  mediaNameOf,
  mediaPath,
  normalizePage,
  normalizeSite,
  type Page,
  parseTheme,
  type Site,
  str,
  type Theme,
} from '../core/index.ts';

/** One stored image, as the editor lists it. */
export interface MediaItem {
  name: string;
  /** Where a page points to show it. */
  path: string;
  type: string;
  size: number;
  /** The file name it was uploaded under: only a label for the author. */
  label: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS pages (
  slug TEXT PRIMARY KEY,
  position INTEGER NOT NULL,
  draft TEXT NOT NULL,
  published TEXT,
  published_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS media (
  name TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  size INTEGER NOT NULL,
  bytes BLOB NOT NULL,
  created_at TEXT NOT NULL
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

  private readTheme(key: string): Theme | null {
    const raw = this.getMeta(key);
    if (raw === null) return null;
    const { theme, issues } = parseTheme(raw);
    // A stored theme that no longer passes is an error, not a silent default.
    if (!theme) throw new Error(`the stored theme is not valid: ${issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`);
    return theme;
  }

  /**
   * The theme being worked on: what the editor shows. Like a page, a theme has
   * a draft and a published copy, so trying a colour never repaints the live
   * site. Null when none was ever set.
   */
  theme(): Theme | null {
    return this.readTheme('theme');
  }

  /** The theme visitors see: what the export uses. Null until one is published. */
  publishedTheme(): Theme | null {
    return this.readTheme('theme:published');
  }

  /** Replaces the theme being worked on. Refuses a document with any issue and says which. */
  setTheme(input: unknown): Theme {
    const { theme, issues } = parseTheme(input);
    if (!theme) throw new Error(`not a valid theme: ${issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`);
    this.setMeta('theme', theme);
    return theme;
  }

  /** Freezes the theme being worked on as the one visitors see. */
  publishTheme(): Theme {
    const theme = this.theme();
    if (!theme) throw new Error('this site has no theme yet');
    this.setMeta('theme:published', theme);
    return theme;
  }

  /** Whether the theme being worked on differs from the published one. */
  themeChanged(): boolean {
    return JSON.stringify(this.theme()) !== JSON.stringify(this.publishedTheme());
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

  /** Every page, in menu order, with whether its draft differs from what is published. */
  pages(): { slug: string; title: string; published: boolean; changed: boolean }[] {
    return this.db
      .query<{ slug: string; draft: string; published: string | null }, []>('SELECT slug, draft, published FROM pages ORDER BY position, slug')
      .all()
      .map((row) => ({
        slug: row.slug,
        title: normalizePage(JSON.parse(row.draft)).page.title,
        published: row.published !== null,
        changed: row.published !== row.draft,
      }));
  }

  deletePage(slug: string): void {
    if (slug === '') throw new Error('the home page cannot be deleted');
    this.db.query('DELETE FROM pages WHERE slug = ?').run(slug);
  }

  /** Every published page, in menu order. */
  published(): Page[] {
    return this.db
      .query<{ published: string }, []>('SELECT published FROM pages WHERE published IS NOT NULL ORDER BY position, slug')
      .all()
      .map((row) => normalizePage(JSON.parse(row.published)).page);
  }

  /**
   * Stores an image and returns where a page points to show it. The name is
   * the hash of the bytes, so the same picture uploaded twice is stored once
   * and a name never comes to mean another picture.
   */
  addMedia(bytes: Uint8Array, label: unknown = ''): MediaItem {
    if (bytes.length > MEDIA_MAX_BYTES) throw new Error(`an image is at most ${MEDIA_MAX_BYTES / 1024 / 1024} MB`);
    const ext = imageExt(bytes);
    if (!ext) throw new Error('not an image this site can show (PNG, JPEG, GIF, WebP or AVIF)');
    const name = `${new Bun.CryptoHasher('sha256').update(bytes).digest('hex').slice(0, 32)}.${ext}`;
    this.db
      .query('INSERT INTO media (name, label, size, bytes, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(name) DO NOTHING')
      .run(name, str(label, 200).trim(), bytes.length, bytes, new Date().toISOString());
    return this.media().find((m) => m.name === name) as MediaItem;
  }

  /** Every stored image, newest first. */
  media(): MediaItem[] {
    return this.db
      .query<{ name: string; label: string; size: number }, []>('SELECT name, label, size FROM media ORDER BY created_at DESC, name')
      .all()
      .map((row) => ({ ...row, path: mediaPath(row.name), type: MEDIA_TYPES[row.name.split('.').pop() as MediaExt] }));
  }

  mediaFile(name: string): { type: string; bytes: Uint8Array } | null {
    if (!isMediaName(name)) return null;
    const row = this.db.query<{ bytes: Uint8Array }, [string]>('SELECT bytes FROM media WHERE name = ?').get(name);
    return row ? { type: MEDIA_TYPES[name.split('.').pop() as MediaExt], bytes: row.bytes } : null;
  }

  /** Where this image is shown: the titles of pages (draft or published), and the header when it is the logo. */
  mediaUsedBy(name: string): string[] {
    const rows = this.db.query<{ draft: string; published: string | null }, []>('SELECT draft, published FROM pages ORDER BY position, slug').all();
    const titles: string[] = mediaNameOf(this.site().logo?.src ?? '') === name ? ['the header (logo)'] : [];
    for (const row of rows) {
      const copies = [row.draft, row.published].filter((c): c is string => c !== null).map((c) => normalizePage(JSON.parse(c)).page);
      if (copies.some((page) => imageSources(page.blocks).some((src) => mediaNameOf(src) === name))) titles.push((copies[0] as Page).title);
    }
    return titles;
  }

  /** Deletes an image nothing shows. One that a page still shows is refused, with the page named. */
  deleteMedia(name: string): void {
    const used = this.mediaUsedBy(name);
    if (used.length) throw new Error(`this image is used on: ${used.join(', ')}`);
    this.db.query('DELETE FROM media WHERE name = ?').run(name);
  }
}
