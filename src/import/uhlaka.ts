/**
 * A Uhlaka content file brought back in (ADR 0057 d2), from the same screen
 * and with the same rules as a WordPress export (ADR 0009, ADR 0012): read
 * and shown first, then written; nothing already in the site is replaced,
 * and what was left as it was is said.
 */
import { type Audience, fromOldName, isObject, OLD_NAME, normalizeAudience, normalizeLevels, normalizeTypes, POSTS_TYPE, READY_LAYOUTS, reservedSlugs, type ContentType, type Layout, type Site } from '../core/index.ts';
import { CONTENT_FORMAT, type ContentDoc, type ContentFile } from '../site/transfer.ts';
import { cleanEmail, type Store } from '../site/store.ts';
import { normalizeVisitorSettings } from '../site/visitor-gate.ts';
import type { ContentVisitor } from '../site/visitor-transfer.ts';
import type { ImportReport } from './run.ts';

/** Whether a file's text is a Uhlaka content file rather than a WordPress export. */
export const isContentFile = (text: string): boolean => /^\s*\{/.test(text) && (text.includes(CONTENT_FORMAT) || text.includes(`${OLD_NAME}.content/1`));

const list = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);
/** Who sees it; a file of before the levels went in the file said only that it was for members, which is kept as "signed in". */
const audienceOf = (d: Record<string, unknown>): { audience: Audience } | Record<string, never> => {
  const audience = normalizeAudience(d.audience) ?? (d.members === true ? { who: 'signed' as const } : null);
  return audience ? { audience } : {};
};
const visitors = (value: unknown): ContentVisitor[] =>
  list<unknown>(value)
    .filter(isObject)
    .filter((v) => typeof v.email === 'string')
    .map((v) => ({
      email: String(v.email),
      name: String(v.name ?? ''),
      language: String(v.language ?? ''),
      createdAt: String(v.createdAt ?? ''),
      confirmedAt: String(v.confirmedAt ?? ''),
      levels: list<unknown>(v.levels).filter((l): l is string => typeof l === 'string'),
    }));
const docs = (value: unknown): ContentDoc[] =>
  list<unknown>(value)
    .filter(isObject)
    .filter((d) => typeof d.slug === 'string' && isObject(d.draft))
    .map((d) => ({
      slug: d.slug as string,
      draft: d.draft,
      published: isObject(d.published) ? d.published : null,
      ...(typeof d.scheduled === 'string' ? { scheduled: d.scheduled } : {}),
      ...(d.locked === true ? { locked: true as const } : {}),
      ...audienceOf(d),
      ...(typeof d.author === 'string' ? { author: d.author } : {}),
    }));

