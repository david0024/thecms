/**
 * The site's content in one open file (ADR 0057 d1): what WordPress gives
 * from Tools → Export, and what another Uhlaka site takes back in from its
 * import screen. A backup (ADR 0051) puts a whole site back as it was; this
 * moves content between sites, so it holds the content and never the people
 * who sign in, their passwords, the messages visitors sent or the counts.
 * The visitors are a part of their own, chosen apart from the whole site
 * (ADR 0064 d6), and even then without anything to sign in with.
 */
import { type Audience, type ContentType, type Form, type Layout, type Level, mediaNameOf, type Redirect, type Site, slugify, type Theme } from '../core/index.ts';
import type { Store } from './store.ts';
import { normalizeVisitorSettings } from './visitor-gate.ts';
import type { ContentVisitor } from './visitor-transfer.ts';
import { VERSION } from './version.ts';

export const CONTENT_FORMAT = 'uhlaka.content/1';
export const CONTENT_SUFFIX = '.uhlaka.json';

/** A page, a section or an entry, as kept: what is being written and what visitors see. */
export interface ContentDoc {
  slug: string;
  draft: unknown;
  /** Null: never published. */
  published: unknown;
  /** Set to be published at this time (ADR 0039). */
  scheduled?: string;
  /** Behind a password on the site it came from (ADR 0043). The password is never in the file. */
  locked?: true;
  /** Who sees it on the site it came from (ADR 0064 d4): visitors signed in, or members of some levels. Absent: everyone. */
  audience?: Audience;
  /** Who wrote it: a key into `people`. */
  author?: string;
}

/** Someone who wrote entries, as the site shows them (ADR 0055 d3): never an account, never a password. */
export interface ContentPerson {
  key: string;
  email: string;
  name: string;
  bio: string;
  picture: string;
}

/** A comment the site showed (ADR 0040), without the address it was sent from. */
export interface ContentComment {
  type: string;
  entry: string;
  name: string;
  body: string;
  at: string;
  language?: string;
}

export interface ContentMedia {
  name: string;
  label: string;
  /** The words a picture is offered with (ADR 0072 d3); left out when it has none. */
  alt?: string;
  /** The file's bytes, in base64. */
  data: string;
  /** The picture's smaller copies (ADR 0005 d8), in base64. */
  variants: string[];
}

export interface TypePart {
  type: ContentType;
  /** The type's own page (ADR 0015); null: the default one. */
  template: { draft: unknown; published: unknown };
  /** Who sees the whole type and each of its entries (ADR 0064 d4). Absent: everyone. */
  audience?: Audience;
  entries: ContentDoc[];
}

export interface ContentFile {
  format: typeof CONTENT_FORMAT;
  /** The program that wrote it, and when. */
  program: string;
  madeAt: string;
  /** What was asked for (`pages`, `sections`, `forms`, `design`, `type:<id>`, `visitors`). */
  parts: string[];
  /** Which site it came from, to be shown before it is brought in. */
  from: { name: string; url: string; language: string; languages: string[] };
  /** The site's layouts (ADR 0035), always: a page or a type names one. Absent: the ready ones. */
  layouts?: Layout[];
  /** With `design`: the site's settings, menu included, its theme and its old addresses. */
  settings?: Site;
  theme?: { draft: Theme | null; published: Theme | null };
  redirects?: Redirect[];
  pages?: ContentDoc[];
  sections?: ContentDoc[];
  forms?: Form[];
  /** The member levels (ADR 0064 d3), when who sees something or a visitor names one. */
  levels?: Level[];
  /** With `visitors`: each visitor whose address was confirmed, without a password (ADR 0064 d6). */
  visitors?: ContentVisitor[];
  types: TypePart[];
  people: ContentPerson[];
  comments: ContentComment[];
  media: ContentMedia[];
}

/** The part of the people who sign in: never in the whole site, only when chosen by itself (ADR 0064 d6). */
export const VISITORS_PART = 'visitors';

/**
 * Every part a site has, in the order the admin offers them. The visitors
 * are offered once the site has had accounts, `apart` from the whole site.
 */
export async function contentParts(store: Store): Promise<{ id: string; name: string; apart?: true }[]> {
  const site = await store.site();
  const accounts = normalizeVisitorSettings(await store.visitorSettings()).on || (await store.hasTable('visitors'));
  return [
    { id: 'pages', name: 'pages' },
    ...site.types.map((t) => ({ id: `type:${t.id}`, name: t.name })),
    { id: 'sections', name: 'sections' },
    { id: 'forms', name: 'forms' },
    { id: 'design', name: 'design' },
    ...(accounts ? [{ id: VISITORS_PART, name: 'visitors', apart: true as const }] : []),
  ];
}

/** Every `/media/…` a value names, anywhere inside it. */
function mediaIn(value: unknown, into: Set<string>): Set<string> {
  if (typeof value === 'string') {
    const name = mediaNameOf(value);
    if (name) into.add(name);
  } else if (Array.isArray(value)) for (const inner of value) mediaIn(inner, into);
  else if (value && typeof value === 'object') for (const inner of Object.values(value)) mediaIn(inner, into);
  return into;
}

const base64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');

/**
 * The content file for the parts asked for; every part of the content when
 * none is named, and the visitors only when they are named. The whole site
 * carries its whole media library; a part carries only the files it shows
 * or links to.
 */
