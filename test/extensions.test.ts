/**
 * Extensions (ADR 0026): a package is read and checked, the owner accepts what
 * it asks for, its code runs in a process of its own and reaches only what it
 * declared, and what it gives back to the editor is cleaned like anything else.
 */
import { afterAll, describe, expect, spyOn, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanRow, egressAllows, EXTENSION_FORMAT, extensionAsks, extensionWord, parseExtension, shownRow } from '../src/core/index.ts';
import { describeOffer } from '../src/site/cli.ts';
import type { FromRunner, ToRunner } from '../src/site/extension-runner.ts';
import { extensionHost, socketRunner } from '../src/site/extensions.ts';
import { startEditor } from '../src/site/server.ts';
import { Store } from '../src/site/store.ts';
import plain from '../themes/plain.json';
import { packCommand, packExtension } from '../tools/pack-extension.ts';

const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='), (c) => c.charCodeAt(0));
const dir = await mkdtemp(join(tmpdir(), 'thecms-extensions-'));
afterAll(() => rm(dir, { recursive: true, force: true }));
const { file } = await packExtension(join(import.meta.dir, 'fixtures', 'extension'), dir);
const PACKAGE = await Bun.file(file).text();
const raw = JSON.parse(PACKAGE) as { format: string; manifest: Record<string, unknown>; code: string };
const manifest = (over: Record<string, unknown>) => ({ ...raw, manifest: { ...raw.manifest, ...over } });

