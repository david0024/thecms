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
  imageExt,
  imageSources,
  isMediaName,
  MEDIA_MAX_BYTES,
  MEDIA_TYPES,
  type MediaExt,
  mediaNameOf,
  mediaPath,
  normalizePage,
  normalizePost,
  normalizeRedirects,
  normalizeSite,
  type Page,
  type Post,
  parseTheme,
  postImageSources,
  type Redirect,
  POSTS_TYPE,
  contentTypes,
  reservedSlugs,
  typeById,
  type ContentType,
  listed,
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
    'CREATE TABLE IF NOT EXISTS entries (type TEXT NOT NULL, slug TEXT NOT NULL, draft TEXT NOT NULL, published TEXT, published_at TEXT, updated_at TEXT NOT NULL, PRIMARY KEY (type, slug))',
    'CREATE TABLE IF NOT EXISTS media (name TEXT PRIMARY KEY, label TEXT NOT NULL, size INTEGER NOT NULL, bytes BLOB NOT NULL, created_at TEXT NOT NULL)',
    'CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, received_at TEXT NOT NULL, form TEXT NOT NULL, page TEXT NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL, body TEXT NOT NULL, consent TEXT NOT NULL)',
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
    'CREATE TABLE IF NOT EXISTS entries (type VARCHAR(255) NOT NULL, slug VARCHAR(255) NOT NULL, draft TEXT NOT NULL, published TEXT, published_at VARCHAR(40), updated_at VARCHAR(40) NOT NULL, PRIMARY KEY (type, slug))',
    'CREATE TABLE IF NOT EXISTS media (name VARCHAR(255) PRIMARY KEY, label TEXT NOT NULL, size INTEGER NOT NULL, bytes BYTEA NOT NULL, created_at VARCHAR(40) NOT NULL)',
    'CREATE TABLE IF NOT EXISTS messages (id VARCHAR(40) PRIMARY KEY, received_at VARCHAR(40) NOT NULL, form VARCHAR(255) NOT NULL, page TEXT NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL, body TEXT NOT NULL, consent TEXT NOT NULL)',
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
    `CREATE TABLE IF NOT EXISTS entries (type VARCHAR(255) NOT NULL, slug VARCHAR(255) NOT NULL, draft LONGTEXT NOT NULL, published LONGTEXT, published_at VARCHAR(40), updated_at VARCHAR(40) NOT NULL, PRIMARY KEY (type, slug)) ${MYSQL_TABLE}`,
    `CREATE TABLE IF NOT EXISTS media (name VARCHAR(255) PRIMARY KEY, label TEXT NOT NULL, size INTEGER NOT NULL, bytes LONGBLOB NOT NULL, created_at VARCHAR(40) NOT NULL) ${MYSQL_TABLE}`,
    `CREATE TABLE IF NOT EXISTS messages (id VARCHAR(40) PRIMARY KEY, received_at VARCHAR(40) NOT NULL, form VARCHAR(255) NOT NULL, page TEXT NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL, body TEXT NOT NULL, consent TEXT NOT NULL) ${MYSQL_TABLE}`,
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

/** A type's page is cleaned as a page's blocks are: the same rules, the same limits. */
const cleanTemplate = (blocks: unknown[]): Block[] => normalizePage({ slug: '', title: 'template', blocks }).page.blocks;

export class Store {
  readonly kind: DatabaseKind;
  private readonly dialect: Dialect;

  private constructor(private readonly sql: SQL, kind: DatabaseKind) {
    this.kind = kind;
    this.dialect = DIALECTS[kind];
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
    const kept = new Set([POSTS_TYPE, ...site.types.map((t) => t.id)]);
    const orphans = (await this.rows<{ type: string; n: number | string }>('SELECT type, COUNT(*) AS n FROM entries GROUP BY type')).filter((row) => !kept.has(row.type));
    const first = orphans[0];
    if (first) {
      const n = Number(first.n);
      const gone = (await this.site()).types.find((t) => t.id === first.type);
      throw new Error(`"${gone?.name ?? first.type}" still has ${n === 1 ? '1 entry' : `${n} entries`}; delete what it holds before removing the content type`);
    }
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
    if (reservedSlugs(await this.site()).includes(page.slug)) throw new Error(`the address "/${page.slug}/" is used by the site itself; choose another`);
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
  async publish(slug: string): Promise<void> {
    // Asked before, not counted after: MySQL counts a row that already held these values as unchanged.
    if (!(await this.row('SELECT 1 AS found FROM pages WHERE slug = ?', [slug]))) throw new Error(`no page "${slug}"`);
    await this.run('UPDATE pages SET published = draft, published_at = ? WHERE slug = ?', [new Date().toISOString(), slug]);
  }

  async draft(slug: string): Promise<Page | null> {
    const row = await this.row<{ draft: string }>('SELECT draft FROM pages WHERE slug = ?', [slug]);
    return row ? normalizePage(JSON.parse(row.draft)).page : null;
  }

  /** Every page, in menu order, with whether its draft differs from what is published. */
  async pages(): Promise<{ slug: string; title: string; inMenu: boolean; published: boolean; changed: boolean }[]> {
    return (await this.rows<{ slug: string; draft: string; published: string | null }>('SELECT slug, draft, published FROM pages ORDER BY position, slug')).map((row) => {
      const { title, inMenu } = normalizePage(JSON.parse(row.draft)).page;
      return { slug: row.slug, title, inMenu, published: row.published !== null, changed: row.published !== row.draft };
    });
  }

  async deletePage(slug: string): Promise<void> {
    if (slug === '') throw new Error('the home page cannot be deleted');
    await this.run('DELETE FROM pages WHERE slug = ?', [slug]);
  }

  /** Every published page, in menu order. */
  async published(): Promise<Page[]> {
    return (await this.rows<{ published: string }>('SELECT published FROM pages WHERE published IS NOT NULL ORDER BY position, slug')).map(
      (row) => normalizePage(JSON.parse(row.published)).page,
    );
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

  async publishEntry(typeId: string, slug: string): Promise<void> {
    if (!(await this.row('SELECT 1 AS found FROM entries WHERE type = ? AND slug = ?', [typeId, slug]))) throw new Error(`no entry "${slug}"`);
    await this.run('UPDATE entries SET published = draft, published_at = ? WHERE type = ? AND slug = ?', [new Date().toISOString(), typeId, slug]);
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
    return (await this.media()).find((m) => m.name === name) as MediaItem;
  }

  /** Every stored image, newest first. */
  async media(): Promise<MediaItem[]> {
    return (await this.rows<{ name: string; label: string; size: number | string }>('SELECT name, label, size FROM media ORDER BY created_at DESC, name')).map((row) => ({
      name: row.name,
      label: row.label,
      size: Number(row.size),
      path: mediaPath(row.name),
      type: MEDIA_TYPES[row.name.split('.').pop() as MediaExt],
    }));
  }

  async mediaFile(name: string): Promise<{ type: string; bytes: Uint8Array } | null> {
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

  /** Deletes what was kept longer than the site keeps messages. */
  async forgetOldMessages(now = new Date()): Promise<void> {
    const days = (await this.site()).keepMessages;
    await this.run('DELETE FROM messages WHERE received_at < ?', [new Date(now.getTime() - days * 86_400_000).toISOString()]);
  }

  /** Runs a query as it is written, for a test that needs to put a row in a state the store never would. */
  async rawForTests(query: string, params: unknown[] = []): Promise<void> {
    await this.run(query, params);
  }
}
