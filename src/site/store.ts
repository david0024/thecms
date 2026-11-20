/**
 * A site's settings, theme, pages, entries and images (ADR 0001 d9, ADR 0013).
 * By default it is one SQLite file, and copying the file is a backup. The same
 * store runs on Postgres or MySQL when it is given their address: the SQL here
 * is what the three share, and where they differ (an upsert, a column type) it
 * is said once, in a `Dialect`.
 *
 * A page, and the theme, each keep a working draft and, apart from it, a frozen
 * copy of what was last published. Visitors and the export only ever see the copy, so saving a
 * draft never changes the live site. (The same rule as in MYCMS, where it was
 * learned.)
 *
 * Everything is cleaned by the core on the way in and again on the way out:
 * a row written before a rule was tightened is read under today's rules.
 *
 * Who may do what is not decided here, nor by the database (no row-level
 * security): the three databases must be equally safe, so that rule lives in
 * the application, in one place, in front of this store.
 */
import { SQL } from 'bun';
import {
  type Block,
  type ExtensionPackage,
  fillTranslation,
  areaBlock,
  addRedirect,
  pageSlug,
  type MenuNode,
  LAYOUT_AREAS,
  READY_LAYOUTS,
  parseExtension,
  canVary,
  imageExt,
  imageSize,
  imageSources,
  isMediaName,
  MEDIA_MAX_BYTES,
  MEDIA_TYPES,
  type MediaExt,
  mediaNameOf,
  type MediaSize,
  mediaPath,
  normalizePage,
  normalizePost,
  normalizeRedirects,
  normalizeSite,
  variantName,
  variantOf,
  wantedWidths,
  type Page,
  type Post,
  parseTheme,
  postImageSources,
  type Redirect,
  POSTS_TYPE,
  contentTypes,
  reservedSlugs,
  languageName,
  prefixOf,
  slugProblem,
  baseSlug,
  keepWords,
  languageOf,
  localizeBlocks,
  missingWords,
  newTranslation,
  type PageTranslation,
  placePages,
  type PlacedPage,
  translatedPage,
  wordsFrom,
  sectionsIn,
  MAX_SECTIONS,
  isObject,
  pagePath,
  entryPath,
  listPath,
  typeById,
  type ContentType,
  listed,
  type ExtensionEventName,
  type ShownComment,
  type Site,
  str,
  type Theme,
} from '../core/index.ts';

/** What is kept with translations: a page, or a section (ADR 0033). */
type Kept = 'page' | 'section';

/** An installed extension (ADR 0026). */
export interface InstalledExtension extends ExtensionPackage {
  sha256: string;
  enabled: boolean;
  installedAt: string;
}
/** A row an extension keeps: its fields and an id. */
export type ExtensionRow = Record<string, unknown> & { id: string };

/** A publication set for later (ADR 0039): a page (`page`) or an entry of a type, by its address, at an ISO time. */
export interface Scheduled {
  kind: string;
  slug: string;
  at: string;
}

/** One stored image, as the editor lists it. */
export interface MediaItem {
  name: string;
  /** Where a page points to show it. */
  path: string;
  type: string;
  size: number;
  /** The file name it was uploaded under: only a label for the author. */
  label: string;
  /** How wide and high it is, when its bytes say (ADR 0005 d8); 0 when they do not. */
  width: number;
  height: number;
  /** The widths of the smaller copies it has. */
  variants: number[];
}

export type DatabaseKind = 'sqlite' | 'postgres' | 'mysql';

/** What differs between the three databases. Everything else is written once. */
interface Dialect {
  kind: DatabaseKind;
  schema: string[];
  /** `?` placeholders as this database wants them. */
  params: (query: string) => string;
  /** Insert, or when the key is taken set these columns. */
  upsert: (table: string, columns: string[], key: string[], update: string[]) => string;
  /** Insert, or do nothing when the key is taken. */
  insertNew: (table: string, columns: string[]) => string;
  /** The meta table's key column: a reserved word in MySQL. */
  key: string;
}

const marks = (columns: string[]): string => columns.map(() => '?').join(', ');