describe('a package', () => {
  test('is read with what it declares, and says plainly what it asks for', () => {
    const { pkg, problems } = parseExtension(raw);
    expect(problems).toEqual([]);
    const m = pkg!.manifest;
    expect(m.actions.map((a) => `${a.name}:${a.on ?? 'screen'}:${a.timeoutSeconds}`)).toEqual(['louder:block:60', 'title:page:60', 'stamp:page:60', 'ping:screen:60', 'sneak:screen:60', 'slow:screen:1', 'crash:screen:60', 'rotate:screen:60', 'open:screen:60', 'look:screen:60']);
    expect(m.collections[0]?.fields.map((f) => `${f.key}:${f.kind}:${f.initial}`)).toEqual(['name:text:null', 'key:secret:null', 'loud:boolean:true', 'style:choice:caps']);
    expect(m.views.map((v) => `${v.id}:${v.type}`)).toEqual(['shout.settings:list', 'shout.more:tabs']);
    expect(extensionAsks(m)).toEqual({
      collections: ['Settings', 'Log'],
      secrets: ['Settings: Key'],
      egress: ['api.shout.example', '*.cdn.example'],
      points: [
        { action: 'Louder', on: 'block' },
        { action: 'Louder title', on: 'page' },
        { action: 'Stamp', on: 'page' },
      ],
      routes: [],
      jobs: [],
      events: [],
      pictures: ['Look'],
    });
    expect(extensionWord(m, 'ro', 'Louder')).toBe('Mai tare');
    expect(extensionWord(m, 'ro-MD', 'Settings')).toBe('Setări');
    expect(extensionWord(m, 'de', 'Louder')).toBe('Louder');
  });

  test('that is not one, or asks for what it may not, is refused with every reason', () => {
    expect(parseExtension({ format: 'other' }).problems).toEqual([`this is not an extension (${EXTENSION_FORMAT})`]);
    const bad = parseExtension({
      format: EXTENSION_FORMAT,
      code: '',
      manifest: {
        name: 'Bad Name',
        version: 'one',
        thecmsMinVersion: 'x',
        egress: ['https://x.example/path', 'ok.example'],
        collections: [
          { name: 'rows', fields: [{ key: 'id', kind: 'text' }, { key: 'a', kind: 'colour' }, { key: 'b', kind: 'choice' }, { key: 'B!', kind: 'text' }] },
          { name: 'rows', fields: [{ key: 'a', kind: 'text' }] },
          { name: 'empty', fields: [] },
          { name: 'Nope' },
          'nonsense',
        ],
        actions: [{ name: 'go', on: 'everywhere', reads: ['users'], writes: ['rows'] }, { name: 'go' }, { name: 'each', on: 'block', each: 'language' }, { name: 'no-dash' }, 7],
        views: [{ spec: 'thecms.view/1', id: 'bad.users', title: 'Users', type: 'list', collection: 'users' }],
      },
    });
    expect(bad.pkg).toBeNull();
    expect(bad.problems).toEqual([
      'an extension\'s name is lower case letters, digits and - ("Bad Name")',
      'its version is like 1.0.0 ("one")',
      'thecmsMinVersion is like 0.1.0 ("x")',
      '"https://x.example/path" is not a host name it may call',
      'rows.id: a field\'s key is used once, and never "id"',
      'rows.a: a field is one of text, longtext, number, boolean, choice, secret, url',
      'rows.b: a choice needs its options',
      'rows: a field\'s key is lower case letters, digits and _ ("B!")',
      'the collection "rows" is declared twice',
      'empty: a collection has at least one field',
      'a collection\'s name is lower case letters, digits and _ ("Nope")',
      'go: an action is on block or page, or on its own screen',
      'go: it reads "users", which is not one of its collections',
      'the action "go" is declared twice',
      'each: an action runs for each language only on a page',
      'an action\'s name is letters and digits ("no-dash")',
      'views[0]: "users" is not one of the extension\'s collections',
      'it has actions and no code',
    ]);
  });

  test('may call only the hosts it named; a wildcard covers subdomains, not itself', () => {
    const hosts = ['api.shout.example', '*.cdn.example'];
    expect(egressAllows(hosts, 'api.shout.example')).toBe(true);
    expect(egressAllows(hosts, 'API.Shout.Example')).toBe(true);
    expect(egressAllows(hosts, 'img.cdn.example')).toBe(true);
    expect(egressAllows(hosts, 'cdn.example')).toBe(false);
    expect(egressAllows(hosts, 'shout.example')).toBe(false);
    expect(egressAllows(hosts, 'api.shout.example.evil')).toBe(false);
  });

  test('a row is cleaned by its fields, and a secret is never shown again', () => {
    const of = parseExtension(raw).pkg!.manifest.collections[0]!;
    const first = cleanRow(of, { name: ' Main ', key: 'sk-1', loud: 'yes', style: 'shouting', extra: 'dropped' });
    expect(first).toEqual({ row: { name: 'Main', key: 'sk-1', loud: false, style: null }, problems: [] });
    expect(cleanRow(of, { key: '' }, first.row).row.key).toBe('sk-1');
    expect(cleanRow(of, {}).problems).toEqual(['Name is needed']);
    expect(cleanRow(of, {}).row).toEqual({ name: '', key: '', loud: true, style: 'caps' });
    expect(shownRow(of, first.row)).toEqual({ name: 'Main', key: '••••••', loud: false, style: null });
    expect(shownRow(of, { ...first.row, key: '' }).key).toBe('');
    const numbers = parseExtension(manifest({ collections: [{ name: 'n', fields: [{ key: 'n', kind: 'number', initial: 3 }, { key: 'u', kind: 'url' }, { key: 's', kind: 'secret', initial: 'no' }] }], actions: [], views: [] })).pkg!.manifest.collections[0]!;
    expect(cleanRow(numbers, {}).row).toEqual({ n: 3, u: '', s: '' });
    expect(cleanRow(numbers, { n: '12.5', u: 'https://x.example/v1' }).row).toMatchObject({ n: 12.5, u: 'https://x.example/v1' });
    expect(cleanRow(numbers, { n: 'many', u: 'javascript:alert(1)' })).toEqual({ row: { n: null, u: '', s: '' }, problems: ['u: an address starts with https://'] });
  });
});