/** The file read, checked for its shape. Throws, with a reason a person can read, when it is not one. */
export function readContentFile(text: string): ContentFile {
  let raw: unknown;
  try {
    // A file made before the rename is read as it would be written now (ADR 0066).
    raw = fromOldName(JSON.parse(text));
  } catch {
    throw new Error('this file is not a Uhlaka content export: it is not JSON that can be read');
  }
  if (!isObject(raw) || raw.format !== CONTENT_FORMAT) throw new Error(`this file is not a Uhlaka content export (${CONTENT_FORMAT})`);
  const from = isObject(raw.from) ? raw.from : {};
  return {
    format: CONTENT_FORMAT,
    program: String(raw.program ?? ''),
    madeAt: String(raw.madeAt ?? ''),
    parts: list<unknown>(raw.parts).map(String),
    from: { name: String(from.name ?? ''), url: String(from.url ?? ''), language: String(from.language ?? ''), languages: list<unknown>(from.languages).map(String) },
    ...(Array.isArray(raw.layouts) ? { layouts: raw.layouts as Layout[] } : {}),
    ...(isObject(raw.settings) ? { settings: raw.settings as unknown as Site } : {}),
    ...(isObject(raw.theme) ? { theme: { draft: isObject(raw.theme.draft) ? raw.theme.draft : null, published: isObject(raw.theme.published) ? raw.theme.published : null } as ContentFile['theme'] } : {}),
    ...(Array.isArray(raw.redirects) ? { redirects: raw.redirects } : {}),
    ...(Array.isArray(raw.pages) ? { pages: docs(raw.pages) } : {}),
    ...(Array.isArray(raw.sections) ? { sections: docs(raw.sections) } : {}),
    ...(Array.isArray(raw.forms) ? { forms: raw.forms } : {}),
    ...(Array.isArray(raw.levels) ? { levels: normalizeLevels(raw.levels) } : {}),
    ...(Array.isArray(raw.visitors) ? { visitors: visitors(raw.visitors) } : {}),
    types: list<unknown>(raw.types)
      .filter(isObject)
      .flatMap((t) => {
        const type = normalizeTypes([t.type])[0];
        const template = isObject(t.template) ? t.template : {};
        return type ? [{ type, template: { draft: Array.isArray(template.draft) ? template.draft : null, published: Array.isArray(template.published) ? template.published : null }, ...audienceOf(t), entries: docs(t.entries) }] : [];
      }),
    people: list<unknown>(raw.people)
      .filter(isObject)
      .map((p) => ({ key: String(p.key ?? ''), email: String(p.email ?? ''), name: String(p.name ?? ''), bio: String(p.bio ?? ''), picture: String(p.picture ?? '') })),
    comments: list<unknown>(raw.comments)
      .filter(isObject)
      .map((c) => ({ type: String(c.type ?? ''), entry: String(c.entry ?? ''), name: String(c.name ?? ''), body: String(c.body ?? ''), at: String(c.at ?? ''), ...(typeof c.language === 'string' ? { language: c.language } : {}) })),
    media: list<unknown>(raw.media)
      .filter(isObject)
      .filter((m) => typeof m.data === 'string')
      .map((m) => ({ name: String(m.name ?? ''), label: String(m.label ?? ''), data: m.data as string, variants: list<unknown>(m.variants).filter((v): v is string => typeof v === 'string') })),
  };
}

/** What a content file would bring, counted, in the shape the import screen shows for a WordPress export. */
export function contentPreview(file: ContentFile) {
  const posts = file.types.find((t) => t.type.id === POSTS_TYPE)?.entries.length ?? 0;
  const notes: string[] = [`A Uhlaka content export of "${file.from.name}", made ${file.madeAt.slice(0, 10)} by ${file.program}.`];
  const locked = (file.pages ?? []).filter((p) => p.locked).length;
  if (locked) notes.push(`${locked === 1 ? 'One page was' : `${locked} pages were`} behind a password there. The password is not in the file, so ${locked === 1 ? 'it comes' : 'they come'} as a draft; give a password again, then publish.`);
  const forMembers = forMembersCount(file);
  if (forMembers) notes.push(`${forMembers === 1 ? 'One page, entry or type is' : `${forMembers} pages, entries or types are`} for visitors signed in or for members, and stay${forMembers === 1 ? 's' : ''} so here: closed to everyone but you while visitor accounts are off.`);
  if (file.visitors?.length)
    notes.push(`${file.visitors.length === 1 ? 'One visitor account' : `${file.visitors.length} visitor accounts`}, without passwords: they come only if visitor accounts are on here, and each visitor chooses a new password with "Forgot your password?". No message is sent.`);
  return {
    kind: 'uhlaka' as const,
    site: { name: file.from.name, url: file.from.url },
    pages: file.pages?.length ?? 0,
    posts,
    types: file.types.filter((t) => t.type.id !== POSTS_TYPE).map((t) => ({ id: t.type.id, name: t.type.name, count: t.entries.length })),
    others: [],
    categories: [],
    images: file.media.length,
    redirects: file.redirects?.length ?? 0,
    menu: !!file.settings,
    sections: file.sections?.length ?? 0,
    forms: file.forms?.length ?? 0,
    notes,
  };
}