const SQLITE: Dialect = {
  kind: 'sqlite',
  // As files made before ADR 0013 have them: a site made then opens unchanged.
  schema: [
    'CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
    'CREATE TABLE IF NOT EXISTS pages (slug TEXT PRIMARY KEY, position INTEGER NOT NULL, draft TEXT NOT NULL, published TEXT, published_at TEXT, updated_at TEXT NOT NULL)',
    'CREATE TABLE IF NOT EXISTS sections (slug TEXT PRIMARY KEY, position INTEGER NOT NULL, draft TEXT NOT NULL, published TEXT, published_at TEXT, updated_at TEXT NOT NULL)',
    'CREATE TABLE IF NOT EXISTS entries (type TEXT NOT NULL, slug TEXT NOT NULL, draft TEXT NOT NULL, published TEXT, published_at TEXT, updated_at TEXT NOT NULL, PRIMARY KEY (type, slug))',
    'CREATE TABLE IF NOT EXISTS media (name TEXT PRIMARY KEY, label TEXT NOT NULL, size INTEGER NOT NULL, bytes BLOB NOT NULL, created_at TEXT NOT NULL)',
    'CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, received_at TEXT NOT NULL, form TEXT NOT NULL, page TEXT NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL, body TEXT NOT NULL, consent TEXT NOT NULL)',
    'CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, role TEXT NOT NULL, password TEXT NOT NULL, created_at TEXT NOT NULL)',
    'CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at TEXT NOT NULL)',
    'CREATE TABLE IF NOT EXISTS links (id TEXT PRIMARY KEY, kind TEXT NOT NULL, user_id TEXT NOT NULL, expires_at TEXT NOT NULL)',
    'CREATE TABLE IF NOT EXISTS extensions (name TEXT PRIMARY KEY, version TEXT NOT NULL, sha256 TEXT NOT NULL, package TEXT NOT NULL, enabled INTEGER NOT NULL, installed_at TEXT NOT NULL)',
    'CREATE TABLE IF NOT EXISTS extension_rows (extension TEXT NOT NULL, collection TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (extension, collection, id))',
    'CREATE TABLE IF NOT EXISTS versions (kind TEXT NOT NULL, slug TEXT NOT NULL, at TEXT NOT NULL, doc TEXT NOT NULL, PRIMARY KEY (kind, slug, at))',
    'CREATE TABLE IF NOT EXISTS media_sizes (name TEXT PRIMARY KEY, width INTEGER NOT NULL, height INTEGER NOT NULL)',
    'CREATE TABLE IF NOT EXISTS schedule (kind TEXT NOT NULL, slug TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY (kind, slug))',
    'CREATE TABLE IF NOT EXISTS media_variants (name TEXT PRIMARY KEY, original TEXT NOT NULL, width INTEGER NOT NULL, bytes BLOB NOT NULL)',
    'CREATE TABLE IF NOT EXISTS page_locks (slug TEXT PRIMARY KEY, hash TEXT NOT NULL)',
    'CREATE TABLE IF NOT EXISTS extension_jobs (extension TEXT NOT NULL, action TEXT NOT NULL, last_at TEXT NOT NULL, PRIMARY KEY (extension, action))',
    'CREATE TABLE IF NOT EXISTS comments (id TEXT PRIMARY KEY, type TEXT NOT NULL, entry TEXT NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL, body TEXT NOT NULL, consent TEXT NOT NULL, at TEXT NOT NULL, approved INTEGER NOT NULL)',
  ],
  params: (query) => query,
  upsert: (table, columns, key, update) =>
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${marks(columns)}) ON CONFLICT (${key.join(', ')}) DO UPDATE SET ${update.map((c) => `${c} = excluded.${c}`).join(', ')}`,
  insertNew: (table, columns) => `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${marks(columns)}) ON CONFLICT DO NOTHING`,
  key: 'key',
};

// An address or a name is at most 255 characters here; the core cuts them far shorter.
const POSTGRES: Dialect = {
  ...SQLITE,
  kind: 'postgres',
  schema: [
    'CREATE TABLE IF NOT EXISTS meta (key VARCHAR(255) PRIMARY KEY, value TEXT NOT NULL)',
    'CREATE TABLE IF NOT EXISTS pages (slug VARCHAR(255) PRIMARY KEY, position INTEGER NOT NULL, draft TEXT NOT NULL, published TEXT, published_at VARCHAR(40), updated_at VARCHAR(40) NOT NULL)',
    'CREATE TABLE IF NOT EXISTS sections (slug VARCHAR(255) PRIMARY KEY, position INTEGER NOT NULL, draft TEXT NOT NULL, published TEXT, published_at VARCHAR(40), updated_at VARCHAR(40) NOT NULL)',
    'CREATE TABLE IF NOT EXISTS entries (type VARCHAR(255) NOT NULL, slug VARCHAR(255) NOT NULL, draft TEXT NOT NULL, published TEXT, published_at VARCHAR(40), updated_at VARCHAR(40) NOT NULL, PRIMARY KEY (type, slug))',
    'CREATE TABLE IF NOT EXISTS media (name VARCHAR(255) PRIMARY KEY, label TEXT NOT NULL, size INTEGER NOT NULL, bytes BYTEA NOT NULL, created_at VARCHAR(40) NOT NULL)',
    'CREATE TABLE IF NOT EXISTS messages (id VARCHAR(40) PRIMARY KEY, received_at VARCHAR(40) NOT NULL, form VARCHAR(255) NOT NULL, page TEXT NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL, body TEXT NOT NULL, consent TEXT NOT NULL)',
    'CREATE TABLE IF NOT EXISTS users (id VARCHAR(40) PRIMARY KEY, email VARCHAR(255) NOT NULL UNIQUE, name TEXT NOT NULL, role VARCHAR(20) NOT NULL, password TEXT NOT NULL, created_at VARCHAR(40) NOT NULL)',
    'CREATE TABLE IF NOT EXISTS sessions (id VARCHAR(64) PRIMARY KEY, user_id VARCHAR(40) NOT NULL, expires_at VARCHAR(40) NOT NULL)',
    'CREATE TABLE IF NOT EXISTS links (id VARCHAR(64) PRIMARY KEY, kind VARCHAR(20) NOT NULL, user_id VARCHAR(40) NOT NULL, expires_at VARCHAR(40) NOT NULL)',
    'CREATE TABLE IF NOT EXISTS extensions (name VARCHAR(64) PRIMARY KEY, version VARCHAR(40) NOT NULL, sha256 VARCHAR(64) NOT NULL, package TEXT NOT NULL, enabled INTEGER NOT NULL, installed_at VARCHAR(40) NOT NULL)',
    'CREATE TABLE IF NOT EXISTS extension_rows (extension VARCHAR(64) NOT NULL, collection VARCHAR(64) NOT NULL, id VARCHAR(40) NOT NULL, data TEXT NOT NULL, updated_at VARCHAR(40) NOT NULL, PRIMARY KEY (extension, collection, id))',
    'CREATE TABLE IF NOT EXISTS versions (kind VARCHAR(64) NOT NULL, slug VARCHAR(255) NOT NULL, at VARCHAR(40) NOT NULL, doc TEXT NOT NULL, PRIMARY KEY (kind, slug, at))',
    'CREATE TABLE IF NOT EXISTS media_sizes (name VARCHAR(255) PRIMARY KEY, width INTEGER NOT NULL, height INTEGER NOT NULL)',
    'CREATE TABLE IF NOT EXISTS schedule (kind VARCHAR(64) NOT NULL, slug VARCHAR(255) NOT NULL, at VARCHAR(40) NOT NULL, PRIMARY KEY (kind, slug))',
    'CREATE TABLE IF NOT EXISTS media_variants (name VARCHAR(255) PRIMARY KEY, original VARCHAR(255) NOT NULL, width INTEGER NOT NULL, bytes BYTEA NOT NULL)',
    'CREATE TABLE IF NOT EXISTS page_locks (slug VARCHAR(255) PRIMARY KEY, hash TEXT NOT NULL)',
    'CREATE TABLE IF NOT EXISTS extension_jobs (extension VARCHAR(64) NOT NULL, action VARCHAR(64) NOT NULL, last_at VARCHAR(40) NOT NULL, PRIMARY KEY (extension, action))',
    'CREATE TABLE IF NOT EXISTS comments (id VARCHAR(40) PRIMARY KEY, type VARCHAR(255) NOT NULL, entry VARCHAR(255) NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL, body TEXT NOT NULL, consent TEXT NOT NULL, at VARCHAR(40) NOT NULL, approved INTEGER NOT NULL)',
  ],
  params: (query) => {
    let n = 0;
    return query.replace(/\?/g, () => `$${++n}`);
  },
};

// Binary collation: an address compares as its bytes, as it does in the other two.
const MYSQL_TABLE = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin';
const MYSQL: Dialect = {
  kind: 'mysql',
  schema: [
    `CREATE TABLE IF NOT EXISTS meta (\`key\` VARCHAR(255) PRIMARY KEY, value LONGTEXT NOT NULL) ${MYSQL_TABLE}`,
    `CREATE TABLE IF NOT EXISTS pages (slug VARCHAR(255) PRIMARY KEY, position INTEGER NOT NULL, draft LONGTEXT NOT NULL, published LONGTEXT, published_at VARCHAR(40), updated_at VARCHAR(40) NOT NULL) ${MYSQL_TABLE}`,
    `CREATE TABLE IF NOT EXISTS sections (slug VARCHAR(255) PRIMARY KEY, position INTEGER NOT NULL, draft LONGTEXT NOT NULL, published LONGTEXT, published_at VARCHAR(40), updated_at VARCHAR(40) NOT NULL) ${MYSQL_TABLE}`,
    `CREATE TABLE IF NOT EXISTS entries (type VARCHAR(255) NOT NULL, slug VARCHAR(255) NOT NULL, draft LONGTEXT NOT NULL, published LONGTEXT, published_at VARCHAR(40), updated_at VARCHAR(40) NOT NULL, PRIMARY KEY (type, slug)) ${MYSQL_TABLE}`,
    `CREATE TABLE IF NOT EXISTS media (name VARCHAR(255) PRIMARY KEY, label TEXT NOT NULL, size INTEGER NOT NULL, bytes LONGBLOB NOT NULL, created_at VARCHAR(40) NOT NULL) ${MYSQL_TABLE}`,
    `CREATE TABLE IF NOT EXISTS messages (id VARCHAR(40) PRIMARY KEY, received_at VARCHAR(40) NOT NULL, form VARCHAR(255) NOT NULL, page TEXT NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL, body TEXT NOT NULL, consent TEXT NOT NULL) ${MYSQL_TABLE}`,
    `CREATE TABLE IF NOT EXISTS users (id VARCHAR(40) PRIMARY KEY, email VARCHAR(255) NOT NULL UNIQUE, name TEXT NOT NULL, role VARCHAR(20) NOT NULL, password TEXT NOT NULL, created_at VARCHAR(40) NOT NULL) ${MYSQL_TABLE}`,
    `CREATE TABLE IF NOT EXISTS sessions (id VARCHAR(64) PRIMARY KEY, user_id VARCHAR(40) NOT NULL, expires_at VARCHAR(40) NOT NULL) ${MYSQL_TABLE}`,
    `CREATE TABLE IF NOT EXISTS links (id VARCHAR(64) PRIMARY KEY, kind VARCHAR(20) NOT NULL, user_id VARCHAR(40) NOT NULL, expires_at VARCHAR(40) NOT NULL) ${MYSQL_TABLE}`,
    `CREATE TABLE IF NOT EXISTS extensions (name VARCHAR(64) PRIMARY KEY, version VARCHAR(40) NOT NULL, sha256 VARCHAR(64) NOT NULL, package LONGTEXT NOT NULL, enabled INTEGER NOT NULL, installed_at VARCHAR(40) NOT NULL) ${MYSQL_TABLE}`,
    `CREATE TABLE IF NOT EXISTS extension_rows (extension VARCHAR(64) NOT NULL, collection VARCHAR(64) NOT NULL, id VARCHAR(40) NOT NULL, data LONGTEXT NOT NULL, updated_at VARCHAR(40) NOT NULL, PRIMARY KEY (extension, collection, id)) ${MYSQL_TABLE}`,
    `CREATE TABLE IF NOT EXISTS versions (kind VARCHAR(64) NOT NULL, slug VARCHAR(255) NOT NULL, at VARCHAR(40) NOT NULL, doc LONGTEXT NOT NULL, PRIMARY KEY (kind, slug, at)) ${MYSQL_TABLE}`,
    `CREATE TABLE IF NOT EXISTS media_sizes (name VARCHAR(255) PRIMARY KEY, width INTEGER NOT NULL, height INTEGER NOT NULL) ${MYSQL_TABLE}`,
    `CREATE TABLE IF NOT EXISTS schedule (kind VARCHAR(64) NOT NULL, slug VARCHAR(255) NOT NULL, at VARCHAR(40) NOT NULL, PRIMARY KEY (kind, slug)) ${MYSQL_TABLE}`,
    `CREATE TABLE IF NOT EXISTS media_variants (name VARCHAR(255) PRIMARY KEY, original VARCHAR(255) NOT NULL, width INTEGER NOT NULL, bytes LONGBLOB NOT NULL) ${MYSQL_TABLE}`,
    `CREATE TABLE IF NOT EXISTS page_locks (slug VARCHAR(255) PRIMARY KEY, hash TEXT NOT NULL) ${MYSQL_TABLE}`,
    `CREATE TABLE IF NOT EXISTS extension_jobs (extension VARCHAR(64) NOT NULL, action VARCHAR(64) NOT NULL, last_at VARCHAR(40) NOT NULL, PRIMARY KEY (extension, action)) ${MYSQL_TABLE}`,
    `CREATE TABLE IF NOT EXISTS comments (id VARCHAR(40) PRIMARY KEY, type VARCHAR(255) NOT NULL, entry VARCHAR(255) NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL, body TEXT NOT NULL, consent TEXT NOT NULL, at VARCHAR(40) NOT NULL, approved INTEGER NOT NULL) ${MYSQL_TABLE}`,
  ],
  params: (query) => query,
  upsert: (table, columns, _key, update) =>
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${marks(columns)}) ON DUPLICATE KEY UPDATE ${update.map((c) => `${c} = VALUES(${c})`).join(', ')}`,
  insertNew: (table, columns) => `INSERT IGNORE INTO ${table} (${columns.join(', ')}) VALUES (${marks(columns)})`,
  key: '`key`',
};

const DIALECTS: Record<DatabaseKind, Dialect> = { sqlite: SQLITE, postgres: POSTGRES, mysql: MYSQL };

/** Which database an address names. A plain path is a SQLite file, as it always was; `postgres://` and `mysql://` are servers. */
export function databaseKind(address: string): DatabaseKind {
  if (/^postgres(ql)?:\/\//i.test(address)) return 'postgres';
  if (/^(mysql|mariadb):\/\//i.test(address)) return 'mysql';
  return 'sqlite';
}

/** An address as it may be shown: the password left out. */
export function shownAddress(address: string): string {
  return databaseKind(address) === 'sqlite' ? address : address.replace(/\/\/([^:/@]*):[^@/]*@/, '//$1:***@');
}

type Row = Record<string, unknown>;

/** What a visitor sent through a form (ADR 0019). */
export interface Message {
  id: string;
  /** When it arrived, as an ISO time. */
  receivedAt: string;
  /** The id of the form block it was sent with. */
  form: string;
  /** The address of the page the form was on. */
  page: string;
  name: string;
  email: string;
  body: string;
  /** The words of the consent the visitor ticked. */
  consent: string;
}

/** Something that happened in the site, for the extensions that listen to it (ADR 0041). Never a visitor's address. */
export interface SiteEvent {
  name: ExtensionEventName;
  data: Record<string, unknown>;
}

/** What a visitor wrote under an entry (ADR 0040). Shown on the site once approved; the address never is. */
export interface Comment {
  id: string;
  /** The entry's type and address. */
  type: string;
  entry: string;
  name: string;
  email: string;
  body: string;
  /** The words of the consent the visitor ticked. */
  consent: string;
  /** When it was sent, as an ISO time. */
  at: string;
  approved: boolean;
}

/**
 * Someone who may sign in to the admin (ADR 0022). The owner can do
 * everything; an editor writes and publishes content and nothing else.
 */
export type Role = 'owner' | 'editor';
export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  /** False while an invitation has not been taken up. */
  active: boolean;
  createdAt: string;
}
/** What a one-time link is for: the first owner, someone invited, a new password. */
export type LinkKind = 'setup' | 'invite' | 'reset';

/** How many publications of one page or entry are kept, to bring back. */
export const VERSIONS_KEPT = 20;

export const PASSWORD_MIN = 10;
const PASSWORD_MAX = 200;
/** An address as it is kept, lower case; empty when it is not one. */
export const cleanEmail = (value: string): string => {
  const email = value.trim().toLowerCase();
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) && email.length <= 254 ? email : '';
};
/** What is wrong with a password, or nothing. Said before a one-time link is spent. */
export const passwordProblem = (password: string): string =>
  password.length < PASSWORD_MIN ? `a password has at least ${PASSWORD_MIN} characters` : password.length > PASSWORD_MAX ? `a password has at most ${PASSWORD_MAX} characters` : '';
const SESSION_DAYS = 30;
/** A secret is kept only as its hash: a copy of the database does not sign anyone in. */
const hashOf = (secret: string): string => new Bun.CryptoHasher('sha256').update(secret).digest('hex');
const newSecret = (): string => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
/** Checked against when nobody has the address, so a wrong address takes as long as a wrong password. */
let decoy: Promise<string> | null = null;

/** A type's page is cleaned as a page's blocks are: the same rules, the same limits. */
const cleanTemplate = (blocks: unknown[]): Block[] => normalizePage({ slug: '', title: 'template', blocks }).page.blocks;

export class Store {
  readonly kind: DatabaseKind;
  private readonly dialect: Dialect;

  private readonly listeners = new Set<(event: SiteEvent) => void>();

  private constructor(private readonly sql: SQL, kind: DatabaseKind) {
    this.kind = kind;
    this.dialect = DIALECTS[kind];
  }