describe('an extension installed and run', () => {
  const calls: string[] = [];
  const outbound = async (url: string, init: RequestInit) => {
    calls.push(`${init.method} ${url} ${init.body ?? ''} ${init.redirect}`);
    return new Response('pong', { status: 201 });
  };

  test('is installed only as the file that was accepted, and runs in a process with nothing of the program', async () => {
    const store = await Store.open(':memory:');
    await store.setSite({ name: 'Atelier' });
    const host = extensionHost(store, { fetch: outbound });
    try {
      const offer = await host.offer(PACKAGE);
      expect(offer.replaces).toBeNull();
      expect(describeOffer(offer)).toContain('Shout 1.0.0 by thecms tests\nSays everything louder');
      expect(describeOffer(offer)).toContain('  hold secrets: Settings: Key\n  call api.shout.example, *.cdn.example\n  offer "Louder" on a block in the editor\n  offer "Louder title" on a page in the editor');
      await expect(host.install(PACKAGE, 'another')).rejects.toThrow('not the file that was accepted');
      expect(await store.extensions()).toEqual([]);
      await expect(host.offer('{')).rejects.toThrow('not an extension file');
      await expect(host.offer(JSON.stringify(manifest({ thecmsMinVersion: '99.0.0' })))).rejects.toThrow('needs version 99.0.0 of this program');
      await expect(host.offer(JSON.stringify(manifest({ name: 'X' })))).rejects.toThrow('lower case letters');
      await expect(host.offer('x'.repeat(6 * 1024 * 1024))).rejects.toThrow('at most 5 MB');
      await host.install(PACKAGE, offer.sha256);
      expect((await host.offer(PACKAGE)).replaces).toBe('1.0.0');

      await store.saveExtensionRow('shout', 'settings', { name: 'Main', key: 'sk-secret', loud: true, style: 'caps' });
      expect(await host.run('shout', 'ping', null)).toEqual({ status: 201, body: 'pong', key: 'sk-secret' });
      expect(calls).toEqual(['POST https://api.shout.example/ping Atelier manual']);
      // Its process has no database address, no key, no setting: only PATH.
      expect(await host.run('shout', 'sneak', { how: 'env' })).toEqual({ env: [] });
    } finally {
      host.close();
      await store.close();
    }
  });

  test('reaches only what each action declared, and is stopped when it does not answer', async () => {
    const store = await Store.open(':memory:');
    const host = extensionHost(store, { fetch: outbound });
    try {
      await host.install(PACKAGE, (await host.offer(PACKAGE)).sha256);
      await expect(host.run('shout', 'sneak', { how: 'fetch' })).rejects.toThrow('calls out with host.fetch');
      await expect(host.run('shout', 'sneak', { how: 'elsewhere' })).rejects.toThrow('did not declare that it calls evil.example');
      await expect(host.run('shout', 'sneak', { how: 'http' })).rejects.toThrow('calls out over https');
      await expect(host.run('shout', 'sneak', { how: 'write' })).rejects.toThrow('did not declare that it writes "settings"');
      await expect(host.run('shout', 'sneak', { how: 'undeclared' })).rejects.toThrow('did not declare that it reads "users"');
      await expect(host.run('shout', 'sneak', { how: 'picture' })).rejects.toThrow("did not declare that it sees the site's pictures");
      // An action that declared it sees a picture of the library, and nothing that is not one (ADR 0059 d3).
      const picture = await store.addMedia(PNG, 'dot.png');
      expect(await host.run('shout', 'look', { src: `/media/${picture.name}` })).toEqual({ type: 'image/png', bytes: PNG.length });
      expect(await host.run('shout', 'look', { src: '/media/missing.png' })).toBeNull();
      expect(await host.run('shout', 'look', { src: 'https://elsewhere.example/a.png' })).toBeNull();
      await expect(host.run('shout', 'nothing', null)).rejects.toThrow('has no action "nothing"');
      await expect(host.run('other', 'ping', null)).rejects.toThrow('no extension "other" is installed');
      await expect(host.run('shout', 'slow', null)).rejects.toThrow('did not answer within 1 seconds');
      await expect(host.run('shout', 'crash', null)).rejects.toThrow('stopped while it worked');
      // Stopped or crashed, it starts again when it is next asked.
      expect(await host.run('shout', 'sneak', { how: 'env' })).toEqual({ env: [] });
      await host.enable('shout', false);
      await expect(host.run('shout', 'ping', null)).rejects.toThrow('Shout is turned off');
      await expect(store.enableExtension('other', true)).rejects.toThrow('no extension "other"');
      await host.uninstall('shout');
      expect(await store.extensionRows('shout', 'log')).toEqual([]);
    } finally {
      host.close();
      await store.close();
    }
  }, 20_000);

  test('code that does not start says so', async () => {
    const store = await Store.open(':memory:');
    const host = extensionHost(store);
    try {
      const broken = JSON.stringify({ ...raw, code: 'export const actions = {}; throw new Error("broken on purpose");' });
      await host.install(broken, (await host.offer(broken)).sha256);
      await expect(host.run('shout', 'ping', null)).rejects.toThrow('Shout did not start: broken on purpose');
    } finally {
      host.close();
      await store.close();
    }
  });
});