/** The pages, entries and types the file keeps for visitors signed in or for members. */
const forMembersCount = (file: ContentFile): number =>
  [...(file.pages ?? []), ...file.types.flatMap((t) => t.entries)].filter((d) => d.audience).length + file.types.filter((t) => t.audience).length;

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Writes what the file holds into the site. `fresh`: take the old site's
 * settings, menu, layouts and theme too, in place of this one's.
 */
export async function runContentImport(store: Store, file: ContentFile, options: { fresh: boolean; onImage?: (done: number, total: number) => void }): Promise<ImportReport> {
  const notes: string[] = [];
  const kept: string[] = [];
  const failed: string[] = [];

  // The files first: each keeps its name, which is made from its bytes.
  let images = 0;
  for (const [i, item] of file.media.entries()) {
    try {
      const stored = await store.addMedia(new Uint8Array(Buffer.from(item.data, 'base64')), item.label);
      images++;
      for (const variant of item.variants) await store.addVariant(stored.name, new Uint8Array(Buffer.from(variant, 'base64'))).catch(() => undefined);
    } catch (error) {
      failed.push(`the file "${item.label || item.name}" (${reason(error)})`);
    }
    options.onImage?.(i + 1, file.media.length);
  }

  // The settings, when asked for: the old site's, with what this one has that the file does not.
  let menu = false;
  if (options.fresh && file.settings) {
    const here = await store.site();
    const types = [...list<ContentType>(file.settings.types), ...here.types.filter((t) => !list<ContentType>(file.settings?.types).some((o) => o.id === t.id))];
    const layouts = [...(file.settings.layouts ?? READY_LAYOUTS)];
    for (const l of here.layouts ?? READY_LAYOUTS) if (!layouts.some((o) => o.id === l.id)) layouts.push(l);
    try {
      await store.setSite({ ...file.settings, types, layouts });
      menu = file.settings.menu !== null;
    } catch (error) {
      notes.push(`The old site's settings were not taken: ${reason(error)}.`);
    }
  } else if (file.settings) notes.push('The site already had its settings, so its name, menu, layouts and theme were left alone.');

  // The layouts a page or a type is drawn in, where this site lacks them.
  const site = await store.site();
  const layouts = [...(site.layouts ?? READY_LAYOUTS)];
  const missing = (file.layouts ?? []).filter((l) => isObject(l) && !layouts.some((o) => o.id === l.id));
  if (missing.length) await store.setSite({ ...site, layouts: [...layouts, ...missing] }).catch((error: unknown) => notes.push(`The layouts were not added: ${reason(error)}.`));

  // The member levels who sees something or a visitor names, where this site lacks them (ADR 0064 d3).
  if (file.levels?.length) {
    const settings = normalizeVisitorSettings(await store.visitorSettings());
    const missing = file.levels.filter((l) => !settings.levels.some((o) => o.id === l.id));
    if (missing.length) {
      const levels = normalizeLevels([...settings.levels, ...missing]);
      await store.setVisitorSettings({ ...settings, levels });
      const left = missing.filter((l) => !levels.some((o) => o.id === l.id));
      if (left.length) notes.push(`A site has at most ${levels.length} member levels, so ${left.map((l) => `"${l.name}"`).join(', ')} ${left.length === 1 ? 'was' : 'were'} not added; what is only for ${left.length === 1 ? 'it' : 'them'} stays closed.`);
    }
  }
  /** Who sees what was brought, as on the site it came from: never opened to everyone by coming here. */
  const keepAudience = async (kind: 'page' | 'entry' | 'type', key: string, audience: Audience | undefined): Promise<void> => {
    if (audience) await store.setAudience(kind, key, audience);
  };

  // Each kind of entry, added where this site lacks it, with who sees it.
  const brought: string[] = [];
  for (const { type, audience } of file.types) {
    const now = await store.site();
    if (!now.types.some((t) => t.id === type.id)) {
      try {
        await store.setSite({ ...now, types: [...now.types, type] });
        await keepAudience('type', type.id, audience);
      } catch (error) {
        notes.push(`The content type "${type.name}" was not added, and its entries were not brought: ${reason(error)}.`);
        continue;
      }
    }
    brought.push(type.id);
  }

  // Words in a language this site does not have stay behind.
  const languages = new Set((await store.site()).languages);
  const dropped = new Set<string>();
  const local = (doc: unknown): unknown => {
    if (!isObject(doc) || !isObject(doc.translations)) return doc;
    const translations = Object.fromEntries(Object.entries(doc.translations).filter(([language]) => languages.has(language) || !dropped.add(language)));
    return { ...doc, translations };
  };

  if (file.forms?.length) {
    const forms = await store.forms();
    const added = file.forms.filter((f) => isObject(f) && !forms.some((o) => o.name === f.name));
    if (added.length) await store.setForms([...forms, ...added]).catch((error: unknown) => notes.push(`The forms were not added: ${reason(error)}.`));
    for (const form of file.forms) if (!added.includes(form)) kept.push(`the form "${String((form as { name?: unknown }).name ?? '')}"`);
  }

  /**
   * One document: what is published first, then the draft when it differs; then its time to be
   * published, when that is still to come. Says whether it was published.
   */
  const bring = async (kind: string, doc: ContentDoc, save: (doc: unknown) => Promise<{ slug: string }>, publish: (slug: string) => Promise<void>, open = true): Promise<boolean> => {
    const draft = local({ ...(doc.draft as object), slug: doc.slug });
    // Who sees it is set before it is published, so it is never shown to everyone in between.
    const audienced = async (slug: string): Promise<string> => {
      if (kind === 'page') await keepAudience('page', slug, doc.audience);
      else if (kind !== 'section') await keepAudience('entry', `${kind}/${slug}`, doc.audience);
      return slug;
    };
    let slug: string;
    if (doc.published && open) {
      const published = local({ ...(doc.published as object), slug: doc.slug });
      slug = await audienced((await save(published)).slug);
      await publish(slug);
      if (!same(draft, published)) await save(draft);
    } else slug = await audienced((await save(draft)).slug);
    if (doc.scheduled && Date.parse(doc.scheduled) > Date.now()) await store.schedule(kind, slug, doc.scheduled).catch(() => undefined);
    return !!(doc.published && open);
  };

  let drafts = 0;
  for (const doc of file.sections ?? []) {
    if (await store.sectionDraft(doc.slug)) {
      kept.push(`the section "${doc.slug}"`);
      continue;
    }
    try {
      if (!(await bring('section', doc, (d) => store.saveSection(d), (slug) => store.publishSection(slug)))) drafts++;
    } catch (error) {
      failed.push(`the section "${doc.slug}" (${reason(error)})`);
    }
  }

  let pages = 0;
  const reserved = new Set(reservedSlugs(await store.site()));
  for (const doc of file.pages ?? []) {
    const title = String((doc.draft as { title?: unknown }).title ?? doc.slug);
    if ((await store.draft(doc.slug)) || reserved.has(doc.slug)) {
      kept.push(`the page "${title}"`);
      continue;
    }
    try {
      // A page behind a password comes without it, so it is not shown to everyone until it has one again.
      if (!(await bring('page', doc, (d) => store.savePage(d), (slug) => store.publish(slug), !doc.locked))) drafts++;
      pages++;
    } catch (error) {
      failed.push(`the page "${title}" (${reason(error)})`);
    }
  }

  // Who wrote what: the person here with the same address, or someone added without access (as from WordPress, ADR 0056 d6).
  const people = new Map<string, string>();
  let addedPeople = 0;
  for (const person of file.people) {
    const email = cleanEmail(person.email);
    if (!email) continue;
    const found = (await store.users()).find((u) => u.email === email);
    if (found) people.set(person.key, found.id);
    else {
      const user = await store.addUser({ email, name: person.name, role: 'author' });
      await store.setProfile(user.id, person.name, person.bio, person.picture || undefined).catch(() => undefined);
      people.set(person.key, user.id);
      addedPeople++;
    }
  }

  let posts = 0;
  let entries = 0;
  const arrived = new Set<string>();
  for (const { type, template, entries: own } of file.types) {
    if (!brought.includes(type.id)) continue;
    if ((template.draft || template.published) && (await store.template(type.id)) === null) {
      if (template.published) {
        await store.setTemplate(type.id, template.published);
        await store.publishTemplate(type.id);
      }
      await store.setTemplate(type.id, template.draft);
    }
    for (const doc of own) {
      const title = String((doc.draft as { title?: unknown }).title ?? doc.slug);
      if (await store.entryDraft(type.id, doc.slug)) {
        kept.push(`"${title}" (${type.name})`);
        continue;
      }
      try {
        const author = people.get(doc.author ?? '') ?? '';
        if (!(await bring(type.id, doc, (d) => store.saveEntry(type.id, d, author), (slug) => store.publishEntry(type.id, slug)))) drafts++;
        arrived.add(`${type.id}/${doc.slug}`);
        if (type.id === POSTS_TYPE) posts++;
        else entries++;
      } catch (error) {
        failed.push(`"${title}" (${type.name}: ${reason(error)})`);
      }
    }
  }
  let comments = 0;
  for (const comment of file.comments) {
    if (!arrived.has(`${comment.type}/${comment.entry}`)) continue;
    await store.keepShownComment(comment);
    comments++;
  }

  let redirects = 0;
  if (file.redirects?.length) {
    const before = await store.redirects();
    redirects = (await store.setRedirects([...before, ...file.redirects])).length - before.length;
  }
  if (options.fresh && file.theme) {
    try {
      if (file.theme.published) {
        await store.setTheme(file.theme.published);
        await store.publishTheme();
      }
      if (file.theme.draft) await store.setTheme(file.theme.draft);
    } catch (error) {
      notes.push(`The old site's theme was not taken: ${reason(error)}.`);
    }
  }

  // The visitors, last: only into a site whose accounts are on, and without passwords (ADR 0064 d6).
  if (file.visitors?.length) {
    const { importVisitors } = await import('../site/visitor-transfer.ts');
    const came = await importVisitors(store, file.visitors);
    if (came.off) notes.push(`The file holds ${file.visitors.length === 1 ? 'one visitor account' : `${file.visitors.length} visitor accounts`}, and visitor accounts are off here, so none was brought. Turn them on in Settings → Visitor accounts and import the file again.`);
    else {
      if (came.added) notes.push(`${came.added === 1 ? 'One visitor account was' : `${came.added} visitor accounts were`} brought, with ${came.added === 1 ? 'its' : 'their'} levels and without a password: each visitor chooses one with "Forgot your password?". No message was sent.`);
      if (came.kept) notes.push(`${came.kept === 1 ? 'One visitor already had' : `${came.kept} visitors already had`} an account here under the same address, left as it was.`);
    }
  }

  if (comments) notes.push(`${comments === 1 ? 'One comment came' : `${comments} comments came`} with the entries, approved, without the addresses they were sent from.`);
  if (addedPeople) notes.push(`${addedPeople === 1 ? 'One person who wrote there was' : `${addedPeople} people who wrote there were`} added under People, without access, so their entries keep their names. Invite them from there if they should write here again.`);
  if (dropped.size) notes.push(`This site does not have ${[...dropped].join(', ')}, so the translations into ${dropped.size === 1 ? 'it' : 'them'} stayed behind. Add the language in Site settings and import again to bring them.`);
  if (kept.length) notes.push(`Already in this site under the same address, and left as they were: ${kept.slice(0, 10).join(', ')}${kept.length > 10 ? ` and ${kept.length - 10} more` : ''}.`);
  if (failed.length) notes.push(`Could not be brought: ${failed.slice(0, 10).join(', ')}${failed.length > 10 ? ` and ${failed.length - 10} more` : ''}.`);
  return { pages, posts, entries, drafts, images, redirects, menu, notes };
}
