/**
 * The visitors as a part of the complete export (ADR 0057 d1, ADR 0064 d6):
 * chosen apart from the whole site, without anything to sign in with, and
 * brought back only into a site whose accounts are on. Who sees a page goes
 * with it always, so nothing for members is opened to everyone by an import.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POSTS_TYPE } from '../src/core/index.ts';
import { contentPreview, readContentFile, runContentImport } from '../src/import/uhlaka.ts';
import { publishedSite } from '../src/site/export.ts';
import { Store } from '../src/site/store.ts';
import { contentParts, exportContent } from '../src/site/transfer.ts';
import { normalizeVisitorSettings } from '../src/site/visitor-gate.ts';
import { visitorSchema } from '../src/site/visitor-schema.ts';
import plain from '../themes/plain.json';

const dir = await mkdtemp(join(tmpdir(), 'uhlaka-visitors-export-'));
afterAll(() => rm(dir, { recursive: true, force: true }));

const text = (body: string) => ({ id: `b_${Math.random().toString(36).slice(2, 10)}`, type: 'text', content: { body: [{ type: 'paragraph', children: [{ text: body }] }] } });
const LEVELS = [
  { id: 'member', name: 'Member' },
  { id: 'premium', name: 'Premium' },
];

async function site(name: string): Promise<Store> {
  const store = await Store.open(join(dir, `${name}.db`));
  await store.setTheme(plain);
  await store.publishTheme();
  await store.setSite({ name: 'Atelier', url: 'https://example.com', forms: '/_', languages: ['ro'] });
  await store.savePage({ slug: '', title: 'Home', blocks: [text('Welcome.')] });
  await store.publish('');
  return store;
}

/** Visitor accounts turned on, as the owner does it, with their tables. */
async function accountsOn(store: Store, levels = LEVELS): Promise<void> {
  await store.setVisitorSettings({ on: true, signup: 'closed', levels });
  const db = store.database();
  await db.make(visitorSchema(db.kind));
}

async function addVisitor(store: Store, email: string, confirmed: boolean, levels: string[] = []): Promise<string> {
  const id = crypto.randomUUID();
  const db = store.database();
  const hash = await Bun.password.hash('the old password', { algorithm: 'argon2id' });
  await db.run('INSERT INTO visitors (id, email, name, password, language, created_at, confirmed_at, last_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
    id,
    email,
    'Ana',
    hash,
    'ro',
    '2026-10-01T10:00:00.000Z',
    confirmed ? '2026-10-01T10:05:00.000Z' : null,
    '2026-11-20',
  ]);
  for (const level of levels) await db.run('INSERT INTO visitor_levels (visitor_id, level) VALUES (?, ?)', [id, level]);
  await db.run('INSERT INTO visitor_sessions (id, visitor_id, expires_at) VALUES (?, ?, ?)', [`session-${id}`, id, '2099-01-01T00:00:00.000Z']);
  return id;
}

/** A site with accounts, members, pages and entries for them. */
async function membersSite(name: string): Promise<Store> {
  const store = await site(name);
  await accountsOn(store);
  await store.savePage({ slug: 'club', title: 'Club', blocks: [text('The secret recipe.')] });
  await store.publish('club');
  await store.setAudience('page', 'club', { who: 'members', levels: ['premium'] });
  await store.saveEntry(POSTS_TYPE, { slug: 'inside', title: 'Inside post', date: '2026-01-03', blocks: [text('The members letter.')] });
  await store.publishEntry(POSTS_TYPE, 'inside');
  await store.setAudience('entry', `${POSTS_TYPE}/inside`, { who: 'signed' });
  await store.setSite({ ...(await store.site()), types: [...(await store.site()).types, { id: 'courses', name: 'Courses', singular: 'Course', path: 'courses', fields: [] }] });
  await store.saveEntry('courses', { slug: 'oak', title: 'Working oak', blocks: [text('Lesson one.')] });
  await store.publishEntry('courses', 'oak');
  await store.setAudience('type', 'courses', { who: 'members', levels: ['member'] });
  await addVisitor(store, 'ana@example.com', true, ['premium']);
  await addVisitor(store, 'ion@example.com', true);
  await addVisitor(store, 'waiting@example.com', false);
  return store;
}

const visitorRows = (store: Store) => store.database().rows<Record<string, unknown>>('SELECT * FROM visitors ORDER BY email');