describe('extensions in the editor', () => {
  test('the owner installs and keeps them; everyone uses what they offer, and gets back something clean', async () => {
    const store = await Store.open(join(dir, 'site.db'));
    await store.setTheme(plain);
    await store.setSite({ name: 'Atelier', languages: ['ro'] });
    const editor = await startEditor(store, { listen: false });
    const call = async (method: string, path: string, body?: unknown, raw = false) => {
      const response = await editor.fetch(
        new Request(`http://127.0.0.1:4321${path}`, {
          method,
          headers: { host: '127.0.0.1:4321', 'x-thecms-token': editor.token, 'content-type': 'application/json' },
          body: body === undefined ? undefined : raw ? String(body) : JSON.stringify(body),
        }),
      );
      return { status: response.status, data: (await response.json()) as Record<string, any> };
    };
    try {
      const offer = (await call('POST', '/api/extensions/offer', PACKAGE, true)).data.offer;
      expect(offer.asks.egress).toEqual(['api.shout.example', '*.cdn.example']);
      expect((await call('POST', '/api/extensions/install?sha256=nope', PACKAGE, true)).data.error).toContain('not the file that was accepted');
      const installed = (await call('POST', `/api/extensions/install?sha256=${offer.sha256}`, PACKAGE, true)).data.extensions;
      expect(installed.map((e: { name: string; enabled: boolean }) => `${e.name} ${e.enabled}`)).toEqual(['shout true']);
      expect((await call('GET', '/api/state')).data.extensions[0].views[0].id).toBe('shout.settings');

      // Its screen: the owner keeps its settings; the secret is never sent back.
      expect((await call('PUT', '/api/extensions/shout/rows/settings', { row: {} })).data.error).toBe('Name is needed');
      const rows = (await call('PUT', '/api/extensions/shout/rows/settings', { row: { name: 'Main', key: 'sk-1', style: 'stars' } })).data.rows;
      expect(rows).toEqual([{ id: expect.any(String), name: 'Main', key: '••••••', loud: true, style: 'stars' }]);
      const id = rows[0].id;
      expect((await call('PUT', '/api/extensions/shout/rows/settings', { id, row: { name: 'Main', key: '' } })).data.rows[0].key).toBe('••••••');
      expect(await store.extensionRow('shout', 'settings', id)).toMatchObject({ key: 'sk-1' });
      expect((await call('PUT', '/api/extensions/shout/rows/settings', { id: 'gone', row: { name: 'x' } })).status).toBe(404);
      // The log is shown, never written by hand: its list offers no form.
      expect((await call('GET', '/api/extensions/shout/rows/log')).data.rows).toEqual([]);
      expect((await call('PUT', '/api/extensions/shout/rows/log', { row: { what: 'x' } })).data.error).toBe('no screen adds these rows');
      expect((await call('GET', '/api/extensions/shout/rows/nothing')).status).toBe(404);
      expect((await call('GET', '/api/extensions/shout/rows/settings')).data.rows).toHaveLength(1);

      // In the editor: what it gives back is a block, with the same id, cleaned by the same rules.
      const block = { id: 'b_hero1', type: 'hero', content: { title: 'Hello', subtitle: 'Made by hand' } };
      const louder = await call('POST', '/api/extensions/shout/run/louder', { block, slug: 'ro/despre' });
      expect(louder.data.block).toMatchObject({ id: 'b_hero1', type: 'hero', content: { title: '*Hello*', subtitle: '*Made by hand*' } });
      expect((await store.extensionRows('shout', 'log')).map((r) => r.what)).toEqual(['louder hero in ro']);
      expect((await call('POST', '/api/extensions/shout/run/louder', { block: { type: 'nonsense' } })).data.error).toBe('there is no block to give it');
      const page = { slug: 'about', title: 'About', blocks: [] };
      expect((await call('POST', '/api/extensions/shout/run/title', { page, ask: { language: 'ro', other: 'dropped' } })).data.page).toMatchObject({ slug: 'about', title: '*About* (ro)' });
      expect((await call('POST', '/api/extensions/shout/run/nothing', {})).status).toBe(404);
      // An action of its own screen: the owner's, its answer as it came.
      expect((await call('POST', '/api/extensions/shout/run/sneak', { input: { how: 'env' } })).data.answer).toEqual({ env: [] });
      expect((await call('GET', '/api/extensions/other')).status).toBe(404);

      await call('PUT', '/api/extensions/shout', { enabled: false });
      expect((await call('POST', '/api/extensions/shout/run/louder', { block })).data.error).toBe('Shout is turned off');
      expect((await call('DELETE', '/api/extensions/shout/rows/settings?id=' + id)).data.rows).toEqual([]);
      expect((await call('DELETE', '/api/extensions/shout')).data.extensions).toEqual([]);
      expect((await call('PATCH', '/api/extensions')).status).toBe(404);
    } finally {
      editor.stop();
      await store.close();
    }
  }, 20_000);
});

