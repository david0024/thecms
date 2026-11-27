/**
 * Blocks an extension adds to the public site (ADR 0062 d6): a form drawn by
 * the site with its theme, posted to the extension's route, checked as the
 * block declares it; and a route that answers with a page in the site's layout.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanBlockPost, EXTENSION_FORMAT, EXTENSION_FORMAT_2, extensionAsks, normalizeBlocks, parseExtension } from '../src/core/index.ts';
import { extensionHost } from '../src/site/extensions.ts';
import { FRESH_MS, startRuntime } from '../src/site/runtime.ts';
import { Store } from '../src/site/store.ts';
import plain from '../themes/plain.json';

const dir = await mkdtemp(join(tmpdir(), 'uhlaka-xblocks-'));
afterAll(() => rm(dir, { recursive: true, force: true }));

const CODE = `export const actions = {
  signup: async (input, host) => {
    await host.collections.insert('people', { email: input.fields.email, plan: input.fields.plan ?? '' });
    if (input.fields.plan === 'quiet') return null;
    return { page: { title: 'Almost there', blocks: [{ type: 'text', content: { body: [{ type: 'paragraph', children: [{ text: 'Check your e-mail, ' + input.fields.email + '.' }] }] } }, { type: 'nonsense' }] } };
  },
  hook: async (input) => 'heard ' + input.body.length,
};`;

const manifest = {
  name: 'news',
  displayName: 'Newsletter',
  version: '1.0.0',
  collections: [
    {
      name: 'people',
      label: 'People',
      fields: [
        { key: 'email', label: 'E-mail', kind: 'text' },
        { key: 'plan', label: 'Plan', kind: 'text' },
      ],
    },
  ],
  actions: [
    { name: 'signup', label: 'Sign up', writes: ['people'] },
    { name: 'hook', label: 'Hook' },
  ],
  routes: [
    { path: 'signup', action: 'signup', methods: ['POST'] },
    { path: 'hook', action: 'hook', methods: ['GET'] },
  ],
  blocks: [
    {
      name: 'signup',
      label: 'Newsletter sign-up',
      fields: [
        { key: 'email', label: 'E-mail', kind: 'email', required: true },
        { key: 'plan', label: 'How often', kind: 'select', options: ['weekly', 'quiet'] },
        { key: 'agree', label: 'I want the newsletter', kind: 'consent' },
        { key: 'name', label: 'Name', kind: 'text' },
        { key: 'note', label: 'Anything else', kind: 'textarea' },
        { key: 'phone', label: 'Phone', kind: 'phone' },
        { key: 'people', label: 'How many', kind: 'number' },
        { key: 'from', label: 'From', kind: 'date' },
      ],
      submit: 'Sign up',
      sent: 'You are on the list.',
      route: 'signup',
    },
  ],
  messages: { ro: { 'Sign up': 'Abonează-mă', 'E-mail': 'Adresa de e-mail' } },
};
const PACKAGE = JSON.stringify({ format: EXTENSION_FORMAT, manifest, code: CODE });

async function site(name: string): Promise<Store> {
  const store = await Store.open(join(dir, `${name}.db`));
  await store.setTheme(plain);
  await store.publishTheme();
  await store.setSite({ name: 'Atelier', url: 'https://site.example', languages: ['ro'] });
  await store.savePage({ slug: '', title: 'Home', blocks: [] });
  await store.publish('');
  await store.savePage({ slug: 'join', title: 'Join', blocks: [{ id: 'b1', type: 'extension', content: { block: 'news/signup', title: 'Stay in touch' } }] });
  await store.publish('join');
  return store;
}

async function install(store: Store): Promise<void> {
  const host = extensionHost(store);
  await host.install(PACKAGE, (await host.offer(PACKAGE)).sha256);
  host.close();
}

const post = (fields: Record<string, string>, query = ''): Request =>
  new Request(`http://site.example/_/x/news/signup${query}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ back: '/join/', block: 'signup', form: 'b1', website: '', ...fields }).toString(),
  });

describe('a block an extension declares', () => {
  test('is read in the third format, shown before installing, and posts to one of its routes that takes POST', () => {
    const { pkg, problems } = parseExtension(JSON.parse(PACKAGE));
    expect(problems).toEqual([]);
    expect(pkg!.manifest.blocks[0]).toMatchObject({ name: 'signup', label: 'Newsletter sign-up', route: 'signup', submit: 'Sign up' });
    expect(pkg!.manifest.blocks[0]!.fields.map((f) => `${f.key}:${f.kind}:${f.required}`)).toEqual(['email:email:true', 'plan:select:false', 'agree:consent:true', 'name:text:false', 'note:textarea:false', 'phone:phone:false', 'people:number:false', 'from:date:false']);
    expect(extensionAsks(pkg!.manifest).blocks).toEqual(['Newsletter sign-up']);

    const wrong = parseExtension({
      format: EXTENSION_FORMAT,
      manifest: {
        ...manifest,
        blocks: [
          { name: 'a', label: 'Too short a name', fields: [], route: 'signup' },
          { name: 'by-get', fields: [], route: 'hook' },
          { name: 'nowhere', fields: [], route: 'missing' },
          { name: 'odd', fields: [{ key: 'back', kind: 'text' }, { key: 'size', kind: 'colour' }, { key: 'pick', kind: 'select' }], route: 'signup' },
        ],
      },
      code: CODE,
    });
    expect(wrong.problems).toEqual([
      'a block\'s name is lower case letters, digits and - ("a")',
      'the block "by-get" is sent to "hook", which does not take POST',
      'the block "nowhere" is sent to "missing", which is not one of its routes',
      'odd: a field\'s key is lower case letters, digits and _, and not back, block, form, website ("back")',
      'odd.size: a block\'s field is one of text, textarea, email, phone, number, date, select, consent',
      'odd.pick: a choice needs its options',
    ]);
    // The second format has no blocks: what it says of them is not read.
    expect(parseExtension({ format: EXTENSION_FORMAT_2, manifest, code: CODE }).pkg!.manifest.blocks).toEqual([]);
  });

  test('what a visitor sends is checked field by field', () => {
    const block = parseExtension(JSON.parse(PACKAGE)).pkg!.manifest.blocks[0]!;
    expect(cleanBlockPost(block, new URLSearchParams({ email: ' ana@site.example ', plan: 'weekly', agree: 'yes', name: 'Ana\nPop', note: 'one\ntwo', people: '3', from: '2026-12-01', extra: 'dropped' }))).toEqual({
      fields: { email: 'ana@site.example', plan: 'weekly', agree: true, name: 'Ana Pop', note: 'one\ntwo', phone: null, people: 3, from: '2026-12-01' },
      problems: [],
    });
    expect(cleanBlockPost(block, new URLSearchParams({ email: 'not an address', plan: 'daily', people: 'many', from: '1 Dec', phone: '0'.repeat(41) })).problems).toEqual([
      'email: not an e-mail address',
      'plan: not one of its options',
      'agree: needed',
      'phone: too long',
      'people: not a number',
      'from: not a date',
    ]);
  });

  test('a page keeps the block by its name, and nothing else is a name', () => {
    const { blocks } = normalizeBlocks([
      { type: 'extension', content: { block: 'news/signup', title: 'Join' } },
      { type: 'extension', content: { block: '<script>/x' } },
    ]);
    expect(blocks.map((b) => b.content.block)).toEqual(['news/signup', '']);
  });
});

describe('on the public site', () => {
  test('the block is drawn as a form in the page\'s language, posted to the extension, and goes when the extension does', async () => {
    const store = await site('drawn');
    let clock = Date.now();
    const runtime = startRuntime(store, { listen: false, now: () => clock });
    const later = (): void => {
      clock += FRESH_MS;
    };
    try {
      // Not installed: a published page does not show a hole, only nothing.
      expect(await (await runtime.fetch(new Request('http://site.example/join/'))).text()).not.toContain('<form class="form"');
      await install(store);
      later();
      const page = await (await runtime.fetch(new Request('http://site.example/join/'))).text();
      expect(page).toContain('class="b b-extension"');
      expect(page).toContain('action="/_/x/news/signup"');
      expect(page).toContain('name="email" type="email"');
      expect(page).toContain('<option value="quiet">quiet</option>');
      expect(page).toContain('name="agree" type="checkbox" value="yes" required');
      expect(page).toContain('>Sign up</button>');
      expect(page).toContain('You are on the list.');
      for (const drawn of ['<textarea id="f-b1-note" name="note"', 'name="phone" type="tel"', 'name="people" type="number"', 'name="from" type="date"', 'name="name" type="text"']) expect(page).toContain(drawn);

      await store.translate('join', 'ro');
      await store.publish('ro/join');
      later();
      const ro = await (await runtime.fetch(new Request('http://site.example/ro/join/'))).text();
      expect(ro).toContain('action="/_/x/news/signup?l=ro"');
      expect(ro).toContain('>Abonează-mă</button>');
      expect(ro).toContain('Adresa de e-mail');

      const host = extensionHost(store);
      await host.uninstall('news');
      host.close();
      later();
      expect(await (await runtime.fetch(new Request('http://site.example/join/'))).text()).not.toContain('action="/_/x/news/signup"');
    } finally {
      runtime.stop();
    }
  });

  test('what is sent reaches the action checked; it answers with a page in the site\'s layout, or the visitor goes back', async () => {
    const store = await site('posted');
    await install(store);
    const runtime = startRuntime(store, { listen: false });
    try {
      const answered = await runtime.fetch(post({ email: 'ana@site.example', plan: 'weekly', agree: 'yes' }));
      expect(answered.status).toBe(200);
      expect(answered.headers.get('content-type')).toBe('text/html; charset=utf-8');
      expect(answered.headers.get('content-security-policy')).toContain("default-src 'none'");
      const html = await answered.text();
      expect(html).toContain('<title>Almost there · Atelier</title>');
      expect(html).toContain('<meta name="robots" content="noindex">');
      expect(html).toContain('<h1>Almost there</h1>');
      expect(html).toContain('Check your e-mail, ana@site.example.');
      // The site's header and footer are around it.
      expect(html).toContain('Atelier');
      expect(html).toContain('<header');
      expect(await store.extensionRows('news', 'people')).toMatchObject([{ email: 'ana@site.example', plan: 'weekly' }]);

      // No answer: back to the block, said sent.
      const quiet = await runtime.fetch(post({ email: 'bo@site.example', plan: 'quiet', agree: 'yes' }));
      expect(quiet.status).toBe(303);
      expect(quiet.headers.get('location')).toBe('/join/#f-b1-sent');

      // A field that does not fit: back to the block, said failed, and the action is not run.
      const failed = await runtime.fetch(post({ email: 'nobody', agree: 'yes' }));
      expect(failed.headers.get('location')).toBe('/join/#f-b1-failed');
      // A robot that filled the trap is sent back as if heard, and nothing runs.
      const robot = await runtime.fetch(post({ email: 'robot@site.example', agree: 'yes', website: 'spam.example' }));
      expect(robot.headers.get('location')).toBe('/join/#f-b1-sent');
      // Sent back only to this site.
      const away = await runtime.fetch(post({ email: 'cy@site.example', plan: 'quiet', agree: 'yes', back: '//elsewhere.example/' }));
      expect(away.headers.get('location')).toBe('/#f-b1-sent');
      expect((await store.extensionRows('news', 'people')).map((r) => r.email)).toEqual(['ana@site.example', 'bo@site.example', 'cy@site.example']);

      // In another language, the page is drawn in that language's frame.
      expect(await (await runtime.fetch(post({ email: 'dan@site.example', agree: 'yes' }, '?l=ro'))).text()).toContain('<html lang="ro">');
      // A route not sent from a block answers as before.
      expect(await (await runtime.fetch(new Request('http://site.example/_/x/news/hook'))).text()).toBe('heard 0');
    } finally {
      runtime.stop();
    }
  });
});