  /** Hears what happens in the site from now on (ADR 0041). Returns how to stop hearing it. */
  onEvent(listener: (event: SiteEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Tells whoever listens. A listener's failure is its own: what happened has happened. */
  private emit(name: ExtensionEventName, data: Record<string, unknown>): void {
    for (const listener of this.listeners) {
      try {
        listener({ name, data });
      } catch {
        // The change is made; a listener that throws is not the store's to answer for.
      }
    }
  }

  /** Opens a site's database, creating its tables when they are not there. */
  static async open(address: string): Promise<Store> {
    const kind = databaseKind(address);
    const sql =
      kind === 'sqlite'
        ? new SQL({ adapter: 'sqlite', filename: address.replace(/^sqlite:\/\//i, ''), create: true } as unknown as ConstructorParameters<typeof SQL>[0])
        : new SQL(address.replace(/^mariadb:/i, 'mysql:'));
    const store = new Store(sql, kind);
    await store.prepare();
    return store;
  }

  private async prepare(): Promise<void> {
    if (this.kind === 'sqlite') await this.sql.unsafe('PRAGMA journal_mode = WAL');
    for (const statement of this.dialect.schema) await this.sql.unsafe(statement);
    // A site made before there were content types kept its posts in a table of their own (ADR 0010). Only SQLite files are that old.
    if (this.kind === 'sqlite' && (await this.rows("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = 'posts'")).length) {
      await this.sql.begin(async (tx) => {
        await tx.unsafe(`INSERT OR IGNORE INTO entries (type, slug, draft, published, published_at, updated_at)
          SELECT '${POSTS_TYPE}', slug, draft, published, published_at, updated_at FROM posts`);
        await tx.unsafe('DROP TABLE posts');
      });
    }
    await this.moveCopies();
  }

  /**
   * A translation made as a copy under its language's prefix (ADR 0024) moves
   * into the page it is of (ADR 0032 d7): as words by field when it has the
   * same blocks, as the page split for its language otherwise. Its draft and
   * its publication move separately. A page only in another language stays.
   */
  private async moveCopies(): Promise<void> {
    const site = await this.site();
    if (site.languages.length === 0) return;
    const rows = await this.rows<{ slug: string; draft: string; published: string | null }>('SELECT slug, draft, published FROM pages');
    const bySlug = new Map(rows.map((row) => [String(row.slug), row]));
    for (const row of rows) {
      const slug = String(row.slug);
      const language = languageOf(site, slug);
      const main = bySlug.get(baseSlug(site, slug));
      if (language === site.language || !main) continue;
      const into = (target: string, copy: string): string => {
        const page = normalizePage(JSON.parse(target)).page;
        page.translations = { ...page.translations, [language]: copyAsTranslation(page, normalizePage(JSON.parse(copy)).page) };
        return JSON.stringify(page);
      };
      main.draft = into(main.draft, row.draft);
      if (main.published && row.published) main.published = into(main.published, row.published);
      await this.run('UPDATE pages SET draft = ?, published = ? WHERE slug = ?', [main.draft, main.published, main.slug]);
      await this.run('DELETE FROM pages WHERE slug = ?', [slug]);
      await this.run('DELETE FROM versions WHERE kind = ? AND slug = ?', ['page', slug]);
    }
  }

  async close(): Promise<void> {
    await this.sql.close();
  }

  /** Every row a query returns. Written with `?`; the dialect turns that into what the database wants. */
  private async rows<T = Row>(query: string, params: unknown[] = []): Promise<T[]> {
    return [...((await this.sql.unsafe(this.dialect.params(query), params)) as T[])];
  }

  private async row<T = Row>(query: string, params: unknown[] = []): Promise<T | null> {
    return (await this.rows<T>(query, params))[0] ?? null;
  }

  private async run(query: string, params: unknown[] = []): Promise<void> {
    await this.sql.unsafe(this.dialect.params(query), params);
  }

  /** How many rows a change touched: the database's own answer, so two requests cannot both win. */
  private async changed(query: string, params: unknown[] = []): Promise<number> {
    return Number(((await this.sql.unsafe(this.dialect.params(query), params)) as { count?: number }).count ?? 0);
  }

  private async getMeta(key: string): Promise<unknown> {
    const row = await this.row<{ value: string }>(`SELECT value FROM meta WHERE ${this.dialect.key} = ?`, [key]);
    return row ? JSON.parse(row.value) : null;
  }

  private async setMeta(key: string, value: unknown): Promise<void> {
    await this.run(this.dialect.upsert('meta', [this.dialect.key, 'value'], [this.dialect.key], ['value']), [key, JSON.stringify(value)]);
  }

  /** Nothing was ever saved here: no settings, no page, no entry. A new site starts from this. */
  async isEmpty(): Promise<boolean> {
    return !(await this.row(`SELECT 1 AS found FROM meta WHERE ${this.dialect.key} = ?`, ['site'])) && !(await this.row('SELECT 1 AS found FROM pages')) && !(await this.row('SELECT 1 AS found FROM entries'));
  }

  async site(): Promise<Site> {
    return normalizeSite(await this.getMeta('site'));
  }

  /**
   * Sets the site's settings. A content type may not take the address of a
   * page, and one that still has entries may not be removed: either would
   * leave something at an address nobody chose.
   */
  async setSite(input: unknown): Promise<Site> {
    const site = normalizeSite(input);
    for (const type of site.types) {
      if (await this.draft(type.path)) throw new Error(`a page already lives at "/${type.path}/"; give the content type "${type.name}" another address`);
    }
    // A language takes its prefix as an address, and keeps its pages while it has any (ADR 0024).
    const slugs = (await this.rows<{ slug: string }>('SELECT slug FROM pages')).map((row) => String(row.slug));
    for (const language of site.languages) {
      if (slugs.includes(prefixOf(language)) && !(await this.site()).languages.includes(language)) throw new Error(`a page already lives at "/${prefixOf(language)}/"; give it another address before adding ${languageName(language)}`);
    }
    const translated = (await this.drafts()).flatMap((page) => Object.keys(page.translations ?? {}).filter((language) => !site.languages.includes(language)).map((language) => ({ page, language })))[0];
    if (translated) throw new Error(`"${translated.page.title}" is still in ${languageName(translated.language)}; remove its translation before removing the language`);
    const left = slugs.find((slug) => slug.includes('/') && !site.languages.some((language) => slug.startsWith(`${prefixOf(language)}/`)));
    if (left) throw new Error(`"/${left}/" is still in ${languageName(left.split('/')[0] as string)}; delete the pages of a language before removing it`);
    const kept = new Set([...site.types.map((t) => t.id)]);
    const orphans = (await this.rows<{ type: string; n: number | string }>('SELECT type, COUNT(*) AS n FROM entries GROUP BY type')).filter((row) => !kept.has(row.type));
    const first = orphans[0];
    if (first) {
      const n = Number(first.n);
      const gone = (await this.site()).types.find((t) => t.id === first.type);
      throw new Error(`"${gone?.name ?? first.type}" still has ${n === 1 ? '1 entry' : `${n} entries`}; delete what it holds before removing the content type`);
    }
    // A layout a page or a content type is drawn in stays while they are (ADR 0035).
    const layouts = new Set((site.layouts ?? READY_LAYOUTS).map((l) => l.id));
    const before = (await this.site()).layouts ?? READY_LAYOUTS;
    const gone = (id: string | undefined): string => (id && !layouts.has(id) ? (before.find((l) => l.id === id)?.name ?? id) : '');
    const page = (await this.drafts()).find((p) => gone(p.layout));
    if (page) throw new Error(`"${page.title}" is drawn in the layout "${gone(page.layout)}"; give it another layout before removing this one`);
    const type = site.types.find((t) => gone(t.layout));
    if (type) throw new Error(`"${type.name}" is drawn in the layout "${gone(type.layout)}"; give it another layout before removing this one`);
    await this.setMeta('site', site);
    return site;
  }

  /** Old addresses that lead to new ones (ADR 0009). The export writes a small page for each. */
  async redirects(): Promise<Redirect[]> {
    return normalizeRedirects(await this.getMeta('redirects'));
  }

  async setRedirects(input: unknown): Promise<Redirect[]> {
    const redirects = normalizeRedirects(input);
    await this.setMeta('redirects', redirects);
    return redirects;
  }

  private async readTheme(key: string): Promise<Theme | null> {
    const raw = await this.getMeta(key);
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
  theme(): Promise<Theme | null> {
    return this.readTheme('theme');
  }

  /** The theme visitors see: what the export uses. Null until one is published. */
  publishedTheme(): Promise<Theme | null> {
    return this.readTheme('theme:published');
  }

  /** Replaces the theme being worked on. Refuses a document with any issue and says which. */
  async setTheme(input: unknown): Promise<Theme> {
    const { theme, issues } = parseTheme(input);
    if (!theme) throw new Error(`not a valid theme: ${issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`);
    await this.setMeta('theme', theme);
    return theme;
  }

  /** Freezes the theme being worked on as the one visitors see. */
  async publishTheme(): Promise<Theme> {
    const theme = await this.theme();
    if (!theme) throw new Error('this site has no theme yet');
    await this.setMeta('theme:published', theme);
    return theme;
  }

  /** Whether the theme being worked on differs from the published one. */
  async themeChanged(): Promise<boolean> {
    return JSON.stringify(await this.theme()) !== JSON.stringify(await this.publishedTheme());
  }

  /**
   * The page a content type draws its entries with (ADR 0015), as it is being
   * worked on. Like the theme it has a draft and a published copy, so
   * changing it never changes the live site until it is published. Null: the
   * type uses the default page.
   */
  async template(typeId: string): Promise<Block[] | null> {
    return this.readTemplate(`template:${(await this.type(typeId)).id}`);
  }

  /** The page visitors see entries of this type in. */
  async publishedTemplate(typeId: string): Promise<Block[] | null> {
    return this.readTemplate(`template:${(await this.type(typeId)).id}:published`);
  }

  private async readTemplate(key: string): Promise<Block[] | null> {
    const raw = await this.getMeta(key);
    return Array.isArray(raw) ? cleanTemplate(raw) : null;
  }

  /** Replaces a type's page being worked on; null goes back to the default page. */
  async setTemplate(typeId: string, blocks: unknown): Promise<Block[] | null> {
    const type = await this.type(typeId);
    const clean = Array.isArray(blocks) ? cleanTemplate(blocks) : null;
    await this.setMeta(`template:${type.id}`, clean);
    return clean;
  }

  async publishTemplate(typeId: string): Promise<void> {
    await this.setMeta(`template:${(await this.type(typeId)).id}:published`, await this.template(typeId));
  }

  /** Whether a type's page differs from what visitors see. */
  async templateChanged(typeId: string): Promise<boolean> {
    return JSON.stringify(await this.template(typeId)) !== JSON.stringify(await this.publishedTemplate(typeId));
  }

  /** Saves a page's draft. The published copy, if any, is left as it is. */
  async savePage(input: unknown): Promise<Page> {
    const { page } = normalizePage(input);
    if (!page.title) throw new Error('a page has a title');
    // Words kept for a block the page no longer has are words of nothing.
    for (const translation of Object.values(page.translations ?? {})) translation.fields = keepWords(page.blocks, translation.fields);
    const site = await this.site();
    const problem = slugProblem(site, page.slug, reservedSlugs(site));
    if (problem) throw new Error(problem);
    const next = await this.row<{ n: number | string }>('SELECT COALESCE(MAX(position), 0) + 1 AS n FROM pages');
    await this.run(this.dialect.upsert('pages', ['slug', 'position', 'draft', 'updated_at'], ['slug'], ['draft', 'updated_at']), [
      page.slug,
      Number(next?.n ?? 1),
      JSON.stringify(page),
      new Date().toISOString(),
    ]);
    return page;
  }

  /** Freezes the current draft as what visitors see. */
  async publish(where: string, now = new Date()): Promise<void> {
    // A translation is published with its page (ADR 0032 d5).
    const found = await this.locate(where);
    const slug = found?.translated ? found.of : where;
    // Asked before, not counted after: MySQL counts a row that already held these values as unchanged.
    if (!(await this.row('SELECT 1 AS found FROM pages WHERE slug = ?', [slug]))) throw new Error(`no page "${slug}"`);
    const before = await this.liveAddresses(slug);
    const at = now.toISOString();
    await this.run('UPDATE pages SET published = draft, published_at = ? WHERE slug = ?', [at, slug]);
    const row = await this.row<{ published: string }>('SELECT published FROM pages WHERE slug = ?', [slug]);
    await this.keepVersion('page', slug, String(row?.published), at);
    // A translation published at a new address leaves a way from the old one (ADR 0036).
    await this.followMoves(before, await this.liveAddresses(slug));
    this.emit('page.published', { slug, title: String((JSON.parse(String(row?.published)) as { title?: unknown }).title ?? '') });
  }

  /**
   * Publishes a page or an entry at a set time (ADR 0039): what its draft is
   * then is what is published. One time for each; set again, it moves.
   */
  async schedule(kind: string, slug: string, at: string, now = new Date()): Promise<Scheduled[]> {
    const when = new Date(at);
    if (Number.isNaN(when.getTime())) throw new Error('give the date and hour to publish at');
    if (when.getTime() <= now.getTime()) throw new Error('that time has passed; publish it now instead');
    if (when.getTime() > now.getTime() + 2 * 365 * 24 * 3600 * 1000) throw new Error('a publication is set at most two years ahead');
    if (kind === 'page') {
      if (!(await this.row('SELECT 1 AS found FROM pages WHERE slug = ?', [slug]))) throw new Error(`no page "${slug}"`);
    } else {
      await this.type(kind);
      if (!(await this.row('SELECT 1 AS found FROM entries WHERE type = ? AND slug = ?', [kind, slug]))) throw new Error(`no entry "${slug}"`);
    }
    await this.run(this.dialect.upsert('schedule', ['kind', 'slug', 'at'], ['kind', 'slug'], ['at']), [kind, slug, when.toISOString()]);
    return this.scheduled();
  }

  async unschedule(kind: string, slug: string): Promise<Scheduled[]> {
    await this.run('DELETE FROM schedule WHERE kind = ? AND slug = ?', [kind, slug]);
    return this.scheduled();
  }

  /** Every publication set for later, soonest first. */
  async scheduled(): Promise<Scheduled[]> {
    return this.rows<Scheduled>('SELECT kind, slug, at FROM schedule ORDER BY at, kind, slug');
  }

  /**
   * Publishes what is due. Each one is claimed by deleting it first, so two
   * processes with a clock (the editor and the runtime) never both publish it.
   */
  async publishDue(now = new Date()): Promise<Scheduled[]> {
    const done: Scheduled[] = [];
    for (const due of await this.rows<Scheduled>('SELECT kind, slug, at FROM schedule WHERE at <= ? ORDER BY at', [now.toISOString()])) {
      if ((await this.changed('DELETE FROM schedule WHERE kind = ? AND slug = ? AND at = ?', [due.kind, due.slug, due.at])) !== 1) continue;
      if (due.kind === 'page') await this.publish(due.slug, now);
      else await this.publishEntry(due.kind, due.slug, now);
      done.push(due);
    }
    return done;
  }

  /** Where a page and each of its translations are published, by language. */
  private async liveAddresses(of: string): Promise<Map<string, string>> {
    return new Map((await this.published()).filter((p) => p.of === of).map((p) => [p.language, p.slug]));
  }

  /** Each address visitors knew that moved, kept as a redirect to where it went (ADR 0036). */
  private async followMoves(before: Map<string, string>, after: Map<string, string>): Promise<void> {
    let redirects = await this.redirects();
    const start = JSON.stringify(redirects);
    for (const [language, old] of before) {
      const now = after.get(language);
      if (now !== undefined && now !== old) redirects = addRedirect(redirects, pagePath(old), pagePath(now));
    }
    if (JSON.stringify(redirects) !== start) await this.setRedirects(redirects);
  }

  /**
   * Gives a page another address (ADR 0036): its draft, what is published,
   * its versions and the menu go with it, and every address of it visitors
   * knew leads to the new one.
   */
  async movePage(from: string, input: string): Promise<Page> {
    const site = await this.site();
    const to = pageSlug(input);
    const page = await this.draft(from);
    if (!page) throw new Error(`no page "${from}"`);
    if (from === '') throw new Error('the home page stays at /');
    if (!to || to === from) throw new Error('a page moves to another address');
    if (languageOf(site, to) !== languageOf(site, from)) throw new Error(`a page in ${languageName(languageOf(site, from))} stays under its language`);
    const problem = slugProblem(site, to, reservedSlugs(site));
    if (problem) throw new Error(problem);
    const moved = { ...page, slug: to };
    const others = (await this.drafts()).filter((p) => p.slug !== from);
    const taken = placePages(site, others).find((p) => placePages(site, [moved]).some((m) => m.slug === p.slug));
    if (taken) throw new Error(`"/${taken.slug}/" is already the address of "${taken.title}"`);
    const before = await this.liveAddresses(from);
    const row = await this.row<{ published: string | null }>('SELECT published FROM pages WHERE slug = ?', [from]);
    const published = row?.published ? JSON.stringify({ ...JSON.parse(row.published), slug: to }) : null;
    await this.run('UPDATE pages SET slug = ?, draft = ?, published = ?, updated_at = ? WHERE slug = ?', [to, JSON.stringify(moved), published, new Date().toISOString(), from]);
    await this.run('UPDATE versions SET slug = ? WHERE kind = ? AND slug = ?', [to, 'page', from]);
    await this.run('UPDATE page_locks SET slug = ? WHERE slug = ?', [to, from]);
    await this.run('UPDATE schedule SET slug = ? WHERE kind = ? AND slug = ?', [to, 'page', from]);
    // The menu names a page by its address: it follows the page.
    if (site.menu) {
      const follow = (nodes: MenuNode[]): MenuNode[] => nodes.map((n) => ({ ...n, target: n.target.kind === 'page' && n.target.slug === from ? { kind: 'page', slug: to } : n.target, children: follow(n.children) }));
      await this.setMeta('site', { ...site, menu: follow(site.menu) });
    }
    await this.followMoves(before, await this.liveAddresses(to));
    return moved;
  }

  async draft(slug: string): Promise<Page | null> {
    const row = await this.row<{ draft: string }>('SELECT draft FROM pages WHERE slug = ?', [slug]);
    return row ? normalizePage(JSON.parse(row.draft)).page : null;
  }

  /** Every page's draft, as kept, in menu order. */
  private async drafts(): Promise<Page[]> {
    return (await this.rows<{ draft: string }>('SELECT draft FROM pages ORDER BY position, slug')).map((row) => normalizePage(JSON.parse(row.draft)).page);
  }

  /** The page at an address, as it is being written: a page kept there, or a translation of one (ADR 0032). */
  async locate(slug: string): Promise<PlacedPage | null> {
    return placePages(await this.site(), await this.drafts()).find((p) => p.slug === slug) ?? null;
  }

  /**
   * Every page at its address, in menu order, with whether its draft differs
   * from what is published. A translation is listed at its own address, with
   * the page it is of and how much of it still shows the main language.
   */
  async pages(): Promise<{ slug: string; title: string; inMenu: boolean; published: boolean; changed: boolean; of: string; language: string; translated: boolean; split: boolean; missing: number }[]> {
    const site = await this.site();
    const rows = await this.rows<{ slug: string; draft: string; published: string | null }>('SELECT slug, draft, published FROM pages ORDER BY position, slug');
    const drafts = rows.map((row) => normalizePage(JSON.parse(row.draft)).page);
    const live = new Set(placePages(site, rows.flatMap((row) => (row.published === null ? [] : [normalizePage(JSON.parse(row.published)).page]))).map((p) => p.slug));
    const changed = new Map(rows.map((row) => [String(row.slug), row.published !== row.draft]));
    const byslug = new Map(drafts.map((page) => [page.slug, page]));
    return placePages(site, drafts).map((p) => {
      const owner = p.translated ? byslug.get(p.of) : undefined;
      const translation = owner?.translations?.[p.language];
      return {
        slug: p.slug,
        title: p.title,
        inMenu: p.inMenu,
        published: live.has(p.slug),
        changed: changed.get(p.translated ? p.of : p.slug) ?? true,
        of: p.of,
        language: p.language,
        translated: p.translated,
        split: p.split,
        missing: owner && translation ? missingWords(owner, translation).length : 0,
      };
    });
  }

  /** A page's or a section's translation into a language, changed by `change` and kept in its draft (ADR 0032 d5). */
  private async withTranslation(of: string, language: string, change: (page: Page, translation: PageTranslation | undefined) => PageTranslation | null, kind: Kept = 'page'): Promise<PlacedPage | null> {
    const site = await this.site();
    if (!site.languages.includes(language)) throw new Error(`${languageName(language)} is not one of the site's languages`);
    const page = kind === 'page' ? await this.draft(of) : await this.sectionDraft(of);
    if (!page || (kind === 'page' && languageOf(site, of) !== site.language)) throw new Error(`no ${kind} "${of}"`);
    const next = change(page, page.translations?.[language]);
    const translations = { ...page.translations };
    if (next) translations[language] = next;
    else delete translations[language];
    const changed = { ...page, translations };
    if (next && kind === 'page') {
      const at = translatedPage(site, changed, language) as PlacedPage;
      const taken = placePages(site, await this.drafts()).find((p) => p.slug === at.slug && !(p.of === of && p.language === language));
      if (taken) throw new Error(`"/${at.slug}/" is already the address of "${taken.title}"`);
      const problem = slugProblem(site, at.slug, reservedSlugs(site));
      if (problem) throw new Error(problem);
    }
    if (kind === 'page') await this.savePage(changed);
    else await this.saveSection(changed);
    return next ? translatedPage(site, changed, language) : null;
  }

  /** Starts a page (or a section) in another language: all in the main language's words until they are written. */
  async translate(of: string, language: string, kind: Kept = 'page'): Promise<PlacedPage> {
    return (await this.withTranslation(
      of,
      language,
      (_page, had) => {
        if (had) throw new Error(`this ${kind} is already in that language`);
        return newTranslation();
      },
      kind,
    )) as PlacedPage;
  }

  /**
   * Keeps a translation as written in the builder: its address, title and
   * description, and its words, or its blocks when it is split. A translation
   * that is not split keeps the main blocks (ADR 0032 d3).
   */
  async saveTranslation(of: string, language: string, input: unknown, kind: Kept = 'page'): Promise<PlacedPage> {
    const site = await this.site();
    const { page: written } = normalizePage(input);
    if (!written.title) throw new Error('a page has a title');
    if (languageOf(site, written.slug) !== language) throw new Error(`a page in ${languageName(language)} stays under /${prefixOf(language)}/`);
    return (await this.withTranslation(
      of,
      language,
      (page, had) => {
        if (!had) throw new Error(`this ${kind} is not in that language yet`);
        const address = of === '' || kind === 'section' ? '' : baseSlug(site, written.slug);
        const next: PageTranslation = {
          slug: address === of ? '' : address,
          title: written.title === page.title ? '' : written.title,
          description: written.description === page.description ? '' : written.description,
          fields: {},
          blocks: had.blocks ? written.blocks : null,
        };
        if (!had.blocks) {
          const { fields, problem } = wordsFrom(page.blocks, written.blocks);
          if (problem) throw new Error(problem);
          next.fields = fields;
        }
        return next;
      },
      kind,
    )) as PlacedPage;
  }

  /** Fills in what a translation does not say yet from a page written in that language (ADR 0034); words already written stay. */
  async fillTranslation(of: string, language: string, input: unknown, kind: Kept = 'page'): Promise<PlacedPage> {
    const { page: written } = normalizePage(input);
    return (await this.withTranslation(
      of,
      language,
      (page, had) => {
        if (!had || had.blocks) throw new Error(`this ${kind} has no translation into that language to fill in`);
        return fillTranslation(page, had, written);
      },
      kind,
    )) as PlacedPage;
  }

  /** Splits a page (or a section) for one language (ADR 0032 d4): the translation keeps its own blocks, as they show now. */
  async splitTranslation(of: string, language: string, kind: Kept = 'page'): Promise<PlacedPage> {
    return (await this.withTranslation(
      of,
      language,
      (page, had) => {
        if (!had) throw new Error(`this ${kind} is not in that language yet`);
        return had.blocks ? had : { ...had, fields: {}, blocks: localizeBlocks(page.blocks, had.fields) };
      },
      kind,
    )) as PlacedPage;
  }

  /** Takes a page (or a section) out of one language. What is published stays until it is published again. */
  async deleteTranslation(of: string, language: string, kind: Kept = 'page'): Promise<void> {
    await this.withTranslation(of, language, () => null, kind);
  }

  async deletePage(at: string): Promise<void> {
    const found = await this.locate(at);
    if (found?.translated) return this.deleteTranslation(found.of, found.language);
    const slug = at;
    if (slug === '') throw new Error('the home page cannot be deleted');
    await this.run('DELETE FROM pages WHERE slug = ?', [slug]);
    await this.run('DELETE FROM versions WHERE kind = ? AND slug = ?', ['page', slug]);
    await this.run('DELETE FROM schedule WHERE kind = ? AND slug = ?', ['page', slug]);
    await this.run('DELETE FROM page_locks WHERE slug = ?', [slug]);
  }

  // Pages behind a password (ADR 0043).

  /**
   * Puts a page, with each of its translations, behind a password, or takes
   * it away (null). The password is kept only as its hash.
   */
  async lockPage(at: string, password: string | null): Promise<string[]> {
    const found = await this.locate(at);
    const slug = found?.translated ? found.of : at;
    if (slug === '') throw new Error('the home page is open to everyone');
    if (!(await this.row('SELECT 1 AS found FROM pages WHERE slug = ?', [slug]))) throw new Error(`no page "${slug}"`);
    if (password === null) await this.run('DELETE FROM page_locks WHERE slug = ?', [slug]);
    else {
      if (password.length < 4 || password.length > 200) throw new Error('a password has 4 to 200 characters');
      await this.run(this.dialect.upsert('page_locks', ['slug', 'hash'], ['slug'], ['hash']), [slug, await Bun.password.hash(password, { algorithm: 'argon2id' })]);
    }
    return this.lockedPages();
  }

  /** The pages behind a password, by the address of their main language. */
  async lockedPages(): Promise<string[]> {
    return (await this.rows<{ slug: string }>('SELECT slug FROM page_locks ORDER BY slug')).map((r) => String(r.slug));
  }

  /**
   * Is this the page's password? When it is, the key a visitor keeps to see
   * it: it changes with the password, so a new password shuts out everyone
   * who had the old one. Null otherwise.
   */
  async unlockPage(slug: string, password: string): Promise<string | null> {
    const row = await this.row<{ hash: string }>('SELECT hash FROM page_locks WHERE slug = ?', [slug]);
    if (!row || !(await Bun.password.verify(password, String(row.hash)))) return null;
    return this.pageKey(slug);
  }

  /** The key that opens a page for a visitor who gave its password, or null for a page that has none. */
  async pageKey(slug: string): Promise<string | null> {
    const row = await this.row<{ hash: string }>('SELECT hash FROM page_locks WHERE slug = ?', [slug]);
    if (!row) return null;
    let secret = (await this.getMeta('unlock')) as string | null;
    if (!secret) {
      secret = newSecret();
      await this.setMeta('unlock', secret);
    }
    return new Bun.CryptoHasher('sha256', secret).update(`${slug}\n${String(row.hash)}`).digest('base64url');
  }

  /** Every published page at its address, translations with them, in menu order (ADR 0032). */
  async published(): Promise<PlacedPage[]> {
    const pages = (await this.rows<{ published: string }>('SELECT published FROM pages WHERE published IS NOT NULL ORDER BY position, slug')).map((row) => normalizePage(JSON.parse(row.published)).page);
    return placePages(await this.site(), pages);
  }

  /** What each published translation still shows in the main language, by its address (ADR 0032 d6). */
  async untranslated(): Promise<{ slug: string; language: string; missing: number }[]> {
    const site = await this.site();
    const pages = (await this.rows<{ published: string }>('SELECT published FROM pages WHERE published IS NOT NULL ORDER BY position, slug')).map((row) => normalizePage(JSON.parse(row.published)).page);
    const byslug = new Map(pages.map((page) => [page.slug, page]));
    return placePages(site, pages).flatMap((p) => {
      const owner = p.translated ? byslug.get(p.of) : undefined;
      const translation = owner?.translations?.[p.language];
      const missing = owner && translation ? missingWords(owner, translation).length : 0;
      return missing ? [{ slug: p.slug, language: p.language, missing }] : [];
    });
  }

  /** A section as it is being written (ADR 0033). */
  async sectionDraft(slug: string): Promise<Page | null> {
    const row = await this.row<{ draft: string }>('SELECT draft FROM sections WHERE slug = ?', [slug]);
    return row ? normalizePage(JSON.parse(row.draft)).page : null;
  }

  /** Every section as it is being written, in order. */
  async draftSections(): Promise<Page[]> {
    return (await this.rows<{ draft: string }>('SELECT draft FROM sections ORDER BY position, slug')).map((row) => normalizePage(JSON.parse(row.draft)).page);
  }

  /** Every published section, in order: what the export draws. */
  async publishedSections(): Promise<Page[]> {
    return (await this.rows<{ published: string }>('SELECT published FROM sections WHERE published IS NOT NULL ORDER BY position, slug')).map((row) => normalizePage(JSON.parse(row.published)).page);
  }

  /** A section's translation as the builder edits it: by its name under the language's prefix, as a page's would be. */
  async locateSection(slug: string): Promise<PlacedPage | null> {
    return placePages(await this.site(), await this.draftSections()).find((p) => p.slug === slug) ?? null;
  }

  /** Saves a section's draft. It has a name and a title, and holds no section of its own. */
  async saveSection(input: unknown): Promise<Page> {
    const { page } = normalizePage({ ...(isObject(input) ? input : {}), inMenu: false });
    if (!page.title) throw new Error('a section has a title');
    if (!page.slug || page.slug.includes('/')) throw new Error('a section has a name');
    if (sectionsIn(page.blocks).length) throw new Error('a section holds no other section');
    for (const translation of Object.values(page.translations ?? {})) translation.fields = keepWords(page.blocks, translation.fields);
    const exists = await this.row('SELECT 1 AS found FROM sections WHERE slug = ?', [page.slug]);
    if (!exists && Number((await this.row<{ n: number | string }>('SELECT COUNT(*) AS n FROM sections'))?.n ?? 0) >= MAX_SECTIONS) throw new Error(`a site keeps at most ${MAX_SECTIONS} sections`);
    const next = await this.row<{ n: number | string }>('SELECT COALESCE(MAX(position), 0) + 1 AS n FROM sections');
    await this.run(this.dialect.upsert('sections', ['slug', 'position', 'draft', 'updated_at'], ['slug'], ['draft', 'updated_at']), [
      page.slug,
      Number(next?.n ?? 1),
      JSON.stringify(page),
      new Date().toISOString(),
    ]);
    return page;
  }

  /** Publishes a section: every page that shows it shows this, from the next export. */
  async publishSection(where: string, now = new Date()): Promise<void> {
    const found = await this.locateSection(where);
    const slug = found?.translated ? found.of : where;
    if (!(await this.row('SELECT 1 AS found FROM sections WHERE slug = ?', [slug]))) throw new Error(`no section "${slug}"`);
    const at = now.toISOString();
    await this.run('UPDATE sections SET published = draft, published_at = ? WHERE slug = ?', [at, slug]);
    const row = await this.row<{ published: string }>('SELECT published FROM sections WHERE slug = ?', [slug]);
    await this.keepVersion('section', slug, String(row?.published), at);
  }

  /** Where each section is shown: the title and address of every page, entry or type's page that has it, drafts and published alike. */
  async sectionUses(): Promise<Map<string, string[]>> {
    const uses = new Map<string, Set<string>>();
    const add = (blocks: Block[], where: string): void => {
      for (const name of sectionsIn(blocks)) uses.set(name, (uses.get(name) ?? new Set()).add(where));
    };
    for (const row of await this.rows<{ slug: string; draft: string; published: string | null }>('SELECT slug, draft, published FROM pages ORDER BY position, slug')) {
      for (const doc of [row.draft, row.published]) if (doc) add(normalizePage(JSON.parse(doc)).page.blocks, pagePath(String(row.slug)));
    }
    const site = await this.site();
    for (const type of contentTypes(site)) {
      for (const row of await this.rows<{ slug: string; draft: string; published: string | null }>('SELECT slug, draft, published FROM entries WHERE type = ?', [type.id])) {
        for (const doc of [row.draft, row.published]) if (doc) add(normalizePost(JSON.parse(doc), undefined, type).post.blocks, entryPath(type, String(row.slug)));
      }
      add([...((await this.template(type.id)) ?? []), ...((await this.publishedTemplate(type.id)) ?? [])], listPath(type));
    }
    // A layout's places show sections too (ADR 0035).
    for (const layout of site.layouts ?? READY_LAYOUTS) add(LAYOUT_AREAS.map((area) => layout[area]).filter(Boolean).map(areaBlock), `the layout "${layout.name}"`);
    return new Map([...uses].map(([name, at]) => [name, [...at].sort()]));
  }

  /** Every section, with whether it differs from what is published, where it is shown, and its translations. */
  async sections(): Promise<{ slug: string; title: string; published: boolean; changed: boolean; usedOn: string[]; languages: string[] }[]> {
    const uses = await this.sectionUses();
    return (await this.rows<{ slug: string; draft: string; published: string | null }>('SELECT slug, draft, published FROM sections ORDER BY position, slug')).map((row) => {
      const page = normalizePage(JSON.parse(row.draft)).page;
      return { slug: page.slug, title: page.title, published: row.published !== null, changed: row.published !== row.draft, usedOn: uses.get(page.slug) ?? [], languages: Object.keys(page.translations ?? {}) };
    });
  }

  /** Deletes a section no page shows (ADR 0033); one still shown is kept, with where. */
  async deleteSection(at: string): Promise<void> {
    const found = await this.locateSection(at);
    if (found?.translated) return this.deleteTranslation(found.of, found.language, 'section');
    const used = (await this.sectionUses()).get(at) ?? [];
    if (used.length) throw new Error(`this section is shown on ${used.join(', ')}; take it off there first`);
    await this.run('DELETE FROM sections WHERE slug = ?', [at]);
    await this.run('DELETE FROM versions WHERE kind = ? AND slug = ?', ['section', at]);
  }

  /** A content type of this site, by name. Asking for one it does not have is an error, not an empty list. */
  async type(id: string): Promise<ContentType> {
    const type = typeById(await this.site(), id);
    if (!type) throw new Error(`this site has no content type "${id}"`);
    return type;
  }

  /** Saves an entry's draft. Like a page, what is published is left as it is. An entry with no valid date is dated today. */
  async saveEntry(typeId: string, input: unknown): Promise<Post> {
    const type = await this.type(typeId);
    const { post } = normalizePost(input, new Date().toISOString().slice(0, 10), type);
    if (!post.title) throw new Error('an entry has a title');
    if (!post.slug) throw new Error('an entry has an address');
    await this.run(this.dialect.upsert('entries', ['type', 'slug', 'draft', 'updated_at'], ['type', 'slug'], ['draft', 'updated_at']), [
      type.id,
      post.slug,
      JSON.stringify(post),
      new Date().toISOString(),
    ]);
    return post;
  }

  async publishEntry(typeId: string, slug: string, now = new Date()): Promise<void> {
    if (!(await this.row('SELECT 1 AS found FROM entries WHERE type = ? AND slug = ?', [typeId, slug]))) throw new Error(`no entry "${slug}"`);
    const at = now.toISOString();
    await this.run('UPDATE entries SET published = draft, published_at = ? WHERE type = ? AND slug = ?', [at, typeId, slug]);
    const row = await this.row<{ published: string }>('SELECT published FROM entries WHERE type = ? AND slug = ?', [typeId, slug]);
    await this.keepVersion(typeId, slug, String(row?.published), at);
    this.emit('entry.published', { type: typeId, slug, title: String((JSON.parse(String(row?.published)) as { title?: unknown }).title ?? '') });
  }

  /**
   * What was published, kept: each publication of a page (kind `page`) or of
   * an entry (kind: its type), the newest {@link VERSIONS_KEPT}. The owner
   * can bring one back into the editor, as a change to look at before saving.
   */
  private async keepVersion(kind: string, slug: string, doc: string, at: string): Promise<void> {
    await this.run(this.dialect.insertNew('versions', ['kind', 'slug', 'at', 'doc']), [kind, slug, at, doc]);
    const kept = await this.rows<{ at: string }>('SELECT at FROM versions WHERE kind = ? AND slug = ? ORDER BY at DESC', [kind, slug]);
    const oldest = kept[VERSIONS_KEPT - 1];
    if (kept.length > VERSIONS_KEPT && oldest) await this.run('DELETE FROM versions WHERE kind = ? AND slug = ? AND at < ?', [kind, slug, oldest.at]);
  }

  /** The kept publications of a page or an entry, newest first: when, and the title it had. */
  async versions(kind: string, at: string): Promise<{ at: string; title: string }[]> {
    const found = kind === 'page' ? await this.locate(at) : null;
    const slug = found?.translated ? found.of : at;
    const rows = await this.rows<{ at: string; doc: string }>('SELECT at, doc FROM versions WHERE kind = ? AND slug = ? ORDER BY at DESC', [kind, slug]);
    return rows.map((row) => ({ at: row.at, title: String((JSON.parse(row.doc) as { title?: unknown }).title ?? '') }));
  }

  /** One kept publication, as it was saved; the caller cleans it as a page or an entry. */
  async version(kind: string, where: string, at: string): Promise<unknown> {
    const found = kind === 'page' ? await this.locate(where) : null;
    const slug = found?.translated ? found.of : where;
    const row = await this.row<{ doc: string }>('SELECT doc FROM versions WHERE kind = ? AND slug = ? AND at = ?', [kind, slug, at]);
    return row ? JSON.parse(row.doc) : null;
  }

  async entryDraft(typeId: string, slug: string): Promise<Post | null> {
    const type = await this.type(typeId);
    const row = await this.row<{ draft: string }>('SELECT draft FROM entries WHERE type = ? AND slug = ?', [typeId, slug]);
    return row ? normalizePost(JSON.parse(row.draft), undefined, type).post : null;
  }

  /** Every entry of a type, in the order its list shows them, with whether its draft differs from what is published. */
  async entries(typeId: string): Promise<{ slug: string; title: string; date: string; published: boolean; changed: boolean }[]> {
    const type = await this.type(typeId);
    const rows = (await this.rows<{ draft: string; published: string | null }>('SELECT draft, published FROM entries WHERE type = ?', [typeId])).map((row) => ({
      post: normalizePost(JSON.parse(row.draft), undefined, type).post,
      published: row.published !== null,
      changed: row.published !== row.draft,
    }));
    const state = new Map(rows.map((row) => [row.post.slug, row]));
    return listed(type, rows.map((row) => row.post)).map((post) => {
      const { published, changed } = state.get(post.slug) as { published: boolean; changed: boolean };
      return { slug: post.slug, title: post.title, date: post.date, published, changed };
    });
  }

  /** Every entry of a type as the author last left it, in the order its list shows them: what the editor's canvas lists. */
  async draftEntries(typeId: string): Promise<Post[]> {
    const type = await this.type(typeId);
    const rows = await this.rows<{ draft: string }>('SELECT draft FROM entries WHERE type = ?', [typeId]);
    return listed(type, rows.map((row) => normalizePost(JSON.parse(row.draft), undefined, type).post));
  }

  async deleteEntry(typeId: string, slug: string): Promise<void> {
    await this.run('DELETE FROM entries WHERE type = ? AND slug = ?', [typeId, slug]);
    await this.run('DELETE FROM versions WHERE kind = ? AND slug = ?', [typeId, slug]);
    await this.run('DELETE FROM schedule WHERE kind = ? AND slug = ?', [typeId, slug]);
    await this.run('DELETE FROM comments WHERE type = ? AND entry = ?', [typeId, slug]);
  }

  /** Every published entry of a type, in the order its list shows them. */
  async publishedEntries(typeId: string): Promise<Post[]> {
    const type = await this.type(typeId);
    const rows = await this.rows<{ published: string }>('SELECT published FROM entries WHERE type = ? AND published IS NOT NULL', [typeId]);
    return listed(type, rows.map((row) => normalizePost(JSON.parse(row.published), undefined, type).post));
  }

  // Posts are the content type every site has; these say so by name.
  savePost(input: unknown): Promise<Post> {
    return this.saveEntry(POSTS_TYPE, input);
  }
  publishPost(slug: string): Promise<void> {
    return this.publishEntry(POSTS_TYPE, slug);
  }
  postDraft(slug: string): Promise<Post | null> {
    return this.entryDraft(POSTS_TYPE, slug);
  }
  posts(): Promise<{ slug: string; title: string; date: string; published: boolean; changed: boolean }[]> {
    return this.entries(POSTS_TYPE);
  }
  deletePost(slug: string): Promise<void> {
    return this.deleteEntry(POSTS_TYPE, slug);
  }
  publishedPosts(): Promise<Post[]> {
    return this.publishedEntries(POSTS_TYPE);
  }

  /**
   * Stores an image and returns where a page points to show it. The name is
   * the hash of the bytes, so the same picture uploaded twice is stored once
   * and a name never comes to mean another picture.
   */
  async addMedia(bytes: Uint8Array, label: unknown = ''): Promise<MediaItem> {
    if (bytes.length > MEDIA_MAX_BYTES) throw new Error(`an image is at most ${MEDIA_MAX_BYTES / 1024 / 1024} MB`);
    const ext = imageExt(bytes);
    if (!ext) throw new Error('not an image this site can show (PNG, JPEG, GIF, WebP or AVIF)');
    const name = `${new Bun.CryptoHasher('sha256').update(bytes).digest('hex').slice(0, 32)}.${ext}`;
    await this.run(this.dialect.insertNew('media', ['name', 'label', 'size', 'bytes', 'created_at']), [name, str(label, 200).trim(), bytes.length, bytes, new Date().toISOString()]);
    await this.recordSize(name, bytes);
    return (await this.media()).find((m) => m.name === name) as MediaItem;
  }

  /** Keeps how wide and high a picture is, as its bytes say. */
  private async recordSize(name: string, bytes: Uint8Array): Promise<{ width: number; height: number }> {
    const size = imageSize(bytes) ?? { width: 0, height: 0 };
    await this.run(this.dialect.upsert('media_sizes', ['name', 'width', 'height'], ['name'], ['width', 'height']), [name, size.width, size.height]);
    return size;
  }

  /** How wide and high each stored picture is, read once from its bytes for a picture stored before this was kept. */
  private async sizes(): Promise<Map<string, { width: number; height: number }>> {
    const known = new Map(
      (await this.rows<{ name: string; width: number | string; height: number | string }>('SELECT name, width, height FROM media_sizes')).map((r) => [r.name, { width: Number(r.width), height: Number(r.height) }]),
    );
    for (const { name } of await this.rows<{ name: string }>('SELECT name FROM media')) {
      if (known.has(name)) continue;
      const file = await this.mediaFile(name);
      if (file) known.set(name, await this.recordSize(name, file.bytes));
    }
    return known;
  }

  /** The widths of each picture's smaller copies, by the picture's name. */
  private async variantWidths(): Promise<Map<string, { name: string; width: number }[]>> {
    const all = new Map<string, { name: string; width: number }[]>();
    for (const row of await this.rows<{ name: string; original: string; width: number | string }>('SELECT name, original, width FROM media_variants ORDER BY width')) {
      all.set(row.original, [...(all.get(row.original) ?? []), { name: row.name, width: Number(row.width) }]);
    }
    return all;
  }

  /** Every stored image, newest first. */
  async media(): Promise<MediaItem[]> {
    const sizes = await this.sizes();
    const variants = await this.variantWidths();
    return (await this.rows<{ name: string; label: string; size: number | string }>('SELECT name, label, size FROM media ORDER BY created_at DESC, name')).map((row) => ({
      name: row.name,
      label: row.label,
      size: Number(row.size),
      path: mediaPath(row.name),
      type: MEDIA_TYPES[row.name.split('.').pop() as MediaExt],
      width: sizes.get(row.name)?.width ?? 0,
      height: sizes.get(row.name)?.height ?? 0,
      variants: (variants.get(row.name) ?? []).map((v) => v.width),
    }));
  }

  /** Each picture's size and smaller copies (ADR 0005 d8): what an exported page needs to offer the right one. */
  async mediaSizes(): Promise<Record<string, MediaSize>> {
    const sizes = await this.sizes();
    const variants = await this.variantWidths();
    const all: Record<string, MediaSize> = {};
    for (const [name, size] of sizes) if (size.width > 0) all[name] = { ...size, variants: (variants.get(name) ?? []).map((v) => v.name) };
    return all;
  }

  /**
   * Keeps a smaller copy of a stored picture, made by the browser (ADR 0005
   * d6). What it is, is read from its bytes: a WebP or JPEG at one of the
   * widths that picture wants, drawn in its proportions.
   */
  async addVariant(original: string, bytes: Uint8Array): Promise<MediaItem> {
    const item = (await this.media()).find((m) => m.name === original);
    if (!item) throw new Error('no such image');
    if (!canVary(original) || !item.width) throw new Error('this image keeps one size');
    if (bytes.length > MEDIA_MAX_BYTES) throw new Error('the image is too large');
    const ext = imageExt(bytes);
    const size = imageSize(bytes);
    if ((ext !== 'webp' && ext !== 'jpg') || !size) throw new Error('a smaller copy is a WebP or a JPEG');
    if (!wantedWidths(item.width).includes(size.width)) throw new Error(`a smaller copy of this image is ${wantedWidths(item.width).join(', ')} pixels wide`);
    if (Math.abs(size.height - (item.height * size.width) / item.width) > 2) throw new Error('a smaller copy keeps the proportions of the image');
    await this.run('DELETE FROM media_variants WHERE original = ? AND width = ?', [original, size.width]);
    await this.run(this.dialect.insertNew('media_variants', ['name', 'original', 'width', 'bytes']), [variantName(original, size.width, ext), original, size.width, bytes]);
    return (await this.media()).find((m) => m.name === original) as MediaItem;
  }

  async mediaFile(name: string): Promise<{ type: string; bytes: Uint8Array } | null> {
    const variant = variantOf(name);
    if (variant) {
      const row = await this.row<{ bytes: Uint8Array }>('SELECT bytes FROM media_variants WHERE name = ?', [name]);
      return row ? { type: MEDIA_TYPES[name.split('.').pop() as MediaExt], bytes: new Uint8Array(row.bytes) } : null;
    }
    if (!isMediaName(name)) return null;
    const row = await this.row<{ bytes: Uint8Array }>('SELECT bytes FROM media WHERE name = ?', [name]);
    return row ? { type: MEDIA_TYPES[name.split('.').pop() as MediaExt], bytes: new Uint8Array(row.bytes) } : null;
  }

  /** Where this image is shown: the titles of pages (draft or published), and the header when it is the logo. */
  async mediaUsedBy(name: string): Promise<string[]> {
    const site = await this.site();
    const titles: string[] = mediaNameOf(site.logo?.src ?? '') === name ? ['the header (logo)'] : [];
    for (const row of await this.rows<{ draft: string; published: string | null }>('SELECT draft, published FROM pages ORDER BY position, slug')) {
      const copies = [row.draft, row.published].filter((c): c is string => c !== null).map((c) => normalizePage(JSON.parse(c)).page);
      if (copies.some((page) => imageSources(page.blocks).some((src) => mediaNameOf(src) === name))) titles.push((copies[0] as Page).title);
    }
    const types = new Map(contentTypes(site).map((t) => [t.id, t]));
    for (const row of await this.rows<{ type: string; draft: string; published: string | null }>('SELECT type, draft, published FROM entries ORDER BY type, slug')) {
      const copies = [row.draft, row.published].filter((c): c is string => c !== null).map((c) => normalizePost(JSON.parse(c), undefined, types.get(row.type)).post);
      if (copies.some((post) => postImageSources(post).some((src) => mediaNameOf(src) === name))) titles.push((copies[0] as Post).title);
    }
    for (const type of contentTypes(site)) {
      const copies = [await this.template(type.id), await this.publishedTemplate(type.id)];
      if (copies.some((blocks) => imageSources(blocks ?? []).some((src) => mediaNameOf(src) === name))) titles.push(`the page of "${type.name}"`);
    }
    return titles;
  }

  /** Deletes an image nothing shows. One that a page still shows is refused, with the page named. */
  async deleteMedia(name: string): Promise<void> {
    const used = await this.mediaUsedBy(name);
    if (used.length) throw new Error(`this image is used on: ${used.join(', ')}`);
    await this.run('DELETE FROM media WHERE name = ?', [name]);
    await this.run('DELETE FROM media_sizes WHERE name = ?', [name]);
    await this.run('DELETE FROM media_variants WHERE original = ?', [name]);
  }

  /**
   * Keeps what a visitor sent through a form (ADR 0019), with the words of the
   * consent they ticked, exactly as the page showed them.
   */
  async addMessage(input: { form: string; page: string; name: string; email: string; body: string; consent: string }, at = new Date()): Promise<Message> {
    const message: Message = {
      id: crypto.randomUUID(),
      receivedAt: at.toISOString(),
      form: str(input.form, 60),
      page: str(input.page, 300),
      name: str(input.name, 120).trim(),
      email: str(input.email, 254).trim(),
      body: str(input.body, 5000).trim(),
      consent: str(input.consent, 600).trim(),
    };
    await this.run('INSERT INTO messages (id, received_at, form, page, name, email, body, consent) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
      message.id,
      message.receivedAt,
      message.form,
      message.page,
      message.name,
      message.email,
      message.body,
      message.consent,
    ]);
    this.emit('message.received', { id: message.id, form: message.form, page: message.page, name: message.name, body: message.body });
    return message;
  }

  /** Every message kept, newest first; or those one address sent, for answering a request to see or erase them. */
  async messages(email?: string): Promise<Message[]> {
    const rows = await this.rows<Row>(
      `SELECT id, received_at, form, page, name, email, body, consent FROM messages${email ? ' WHERE LOWER(email) = ?' : ''} ORDER BY received_at DESC, id`,
      email ? [email.trim().toLowerCase()] : [],
    );
    return rows.map((r) => ({
      id: String(r.id),
      receivedAt: String(r.received_at),
      form: String(r.form),
      page: String(r.page),
      name: String(r.name),
      email: String(r.email),
      body: String(r.body),
      consent: String(r.consent),
    }));
  }

  async deleteMessage(id: string): Promise<void> {
    await this.run('DELETE FROM messages WHERE id = ?', [id]);
  }

  /** Erases everything one address sent. Returns how many were erased. */
  async deleteMessagesFrom(email: string): Promise<number> {
    const found = (await this.messages(email)).length;
    await this.run('DELETE FROM messages WHERE LOWER(email) = ?', [email.trim().toLowerCase()]);
    return found;
  }

  /** Deletes what was kept longer than the site keeps messages: messages, and comments nobody approved. */
  async forgetOldMessages(now = new Date()): Promise<void> {
    const days = (await this.site()).keepMessages;
    const before = new Date(now.getTime() - days * 86_400_000).toISOString();
    await this.run('DELETE FROM messages WHERE received_at < ?', [before]);
    await this.run('DELETE FROM comments WHERE approved = 0 AND at < ?', [before]);
  }

  // Comments (ADR 0040).

  /**
   * Keeps a comment, with the consent its writer ticked. It waits for the
   * owner, unless an earlier comment from the same address was approved:
   * someone the owner already let speak is not held each time.
   */
  async addComment(input: { type: string; entry: string; name: string; email: string; body: string; consent: string }, at = new Date()): Promise<Comment> {
    const email = str(input.email, 254).trim();
    const known = await this.row('SELECT 1 AS found FROM comments WHERE LOWER(email) = ? AND approved = 1', [email.toLowerCase()]);
    const comment: Comment = {
      id: crypto.randomUUID(),
      type: str(input.type, 60),
      entry: str(input.entry, 200),
      name: str(input.name, 120).trim(),
      email,
      body: str(input.body, 3000).trim(),
      consent: str(input.consent, 600).trim(),
      at: at.toISOString(),
      approved: known !== null,
    };
    await this.run('INSERT INTO comments (id, type, entry, name, email, body, consent, at, approved) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [
      comment.id,
      comment.type,
      comment.entry,
      comment.name,
      comment.email,
      comment.body,
      comment.consent,
      comment.at,
      comment.approved ? 1 : 0,
    ]);
    this.emit('comment.created', { id: comment.id, type: comment.type, entry: comment.entry, name: comment.name, body: comment.body, approved: comment.approved });
    return comment;
  }

  /** Every comment, those waiting first and then newest first; or those one address sent. */
  async comments(email?: string): Promise<Comment[]> {
    const rows = await this.rows<Row>(
      `SELECT id, type, entry, name, email, body, consent, at, approved FROM comments${email ? ' WHERE LOWER(email) = ?' : ''} ORDER BY approved, at DESC, id`,
      email ? [email.trim().toLowerCase()] : [],
    );
    return rows.map((r) => ({
      id: String(r.id),
      type: String(r.type),
      entry: String(r.entry),
      name: String(r.name),
      email: String(r.email),
      body: String(r.body),
      consent: String(r.consent),
      at: String(r.at),
      approved: Number(r.approved) === 1,
    }));
  }

  async approveComment(id: string): Promise<void> {
    if ((await this.changed('UPDATE comments SET approved = 1 WHERE id = ? AND approved = 0', [id])) !== 1) return;
    const c = (await this.comments()).find((one) => one.id === id);
    if (c) this.emit('comment.approved', { id, type: c.type, entry: c.entry, name: c.name, body: c.body });
  }

  async deleteComment(id: string): Promise<void> {
    await this.run('DELETE FROM comments WHERE id = ?', [id]);
  }

  /** Erases every comment one address sent. Returns how many were erased. */
  async deleteCommentsFrom(email: string): Promise<number> {
    const found = (await this.comments(email)).length;
    await this.run('DELETE FROM comments WHERE LOWER(email) = ?', [email.trim().toLowerCase()]);
    return found;
  }

  /** What the site shows: the approved comments of each entry, by `type/entry`, oldest first, without their addresses. */
  async shownComments(): Promise<Record<string, ShownComment[]>> {
    const rows = await this.rows<Row>('SELECT id, type, entry, name, body, at FROM comments WHERE approved = 1 ORDER BY at, id');
    const out: Record<string, ShownComment[]> = {};
    for (const r of rows) (out[`${String(r.type)}/${String(r.entry)}`] ??= []).push({ id: String(r.id), name: String(r.name), body: String(r.body), at: String(r.at) });
    return out;
  }

  /** Runs a query as it is written, for a test that needs to put a row in a state the store never would. */
  // Accounts (ADR 0022).

  async users(): Promise<User[]> {
    const rows = await this.rows<Row>('SELECT id, email, name, role, password, created_at FROM users ORDER BY created_at, email');
    return rows.map((r) => ({ id: String(r.id), email: String(r.email), name: String(r.name), role: r.role === 'owner' ? 'owner' : 'editor', active: String(r.password) !== '', createdAt: String(r.created_at) }));
  }

  async user(id: string): Promise<User | null> {
    return (await this.users()).find((u) => u.id === id) ?? null;
  }

  /** Someone new. Without a password they are invited, and choose one through their link. */
  async addUser(input: { email: string; name?: string; role: Role; password?: string }): Promise<User> {
    const email = cleanEmail(input.email);
    if (!email) throw new Error('that is not an email address');
    if ((await this.users()).some((u) => u.email === email)) throw new Error('someone with this address already has an account');
    const id = crypto.randomUUID();
    const password = input.password === undefined ? '' : await this.hashPassword(input.password);
    await this.run('INSERT INTO users (id, email, name, role, password, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
      id,
      email,
      str(input.name ?? '', 120).trim(),
      input.role === 'owner' ? 'owner' : 'editor',
      password,
      new Date().toISOString(),
    ]);
    return (await this.user(id)) as User;
  }

  private async hashPassword(password: string): Promise<string> {
    const problem = passwordProblem(password);
    if (problem) throw new Error(problem);
    return Bun.password.hash(password, { algorithm: 'argon2id' });
  }

  /** Sets someone's password and name, and signs them out everywhere else. */
  async setPassword(id: string, password: string, name?: string): Promise<void> {
    const hash = await this.hashPassword(password);
    if (name !== undefined) await this.run('UPDATE users SET password = ?, name = ? WHERE id = ?', [hash, str(name, 120).trim(), id]);
    else await this.run('UPDATE users SET password = ? WHERE id = ?', [hash, id]);
    await this.run('DELETE FROM sessions WHERE user_id = ?', [id]);
  }

  /** The person this address and password belong to, or null. It takes as long either way. */
  async checkPassword(email: string, password: string): Promise<User | null> {
    const row = await this.row<Row>('SELECT id, password FROM users WHERE email = ?', [email.trim().toLowerCase()]);
    const hash = row && String(row.password) ? String(row.password) : await (decoy ??= Bun.password.hash(newSecret(), { algorithm: 'argon2id' }));
    const right = password.length <= PASSWORD_MAX && (await Bun.password.verify(password, hash));
    return right && row && String(row.password) ? this.user(String(row.id)) : null;
  }

  /** Changes what someone may do. The site always keeps an owner. */
  async setRole(id: string, role: Role): Promise<void> {
    const users = await this.users();
    if (role !== 'owner' && users.filter((u) => u.role === 'owner' && u.active && u.id !== id).length === 0) throw new Error('the site needs an owner');
    await this.run('UPDATE users SET role = ? WHERE id = ?', [role === 'owner' ? 'owner' : 'editor', id]);
  }

  /** Removes someone, with their sessions and links. The last owner stays. */
  async removeUser(id: string): Promise<void> {
    const users = await this.users();
    if (users.find((u) => u.id === id)?.role === 'owner' && users.filter((u) => u.role === 'owner' && u.active && u.id !== id).length === 0) throw new Error('the site needs an owner');
    await this.run('DELETE FROM sessions WHERE user_id = ?', [id]);
    await this.run('DELETE FROM links WHERE user_id = ?', [id]);
    await this.run('DELETE FROM users WHERE id = ?', [id]);
  }

  /** A new session: the secret goes in the person's cookie, its hash stays here. */
  async startSession(userId: string, now = new Date()): Promise<string> {
    const secret = newSecret();
    await this.run('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)', [hashOf(secret), userId, new Date(now.getTime() + SESSION_DAYS * 86_400_000).toISOString()]);
    return secret;
  }

  /** Who a session's secret signs in, while it has not run out. */
  async sessionUser(secret: string, now = new Date()): Promise<User | null> {
    if (!secret) return null;
    const row = await this.row<Row>('SELECT user_id, expires_at FROM sessions WHERE id = ?', [hashOf(secret)]);
    if (!row) return null;
    if (String(row.expires_at) <= now.toISOString()) {
      await this.endSession(secret);
      return null;
    }
    const user = await this.user(String(row.user_id));
    return user?.active ? user : null;
  }

  async endSession(secret: string): Promise<void> {
    await this.run('DELETE FROM sessions WHERE id = ?', [hashOf(secret)]);
  }

  /** A link that works once, for a while. A new link of the same kind for the same person replaces the old one. */
  async makeLink(kind: LinkKind, userId: string, hours: number, now = new Date()): Promise<string> {
    const secret = newSecret();
    await this.run('DELETE FROM links WHERE kind = ? AND user_id = ?', [kind, userId]);
    await this.run('DELETE FROM links WHERE expires_at <= ?', [now.toISOString()]);
    await this.run('INSERT INTO links (id, kind, user_id, expires_at) VALUES (?, ?, ?, ?)', [hashOf(secret), kind, userId, new Date(now.getTime() + hours * 3_600_000).toISOString()]);
    return secret;
  }

  /** What a link is for, while it works. `use` spends it. */
  async link(secret: string, use = false, now = new Date()): Promise<{ kind: LinkKind; user: User | null } | null> {
    if (!secret) return null;
    const row = await this.row<Row>('SELECT kind, user_id, expires_at FROM links WHERE id = ?', [hashOf(secret)]);
    if (!row || String(row.expires_at) <= now.toISOString()) return null;
    // Spent by whoever deletes it: of two requests with the same link, one gets nothing.
    if (use && (await this.changed('DELETE FROM links WHERE id = ?', [hashOf(secret)])) !== 1) return null;
    const kind = String(row.kind) as LinkKind;
    return { kind, user: kind === 'setup' ? null : await this.user(String(row.user_id)) };
  }

  /** The extensions installed (ADR 0026), each with the package it was installed from. */
  async extensions(): Promise<InstalledExtension[]> {
    const rows = await this.rows<{ name: string; sha256: string; package: string; enabled: number | string; installed_at: string }>('SELECT name, sha256, package, enabled, installed_at FROM extensions ORDER BY name');
    return rows.flatMap((row) => {
      const { pkg } = parseExtension(JSON.parse(row.package));
      return pkg ? [{ ...pkg, sha256: row.sha256, enabled: Number(row.enabled) === 1, installedAt: row.installed_at }] : [];
    });
  }

  async extension(name: string): Promise<InstalledExtension | null> {
    return (await this.extensions()).find((e) => e.manifest.name === name) ?? null;
  }

  /**
   * Installs a package, or a new version of one. Its rows stay; a collection
   * the new version no longer declares keeps its rows until it is uninstalled.
   */
  async installExtension(raw: unknown, sha256: string, at = new Date()): Promise<InstalledExtension> {
    const { pkg, problems } = parseExtension(raw);
    if (!pkg) throw new Error(problems.join('; '));
    const before = await this.extension(pkg.manifest.name);
    await this.run(this.dialect.upsert('extensions', ['name', 'version', 'sha256', 'package', 'enabled', 'installed_at'], ['name'], ['version', 'sha256', 'package', 'installed_at']), [
      pkg.manifest.name,
      pkg.manifest.version,
      sha256,
      JSON.stringify(raw),
      before ? (before.enabled ? 1 : 0) : 1,
      at.toISOString(),
    ]);
    return (await this.extension(pkg.manifest.name)) as InstalledExtension;
  }

  async enableExtension(name: string, enabled: boolean): Promise<void> {
    if (!(await this.changed('UPDATE extensions SET enabled = ? WHERE name = ?', [enabled ? 1 : 0, name]))) throw new Error(`no extension "${name}" is installed`);
  }

  /** Removes an extension and everything it kept. */
  async uninstallExtension(name: string): Promise<void> {
    await this.sql.begin(async (tx) => {
      await tx.unsafe(this.dialect.params('DELETE FROM extension_rows WHERE extension = ?'), [name]);
      await tx.unsafe(this.dialect.params('DELETE FROM extensions WHERE name = ?'), [name]);
      await tx.unsafe(this.dialect.params('DELETE FROM extension_jobs WHERE extension = ?'), [name]);
    });
  }

  /**
   * Claims one run of an extension's job (ADR 0041): true when it is due, and
   * this process is the one that marked it run. Two clocks on one database
   * never both run it: the row says which one changed it.
   */
  async claimJob(extension: string, action: string, everyMinutes: number, now = new Date()): Promise<boolean> {
    const at = now.toISOString();
    const last = await this.row<{ last_at: string }>('SELECT last_at FROM extension_jobs WHERE extension = ? AND action = ?', [extension, action]);
    if (!last) return (await this.changed(this.dialect.insertNew('extension_jobs', ['extension', 'action', 'last_at']), [extension, action, at])) === 1;
    if (now.getTime() - Date.parse(last.last_at) < everyMinutes * 60_000) return false;
    return (await this.changed('UPDATE extension_jobs SET last_at = ? WHERE extension = ? AND action = ? AND last_at = ?', [at, extension, action, last.last_at])) === 1;
  }

  /** The rows of one of an extension's collections, oldest first. */
  async extensionRows(extension: string, collection: string): Promise<ExtensionRow[]> {
    const rows = await this.rows<{ id: string; data: string; updated_at: string }>('SELECT id, data, updated_at FROM extension_rows WHERE extension = ? AND collection = ? ORDER BY id', [extension, collection]);
    return rows.map((row) => ({ ...(JSON.parse(row.data) as Record<string, unknown>), id: row.id }));
  }

  async extensionRow(extension: string, collection: string, id: string): Promise<ExtensionRow | null> {
    const row = await this.row<{ data: string }>('SELECT data FROM extension_rows WHERE extension = ? AND collection = ? AND id = ?', [extension, collection, id]);
    return row ? { ...(JSON.parse(row.data) as Record<string, unknown>), id } : null;
  }

  /** Keeps a row, already cleaned by its collection's fields. A new one gets an id that sorts after the ones before it. */
  async saveExtensionRow(extension: string, collection: string, data: Record<string, unknown>, id: string | null = null, at = new Date()): Promise<ExtensionRow> {
    const key = id ?? `${at.getTime().toString(36).padStart(9, '0')}${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
    if (id !== null && !(await this.extensionRow(extension, collection, id))) throw new Error('no such row');
    const { id: _ignored, ...rest } = data;
    await this.run(this.dialect.upsert('extension_rows', ['extension', 'collection', 'id', 'data', 'updated_at'], ['extension', 'collection', 'id'], ['data', 'updated_at']), [extension, collection, key, JSON.stringify(rest), at.toISOString()]);
    return { ...rest, id: key };
  }

  async deleteExtensionRow(extension: string, collection: string, id: string): Promise<void> {
    await this.run('DELETE FROM extension_rows WHERE extension = ? AND collection = ? AND id = ?', [extension, collection, id]);
  }

  async rawForTests(query: string, params: unknown[] = []): Promise<void> {
    await this.run(query, params);
  }
}

/** A translation made as a copy (ADR 0024), as the page's translation (ADR 0032 d7). */
function copyAsTranslation(page: Page, copy: Page): PageTranslation {
  const { fields, problem } = wordsFrom(page.blocks, copy.blocks);
  return {
    slug: '',
    title: copy.title === page.title ? '' : copy.title,
    description: copy.description === page.description ? '' : copy.description,
    fields: problem ? {} : fields,
    blocks: problem ? copy.blocks : null,
  };
}