describe('on a server', () => {
  test('each extension runs where systemd starts it for a connection to the socket, and talks over it', async () => {
    // As systemd does with Accept=yes: a runner for each connection, its standard input and output the connection.
    const path = join(dir, 'runner.sock');
    const runners: Bun.Subprocess[] = [];
    const listener = Bun.listen<{ child: Bun.Subprocess<'pipe', 'pipe', 'inherit'> }>({
      unix: path,
      socket: {
        open(socket) {
          const child = Bun.spawn([process.execPath, join(import.meta.dir, '..', 'src', 'site', 'extension-runner.ts')], { stdin: 'pipe', stdout: 'pipe', stderr: 'inherit', env: { PATH: process.env.PATH ?? '' } });
          runners.push(child);
          socket.data = { child };
          void (async () => {
            for await (const chunk of child.stdout) socket.write(chunk);
            socket.end();
          })();
        },
        data(socket, chunk) {
          socket.data.child.stdin.write(chunk);
          socket.data.child.stdin.flush();
        },
        close(socket) {
          socket.data?.child.stdin.end();
        },
      },
    });
    const store = await Store.open(':memory:');
    const host = extensionHost(store, { spawn: socketRunner(path), fetch: async () => new Response('pong') });
    try {
      await host.install(PACKAGE, (await host.offer(PACKAGE)).sha256);
      await store.saveExtensionRow('shout', 'settings', { name: 'Main', key: 'k', loud: true, style: 'caps' });
      expect(await host.run('shout', 'ping', null)).toEqual({ status: 200, body: 'pong', key: 'k' });
      expect(await host.run('shout', 'sneak', { how: 'env' })).toEqual({ env: [] });
      await expect(host.run('shout', 'crash', null)).rejects.toThrow('stopped while it worked');
      expect(runners).toHaveLength(1);
      expect(await host.run('shout', 'sneak', { how: 'env' })).toEqual({ env: [] });
      expect(runners).toHaveLength(2);
      // Nobody listening: it says so, and does not hang.
      const nowhere = extensionHost(store, { spawn: socketRunner(join(dir, 'nowhere.sock')) });
      await expect(nowhere.run('shout', 'ping', null)).rejects.toThrow('Shout stopped');
      nowhere.close();
    } finally {
      host.close();
      listener.stop(true);
      await store.close();
    }
  }, 20_000);
});