export async function exportContent(store: Store, asked: string[] = [], now = new Date()): Promise<ContentFile> {
  const offered = await contentParts(store);
  const all = offered.filter((p) => !p.apart).map((p) => p.id);
  const parts = asked.length ? offered.map((p) => p.id).filter((id) => asked.includes(id)) : all;
  if (parts.length === 0) throw new Error(`choose what to export: ${offered.map((p) => p.id).join(', ')}`);
  const whole = all.every((id) => parts.includes(id));
  const site = await store.site();
  const scheduled = new Map((await store.scheduled()).map((s) => [`${s.kind}/${s.slug}`, s.at]));
  const locked = new Set(await store.lockedPages());
  const audiences = await store.audiences();
  const audienceOf = (kind: string, slug: string): Audience | undefined => (kind === 'page' ? audiences.pages[slug] : kind === 'section' ? undefined : audiences.entries[`${kind}/${slug}`]);
  const doc = (kind: string, row: { slug: string; draft: unknown; published: unknown }): ContentDoc => {
    const audience = audienceOf(kind, row.slug);
    return {
      slug: row.slug,
      draft: row.draft,
      published: row.published,
      ...(scheduled.has(`${kind}/${row.slug}`) ? { scheduled: scheduled.get(`${kind}/${row.slug}`) as string } : {}),
      ...(kind === 'page' && locked.has(row.slug) ? { locked: true as const } : {}),
      ...(audience ? { audience } : {}),
    };
  };

  const file: ContentFile = {
    format: CONTENT_FORMAT,
    program: `uhlaka ${VERSION}`,
    madeAt: now.toISOString(),
    parts,
    from: { name: site.name, url: site.url, language: site.language, languages: site.languages },
    ...(site.layouts ? { layouts: site.layouts } : {}),
    types: [],
    people: [],
    comments: [],
    media: [],
  };
  if (parts.includes('design')) {
    file.settings = site;
    file.theme = { draft: await store.theme(), published: await store.publishedTheme() };
    file.redirects = await store.redirects();
  }
  if (parts.includes('pages')) file.pages = (await store.documents('pages')).map((row) => doc('page', row));
  if (parts.includes('sections')) file.sections = (await store.documents('sections')).map((row) => doc('section', row));
  if (parts.includes('forms')) file.forms = await store.forms();

  const chosen = site.types.filter((t) => parts.includes(`type:${t.id}`));
  if (chosen.length) {
    const authors = await store.entryAuthors();
    const users = new Map((await store.users()).map((u) => [u.id, u]));
    const people = new Map<string, ContentPerson>();
    const entries = await store.documents('entries');
    for (const type of chosen) {
      const own = entries.filter((row) => row.type === type.id).map((row) => {
        const one = doc(type.id, row);
        const who = users.get(authors.get(`${type.id}/${row.slug}`) ?? '');
        if (who) {
          people.set(who.id, { key: who.id, email: who.email, name: who.name, bio: who.bio ?? '', picture: who.picture ?? '' });
          one.author = who.id;
        }
        return one;
      });
      const audience = audiences.types[type.id];
      file.types.push({ type, template: { draft: await store.template(type.id), published: await store.publishedTemplate(type.id) }, ...(audience ? { audience } : {}), entries: own });
    }
    file.people = [...people.values()];
    const ids = new Set(chosen.map((t) => t.id));
    file.comments = (await store.comments())
      .filter((c) => c.approved && ids.has(c.type))
      .sort((a, b) => (a.at === b.at ? a.id.localeCompare(b.id) : a.at < b.at ? -1 : 1))
      .map((c) => ({ type: c.type, entry: c.entry, name: c.name, body: c.body, at: c.at, ...(c.language ? { language: c.language } : {}) }));
  }

  // The visitors, only when chosen by themselves; and the levels, when who sees something or a visitor names one.
  if (parts.includes(VISITORS_PART)) file.visitors = await (await import('./visitor-transfer.ts')).exportVisitors(store);
  const { levels } = normalizeVisitorSettings(await store.visitorSettings());
  const audienced = [...(file.pages ?? []), ...file.types.flatMap((t) => t.entries)].some((d) => d.audience) || file.types.some((t) => t.audience);
  if (levels.length && (audienced || file.visitors)) file.levels = levels;

  // The files themselves, last: those the parts name, or the whole library with the whole site.
  const library = await store.media();
  const wanted = whole ? new Set(library.map((m) => m.name)) : mediaIn(file, new Set());
  const sizes = await store.mediaSizes();
  for (const item of library) {
    if (!wanted.has(item.name)) continue;
    const kept = await store.mediaFile(item.name);
    if (!kept) continue;
    const variants: string[] = [];
    for (const name of sizes[item.name]?.variants ?? []) {
      const copy = await store.mediaFile(name);
      if (copy) variants.push(base64(copy.bytes));
    }
    file.media.push({ name: item.name, label: item.label, ...(item.alt ? { alt: item.alt } : {}), data: base64(kept.bytes), variants });
  }
  return file;
}

/** The file's name: the site's, and the day. */
export const contentFileName = (site: Pick<Site, 'name'>, now = new Date()): string =>
  `${slugify(site.name).slice(0, 40).replace(/-+$/, '') || 'site'}-${now.toISOString().slice(0, 10)}${CONTENT_SUFFIX}`;