describe('the visitors in the content file (ADR 0064 d6)', () => {
  test('are offered apart, only once the site has had accounts, and never with the whole site', async () => {
    const none = await site('never');
    expect((await contentParts(none)).map((p) => p.id)).not.toContain('visitors');
    await expect(exportContent(none, ['visitors'])).rejects.toThrow('choose what to export');
    await none.close();

    const store = await membersSite('apart');
    try {
      expect((await contentParts(store)).find((p) => p.id === 'visitors')).toEqual({ id: 'visitors', name: 'visitors', apart: true });
      // Off again, the accounts are kept, and can still leave.
      await store.setVisitorSettings({ ...normalizeVisitorSettings(await store.visitorSettings()), on: false });
      expect((await contentParts(store)).some((p) => p.id === 'visitors')).toBe(true);
      const whole = await exportContent(store);
      expect(whole.parts).not.toContain('visitors');
      expect(whole.visitors).toBeUndefined();
      expect(JSON.stringify(whole)).not.toContain('ana@example.com');
      // Who sees what goes with the content always, with the levels it names.
      expect(whole.pages?.find((p) => p.slug === 'club')?.audience).toEqual({ who: 'members', levels: ['premium'] });
      expect(whole.types.find((t) => t.type.id === POSTS_TYPE)?.entries.find((e) => e.slug === 'inside')?.audience).toEqual({ who: 'signed' });
      expect(whole.types.find((t) => t.type.id === 'courses')?.audience).toEqual({ who: 'members', levels: ['member'] });
      expect(whole.levels).toEqual(LEVELS);
      // A part with no one for members names no levels.
      expect((await exportContent(store, ['sections'])).levels).toBeUndefined();
    } finally {
      await store.close();
    }
  });

  test('hold each confirmed visitor, and nothing to sign in with', async () => {
    const store = await membersSite('held');
    try {
      const file = await exportContent(store, ['visitors']);
      expect(file.parts).toEqual(['visitors']);
      expect(file.pages).toBeUndefined();
      expect(file.media).toEqual([]);
      expect(file.levels).toEqual(LEVELS);
      expect(file.visitors).toEqual([
        { email: 'ana@example.com', name: 'Ana', language: 'ro', createdAt: '2026-10-01T10:00:00.000Z', confirmedAt: '2026-10-01T10:05:00.000Z', levels: ['premium'] },
        { email: 'ion@example.com', name: 'Ana', language: 'ro', createdAt: '2026-10-01T10:00:00.000Z', confirmedAt: '2026-10-01T10:05:00.000Z', levels: [] },
      ]);
      const written = JSON.stringify(file);
      for (const never of ['argon2', 'session-', 'waiting@example.com', '2026-11-20', 'password']) expect(written).not.toContain(never);

      // The whole site and the visitors, with the whole library.
      const both = await exportContent(store, [...(await contentParts(store)).map((p) => p.id)]);
      expect(both.pages?.length).toBeGreaterThan(0);
      expect(both.visitors).toHaveLength(2);
    } finally {
      await store.close();
    }
  });

  test('come back only where the accounts are on, confirmed, without a password, with their levels', async () => {
    const from = await membersSite('from');
    const text = JSON.stringify(await exportContent(from, [...(await contentParts(from)).map((p) => p.id)]));
    await from.close();
    const file = readContentFile(text);
    expect(file.visitors).toHaveLength(2);
    expect(contentPreview(file).notes.join(' ')).toContain('2 visitor accounts, without passwords');
    expect(contentPreview(file).notes.join(' ')).toContain('3 pages, entries or types are for visitors signed in or for members');

    // Off here: nobody is brought, and the report says how.
    const off = await site('off');
    try {
      const report = await runContentImport(off, file, { fresh: false });
      expect(report.notes.join(' ')).toContain('visitor accounts are off here, so none was brought');
      expect(await off.hasTable('visitors')).toBe(false);
      // The levels are named, and what is for members stays so: closed while the accounts are off.
      expect(normalizeVisitorSettings(await off.visitorSettings())).toMatchObject({ on: false, levels: LEVELS });
      expect(await off.audiences()).toEqual({
        pages: { club: { who: 'members', levels: ['premium'] } },
        entries: { [`${POSTS_TYPE}/inside`]: { who: 'signed' } },
        types: { courses: { who: 'members', levels: ['member'] } },
      });
      const files = await publishedSite(off);
      expect(String(files.get('club/index.html'))).toContain('<meta name="uhlaka-members" content="members:premium">');
      expect(String(files.get('blog/inside/index.html'))).toContain('<meta name="uhlaka-members" content="signed">');
      expect(String(files.get('courses/oak/index.html'))).toContain('<meta name="uhlaka-members" content="members:member">');
    } finally {
      await off.close();
    }

    // On here: each comes confirmed, chooses a password, keeps the levels named here; one already here is left as it was.
    const on = await site('on');
    try {
      await accountsOn(on, [{ id: 'member', name: 'Member' }]);
      const ion = await addVisitor(on, 'ion@example.com', true, ['member']);
      const made: unknown[] = [];
      on.onEvent((event) => event.name === 'account.made' && made.push(event.data));
      const report = await runContentImport(on, file, { fresh: false });
      expect(report.notes.join(' ')).toContain('One visitor account was brought');
      expect(report.notes.join(' ')).toContain('One visitor already had an account here');
      expect(normalizeVisitorSettings(await on.visitorSettings()).levels).toEqual(LEVELS);
      const rows = await visitorRows(on);
      const ana = rows.find((r) => r.email === 'ana@example.com') as Record<string, unknown>;
      expect(ana).toMatchObject({ name: 'Ana', password: '', language: 'ro', created_at: '2026-10-01T10:00:00.000Z', confirmed_at: '2026-10-01T10:05:00.000Z', last_at: null });
      const levels = await on.database().rows<Record<string, unknown>>('SELECT level FROM visitor_levels WHERE visitor_id = ?', [ana.id]);
      expect(levels.map((l) => l.level)).toEqual(['premium']);
      expect(rows.find((r) => r.email === 'ion@example.com')?.id).toBe(ion);
      expect(String(rows.find((r) => r.email === 'ion@example.com')?.password)).toStartWith('$argon2id$');
      expect(made).toEqual([{ id: ana.id, levels: ['premium'] }]);
      expect(await on.database().rows('SELECT * FROM visitor_sessions WHERE visitor_id = ?', [ana.id])).toEqual([]);
    } finally {
      await on.close();
    }
  });

  test('a file from before the levels were in it keeps a page for members closed', () => {
    const file = readContentFile(
      JSON.stringify({ format: 'uhlaka.content/1', from: {}, parts: ['pages'], pages: [{ slug: 'club', draft: { title: 'Club', blocks: [] }, published: { title: 'Club', blocks: [] }, members: true }], types: [] }),
    );
    expect(file.pages?.[0]?.audience).toEqual({ who: 'signed' });
  });
});