describe('the command line', () => {
  test('says what an extension asks for, installs it only with --yes, and lists, turns off and removes it', async () => {
    const { main } = await import('../src/site/cli.ts');
    const said: string[] = [];
    const log = spyOn(console, 'log').mockImplementation((...words: unknown[]) => void said.push(words.join(' ')));
    try {
      const db = join(dir, 'cli.db');
      await main(['init', db]);
      await expect(main(['extension', join(dir, 'none.db'), 'list'])).rejects.toThrow('does not exist');
      await main(['extension', db, 'list']);
      expect(said.at(-1)).toBe('No extensions are installed.');
      await main(['extension', db, 'install', file]);
      expect(said.at(-2)).toContain('call api.shout.example, *.cdn.example');
      expect(said.at(-1)).toContain('Nothing was installed');
      await main(['extension', db, 'install', file, '--yes']);
      expect(said.at(-1)).toBe('Installed Shout 1.0.0.');
      await main(['extension', db, 'off', 'shout']);
      await main(['extension', db, 'list']);
      expect(said.at(-1)).toBe('shout 1.0.0 (off)');
      await expect(main(['extension', db, 'on', 'other'])).rejects.toThrow('no extension "other"');
      await expect(main(['extension', db, 'fly'])).rejects.toThrow('unknown: extension fly');
      await main(['extension', db, 'remove', 'shout']);
      expect(said.at(-1)).toBe('Removed shout and what it kept.');
    } finally {
      log.mockRestore();
    }
  });
});

describe('who may do what with extensions', () => {
  test('an editor uses what the extensions offer in the editor; installing and their screens stay with the owner', async () => {
    const store = await Store.open(':memory:');
    await store.setTheme(plain);
    const host = extensionHost(store);
    await host.install(PACKAGE, (await host.offer(PACKAGE)).sha256);
    host.close();
    await store.saveExtensionRow('shout', 'settings', { name: 'Main', key: 'k', loud: true, style: 'caps' });
    const editor = await startEditor(store, { listen: false, public: 'https://cms.example.com' });
    const ion = await store.addUser({ email: 'ion@example.com', role: 'editor', password: 'a long password' });
    const cookie = `thecms_session=${await store.startSession(ion.id)}`;
    const call = async (method: string, path: string, body?: unknown) => {
      const response = await editor.fetch(
        new Request(`https://cms.example.com${path}`, {
          method,
          headers: { host: 'cms.example.com', origin: 'https://cms.example.com', 'x-thecms-request': '1', cookie, 'content-type': 'application/json' },
          body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
        }),
      );
      return { status: response.status, data: (await response.json()) as Record<string, any> };
    };
    try {
      const seen = (await call('GET', '/api/extensions')).data.extensions[0];
      expect(seen.actions.map((a: { name: string }) => a.name)).toEqual(['louder', 'title', 'stamp']);
      expect(seen.actions[2].each).toBe('language');
      // A section's translations are the owner's to change.
      expect((await call('POST', '/api/extensions/shout/each/stamp', { slug: 'offer', kind: '_section' })).status).toBe(403);
      expect(seen.sha256).toBeUndefined();
      expect(seen.views).toBeUndefined();
      expect((await call('POST', '/api/extensions/shout/run/louder', { block: { id: 'b_x1', type: 'hero', content: { title: 'Hi' } } })).data.block.content.title).toBe('HI');
      for (const [method, path, body] of [
        ['POST', '/api/extensions/shout/run/ping', {}],
        ['GET', '/api/extensions/shout/rows/settings', undefined],
        ['PUT', '/api/extensions/shout', { enabled: false }],
        ['DELETE', '/api/extensions/shout', undefined],
        ['POST', '/api/extensions/offer', PACKAGE],
      ] as const) {
        expect((await call(method, path, body)).status).toBe(403);
      }
      await store.enableExtension('shout', false);
      expect((await call('GET', '/api/extensions')).data.extensions).toEqual([]);
    } finally {
      editor.stop();
      await store.close();
    }
  }, 20_000);
});

