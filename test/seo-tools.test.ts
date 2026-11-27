/**
 * Tools for a large site (ADR 0064): links a page could add, every page's
 * title and description in one table, and Google Search Console.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Block, linkSuggestions, linksIn, normalizeBlocks, normalizeTypes } from '../src/core/index.ts';
import { cleanSearchConsole, searchReport } from '../src/site/search-console.ts';
import { startEditor } from '../src/site/server.ts';
import { Store } from '../src/site/store.ts';
import plain from '../themes/plain.json';

const dir = await mkdtemp(join(tmpdir(), 'thecms-seo-tools-'));
afterAll(() => rm(dir, { recursive: true, force: true }));

const text = (body: string, href?: string): Block =>
  normalizeBlocks([{ type: 'text', content: { body: [{ type: 'paragraph', children: [{ text: body, ...(href ? { href } : {}) }] }] } }]).blocks[0] as Block;

describe('links a page could add (ADR 0064 d1)', () => {
  const targets = [
    { title: 'Home', path: '/' },
    { title: 'Oak tables', path: '/oak-tables/' },
    { title: 'Tables', path: '/tables/' },
    { title: 'Despre noi', path: '/despre/' },
    { title: 'Us', path: '/us/' },
    { title: 'Chairs', path: '/chairs/' },
    { title: 'Chairs', path: '/chairs/' },
  ];

  test('another page whose title the words say, not yet linked, longest first', () => {
    const blocks = [text('Our oak tables are made at home, by us. Read more DESPRE NOI and about our chairs. '), text('chairs', 'https://example.com/chairs/?x=1')];
    expect(linksIn(blocks)).toEqual(new Set(['/chairs/']));
    expect(linkSuggestions(blocks, targets, '/oak-tables/')).toEqual([
      { title: 'Despre noi', path: '/despre/' },
      { title: 'Tables', path: '/tables/' },
    ]);
    // Accents do not matter; a word inside another is not the word.
    expect(linkSuggestions([text('Află mai multe despre noi.')], targets, '/')).toEqual([{ title: 'Despre noi', path: '/despre/' }]);
    expect(linkSuggestions([text('Timetables')], targets, '/')).toEqual([]);
    expect(linkSuggestions([], targets, '/')).toEqual([]);
    expect(linkSuggestions([text('tables chairs')], targets, '/', 1)).toHaveLength(1);
  });
});

describe('every title and description in one table (ADR 0064 d2)', () => {
  test('read, written, and published again when nothing else waited', async () => {
    const store = await Store.open(join(dir, 'table.db'));
    await store.setTheme(plain);
    await store.publishTheme();
    await store.setSite({ name: 'Atelier', url: 'https://example.com', types: normalizeTypes([{ name: 'Events', fields: [] }]) });
    const type = (await store.site()).types[0]?.id as string;
    await store.savePage({ slug: 'about', title: 'About', blocks: [text('We make tables.')] });
    await store.publish('about');
    await store.savePage({ slug: 'draft', title: 'Draft', blocks: [] });
    await store.saveEntry(type, { slug: 'fair', title: 'Fair', blocks: [] });
    await store.publishEntry(type, 'fair');
    const editor = await startEditor(store, { listen: false, log: () => {} });
    const call = (method: string, body?: unknown) =>
      editor.fetch(new Request('http://127.0.0.1:4321/api/seo', { method, headers: { host: '127.0.0.1:4321', 'x-thecms-token': editor.token, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }));
    try {
      const { rows } = (await (await call('GET')).json()) as { rows: { type: string; slug: string; auto: string; path: string; published: boolean }[] };
      expect(rows.map((r) => `${r.type}/${r.slug}`)).toEqual(['/about', '/draft', `${type}/fair`]);
      expect(rows[0]).toMatchObject({ auto: 'We make tables.', path: '/about/', published: true });
      expect(rows[2]?.path).toBe('/events/fair/');

      const { row } = (await (await call('PUT', { type: '', slug: 'about', seoTitle: 'About the workshop', description: ' Who makes the tables. ' })).json()) as { row: { seoTitle: string; description: string } };
      expect(row).toMatchObject({ seoTitle: 'About the workshop', description: 'Who makes the tables.' });
      // Published as it was, so published again: the site says it at once.
      expect((await store.pages()).find((p) => p.slug === 'about')?.changed).toBe(false);
      expect((await store.published()).find((p) => p.slug === 'about')?.description).toBe('Who makes the tables.');

      await call('PUT', { type, slug: 'fair', seoTitle: '', description: 'A fair of wood.' });
      expect((await store.entryDraft(type, 'fair'))?.description).toBe('A fair of wood.');
      expect((await store.entries(type))[0]?.changed).toBe(false);

      // A page with other changes waiting keeps waiting for its author.
      await store.savePage({ slug: 'about', title: 'About us', seoTitle: 'About the workshop', description: 'Who makes the tables.', blocks: [] });
      await call('PUT', { type: '', slug: 'about', seoTitle: 'Workshop', description: 'Who makes the tables.' });
      expect((await store.pages()).find((p) => p.slug === 'about')?.changed).toBe(true);

      expect((await call('PUT', { type: '', slug: 'nowhere', seoTitle: '', description: '' })).status).toBe(400);
      expect((await call('PUT', { type, slug: 'nowhere', seoTitle: '', description: '' })).status).toBe(400);
    } finally {
      editor.stop();
      await store.close();
    }
  });
});

describe('Google Search Console (ADR 0064 d3)', () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const key = JSON.stringify({ type: 'service_account', client_email: 'reader@project.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) });

  test('a service account key and a property, or why not', () => {
    expect(cleanSearchConsole({ key, property: '' }, 'https://example.com')).toMatchObject({ settings: { clientEmail: 'reader@project.iam.gserviceaccount.com', property: 'https://example.com/' } });
    expect(cleanSearchConsole({ key: JSON.parse(key), property: 'sc-domain:example.com' }, '')).toMatchObject({ settings: { property: 'sc-domain:example.com' } });
    expect(cleanSearchConsole({ key: 'not json' }, 'https://example.com')).toHaveProperty('problem');
    expect(cleanSearchConsole({ key: '{"type":"user"}' }, 'https://example.com')).toHaveProperty('problem');
    expect(cleanSearchConsole({ key }, '')).toHaveProperty('problem');
    expect(cleanSearchConsole(null, '')).toHaveProperty('problem');
  });

  /** Google, as far as the site asks it: a token for a signed JWT, then each report. */
  const google = (asked: { url: string; body: string; auth?: string }[], fail = '') => async (url: string, init: RequestInit): Promise<Response> => {
    asked.push({ url, body: String(init.body), auth: (init.headers as Record<string, string>).authorization });
    if (url.includes('oauth2')) return fail === 'token' ? Response.json({ error: 'invalid_grant', error_description: 'Invalid JWT Signature.' }, { status: 400 }) : Response.json({ access_token: 'tok' });
    if (fail === 'report') return Response.json({ error: { message: 'User does not have sufficient permission' } }, { status: 403 });
    const dimension = (JSON.parse(String(init.body)) as { dimensions: string[] }).dimensions[0];
    return Response.json({ rows: [{ keys: [dimension === 'query' ? 'oak table' : 'https://example.com/about/'], clicks: 12, impressions: 340, ctr: 0.0353, position: 4.26 }] });
  };

  test('what people searched for and the pages they found, over 28 days Google has counted', async () => {
    const asked: { url: string; body: string; auth?: string }[] = [];
    const settings = (cleanSearchConsole({ key }, 'https://example.com') as { settings: Parameters<typeof searchReport>[0] }).settings;
    const report = await searchReport(settings, { fetch: google(asked), now: Date.UTC(2026, 10, 22) });
    expect(report).toEqual({
      from: '2026-10-23',
      to: '2026-11-19',
      queries: [{ key: 'oak table', clicks: 12, impressions: 340, ctr: 0.0353, position: 4.3 }],
      pages: [{ key: 'https://example.com/about/', clicks: 12, impressions: 340, ctr: 0.0353, position: 4.3 }],
    });
    const assertion = new URLSearchParams(asked[0]?.body).get('assertion') as string;
    expect(assertion.split('.')).toHaveLength(3);
    expect(JSON.parse(Buffer.from(assertion.split('.')[1] as string, 'base64url').toString())).toMatchObject({ iss: 'reader@project.iam.gserviceaccount.com', scope: 'https://www.googleapis.com/auth/webmasters.readonly' });
    expect(asked[1]?.url).toBe('https://www.googleapis.com/webmasters/v3/sites/https%3A%2F%2Fexample.com%2F/searchAnalytics/query');
    expect(asked[1]?.auth).toBe('Bearer tok');
    await expect(searchReport(settings, { fetch: google([], 'token') })).rejects.toThrow('Invalid JWT Signature.');
    await expect(searchReport(settings, { fetch: google([], 'report') })).rejects.toThrow('sufficient permission');
  });

  test('the owner connects it once it works; the staff read it, kept an hour', async () => {
    const store = await Store.open(join(dir, 'console.db'));
    await store.setSite({ name: 'Atelier', url: 'https://example.com' });
    let fail = 'token';
    const asked: { url: string; body: string }[] = [];
    const editor = await startEditor(store, { listen: false, log: () => {}, searchConsoleFetch: (url, init) => google(asked, fail)(url, init) });
    const call = (method: string, body?: unknown, query = '') =>
      editor.fetch(new Request(`http://127.0.0.1:4321/api/search-console${query}`, { method, headers: { host: '127.0.0.1:4321', 'x-thecms-token': editor.token, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }));
    try {
      expect(await (await call('GET')).json()).toEqual({ connected: false });
      expect((await call('PUT', { key: 'no' })).status).toBe(400);
      const refused = await call('PUT', { key });
      expect(refused.status).toBe(400);
      expect(((await refused.json()) as { error: string }).error).toContain('Invalid JWT Signature.');
      expect(await store.searchConsole()).toBeNull();

      fail = '';
      const connected = (await (await call('PUT', { key, property: '' })).json()) as { connected: boolean; email: string; report: { queries: unknown[] } };
      expect(connected).toMatchObject({ connected: true, email: 'reader@project.iam.gserviceaccount.com', property: 'https://example.com/' });
      expect(connected.report.queries).toHaveLength(1);
      const before = asked.length;
      expect(((await (await call('GET')).json()) as { report: unknown }).report).toBeDefined();
      expect(asked.length).toBe(before);
      fail = 'report';
      expect(((await (await call('GET', undefined, '?fresh=1')).json()) as { error: string }).error).toContain('sufficient permission');
      expect(await (await call('DELETE')).json()).toEqual({ connected: false });
      expect(await store.searchConsole()).toBeNull();
    } finally {
      editor.stop();
      await store.close();
    }
  });
});