describe('the runner', () => {
  test('loads the code, runs an action, and passes each of its calls to the program and back', async () => {
    const { runner, lines } = await import('../src/site/extension-runner.ts');
    const sent: FromRunner[] = [];
    let deliver: (message: ToRunner) => void = () => {};
    const next = async (t: string): Promise<FromRunner> => {
      for (let i = 0; i < 200; i++) {
        const found = sent.find((m) => m.t === t);
        if (found) {
          sent.splice(sent.indexOf(found), 1);
          return found;
        }
        await Bun.sleep(5);
      }
      throw new Error(`no ${t}`);
    };
    const realFetch = globalThis.fetch;
    try {
      runner(
        (message) => void sent.push(message),
        (handler) => (deliver = handler),
      );
      deliver({ t: 'load', code: 'export const actions = { go: async (input, host) => [await host.site(), await host.collections.read("c", "1").catch((e) => e.message)], quiet: async () => undefined };' });
      expect(await next('loaded')).toEqual({ t: 'loaded', actions: ['go', 'quiet'] });
      deliver({ t: 'run', id: 7, action: 'go', input: null });
      const ask = (await next('ask')) as Extract<FromRunner, { t: 'ask' }>;
      expect(ask).toMatchObject({ run: 7, method: 'site', args: [] });
      deliver({ t: 'answer', id: ask.id, ok: true, value: { name: 'S' } });
      const second = (await next('ask')) as Extract<FromRunner, { t: 'ask' }>;
      expect(second).toMatchObject({ method: 'read', args: ['c', '1'] });
      deliver({ t: 'answer', id: second.id, ok: false, error: 'not declared' });
      expect(await next('done')).toEqual({ t: 'done', id: 7, ok: true, value: [{ name: 'S' }, 'not declared'] });
      deliver({ t: 'run', id: 8, action: 'quiet', input: null });
      expect(await next('done')).toEqual({ t: 'done', id: 8, ok: true, value: null });
      deliver({ t: 'run', id: 9, action: 'missing', input: null });
      expect(await next('done')).toEqual({ t: 'done', id: 9, ok: false, error: 'the extension has no action "missing"' });
      deliver({ t: 'load', code: 'export const actions = {}; throw "plain";' });
      expect(await next('loaded')).toEqual({ t: 'loaded', error: 'plain' });
      deliver({ t: 'load', code: 'export const actions = { boom: () => { throw "plain"; } };' });
      await next('loaded');
      deliver({ t: 'run', id: 10, action: 'boom', input: null });
      expect(await next('done')).toEqual({ t: 'done', id: 10, ok: false, error: 'plain' });
      deliver({ t: 'load', code: 'export const nothing = 1;' });
      expect(await next('loaded')).toEqual({ t: 'loaded', actions: [] });
    } finally {
      globalThis.fetch = realFetch;
    }
    // Lines of JSON, however the stream cuts them.
    const got: unknown[] = [];
    const read = lines((message) => got.push(message));
    read('{"a":1}\n{"b"');
    read(new TextEncoder().encode(':2}\n\n'));
    expect(got).toEqual([{ a: 1 }, { b: 2 }]);
  });

  test('talks over the program\'s channel, or over standard input and output', async () => {
    const { startRunner } = await import('../src/site/extension-runner.ts');
    const realFetch = globalThis.fetch;
    const realLog = console.log;
    try {
      // The program's channel.
      const channel = new EventEmitter();
      const got: unknown[] = [];
      let exited = -1;
      Object.assign(channel, { send: (m: unknown) => got.push(m) > 0, exit: (code: number) => (exited = code) as never, stdin: new EventEmitter(), stdout: { write: () => true }, stderr: { write: () => true } });
      startRunner(channel as never);
      channel.emit('message', { t: 'load', code: 'export const actions = {};' });
      for (let i = 0; i < 100 && got.length === 0; i++) await Bun.sleep(5);
      expect(got).toEqual([{ t: 'loaded', actions: [] }]);
      channel.emit('disconnect');
      expect(exited).toBe(0);

      // Standard input and output: what the code prints goes elsewhere.
      const stdin = new EventEmitter();
      const out: string[] = [];
      const err: string[] = [];
      const io = { send: undefined, on: () => io, exit: (code: number) => (exited = code) as never, stdin, stdout: { write: (s: string) => out.push(s) > 0 }, stderr: { write: (s: string) => err.push(s) > 0 } };
      exited = -1;
      startRunner(io as never);
      stdin.emit('data', `${JSON.stringify({ t: 'load', code: 'export const actions = { say: async () => { console.log("printed"); return 1; } };' })}\n`);
      for (let i = 0; i < 100 && out.length === 0; i++) await Bun.sleep(5);
      stdin.emit('data', `${JSON.stringify({ t: 'run', id: 1, action: 'say', input: null })}\n`);
      for (let i = 0; i < 100 && out.length < 2; i++) await Bun.sleep(5);
      expect(out.map((line) => JSON.parse(line))).toEqual([{ t: 'loaded', actions: ['say'] }, { t: 'done', id: 1, ok: true, value: 1 }]);
      (io.stdout.write as (s: string) => boolean)('stray');
      expect(err).toEqual(['stray']);
      stdin.emit('end');
      expect(exited).toBe(0);
    } finally {
      globalThis.fetch = realFetch;
      console.log = realLog;
    }
  });

  test('a folder is packed only when it is an extension', async () => {
    const empty = join(dir, 'data-only');
    await Bun.write(join(empty, 'manifest.json'), JSON.stringify({ name: 'data-only', version: '1.0.0', collections: [{ name: 'notes', fields: [{ key: 'text', kind: 'text' }] }] }));
    const said: string[] = [];
    await packCommand([empty], (line) => void said.push(line));
    expect(said[0]).toEndWith(join(empty, 'data-only-1.0.0.thecms-extension'));
    expect(JSON.parse(await Bun.file((await packExtension(empty)).file).text()).code).toBe('');
    await expect(packCommand([])).rejects.toThrow('usage');
    const broken = join(dir, 'broken');
    await Bun.write(join(broken, 'manifest.json'), JSON.stringify({ name: 'broken', version: '1.0.0', actions: [{ name: 'go' }] }));
    await Bun.write(join(broken, 'index.ts'), 'export const actions = { go: ( };');
    await expect(packExtension(broken)).rejects.toThrow();
    await Bun.write(join(broken, 'index.ts'), 'export const actions = {};');
    await Bun.write(join(broken, 'manifest.json'), JSON.stringify({ name: 'Broken', version: '1.0.0' }));
    await expect(packExtension(broken)).rejects.toThrow('lower case letters');
    // A screen that is not thecms.view/1, or names what is not there, is refused before it is packed.
    const screen = { spec: 'thecms.view/1', id: 'data-only.notes', title: 'Notes', type: 'list', collection: 'notes' };
    await Bun.write(join(empty, 'manifest.json'), JSON.stringify({ name: 'data-only', version: '1.0.0', collections: [{ name: 'notes', fields: [{ key: 'text', kind: 'text' }] }], views: [{ ...screen, fields: ['colour'] }] }));
    await expect(packExtension(empty)).rejects.toThrow('"notes" has no field "colour"');
    await Bun.write(join(empty, 'manifest.json'), JSON.stringify({ name: 'data-only', version: '1.0.0', collections: [{ name: 'notes', fields: [{ key: 'text', kind: 'text' }] }], views: [{ ...screen, css: 'red' }] }));
    await expect(packExtension(empty)).rejects.toThrow('"css" is not part of thecms.view/1');
  });
});
