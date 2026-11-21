/**
 * The command line, run in this process: each command on a real file, checked
 * by what it wrote and what it said.
 */
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../src/site/cli.ts';
import { Store } from '../src/site/store.ts';

let dir: string;
let said: string[];
let log: ReturnType<typeof spyOn>;
const run = async (...args: string[]) => {
  said = [];
  return main(args);
};

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'thecms-cli-'));
  log = spyOn(console, 'log').mockImplementation((...words: unknown[]) => void said.push(words.join(' ')));
  process.exitCode = 0;
});
afterEach(async () => {
  log.mockRestore();
  process.exitCode = 0;
  await rm(dir, { recursive: true, force: true });
});

describe('the command line', () => {
  test('check-database says whether a database answers, without printing its password (ADR 0048 d2)', async () => {
    await run('check-database', join(dir, 'tried.db'));
    expect(said.join('\n')).toBe(`${join(dir, 'tried.db')} answers; the site can live there.`);
    await expect(run('check-database', 'postgres://ana:secret@127.0.0.1:1/shop')).rejects.toThrow(/^postgres:\/\/ana:\*\*\*@127\.0\.0\.1:1\/shop does not answer: /);
  });

  test('init makes a sample site once, and export writes it as files', async () => {
    const db = join(dir, 'site.db');
    await run('init', db);
    expect(said.join('\n')).toMatch(/^Created .*site\.db with \d+ pages and \d+ blog posts\.$/);
    await expect(run('init', db)).rejects.toThrow('already exists');
    await run('export', db, join(dir, 'out'));
    expect(said.join('\n')).toMatch(/^Wrote \d+ files to /);
    expect(await readFile(join(dir, 'out', 'index.html'), 'utf8')).toContain('<h1>Solid wood furniture, made to measure</h1>');
  });

  // A file that exists is refused before it is opened; a database server is opened and looked into.
  test.skipIf(!process.env.THECMS_TEST_POSTGRES)('a database that already holds a site is not filled again', async () => {
    const address = process.env.THECMS_TEST_POSTGRES as string;
    const clear = async () => {
      const store = await Store.open(address);
      for (const table of ['meta', 'pages', 'entries', 'media', 'messages', 'users', 'sessions', 'links']) await store.rawForTests(`DROP TABLE IF EXISTS ${table}`);
      await store.close();
    };
    await clear();
    try {
      await run('init', address);
      expect(said.join('\n')).not.toContain('pw@');
      await expect(run('init', address)).rejects.toThrow('already holds a site');
    } finally {
      await clear();
    }
  });

  test('theme sets and publishes a theme from a file', async () => {
    const db = join(dir, 'site.db');
    await run('init', db);
    await run('theme', db, join(import.meta.dir, '..', 'themes', 'studio.json'));
    expect(said.join('\n')).toMatch(/^Theme is now ".+"\.$/);
  });

  test('a site that does not exist is not opened, and nothing is created', async () => {
    const db = join(dir, 'none.db');
    for (const args of [['edit', db], ['forms', db], ['export', db, join(dir, 'out')], ['theme', db, 'x.json']]) await expect(run(...args)).rejects.toThrow('does not exist');
    await expect(run('import', db, join(dir, 'none.xml'))).rejects.toThrow('does not exist');
    expect(existsSync(db)).toBe(false);
  });

  test('import brings a WordPress export in, with what to know', async () => {
    const db = join(dir, 'wp.db');
    await run('import', db, join(import.meta.dir, 'fixtures', 'wordpress.xml'), '--no-images', '--types=portfolio', '--categories=');
    const out = said.join('\n');
    expect(out).toMatch(/Imported \d+ pages, \d+ posts/);
    expect(out).toContain('Next: thecms edit');
    const store = await Store.open(db);
    try {
      expect((await store.published()).length).toBeGreaterThan(0);
    } finally {
      await store.close();
    }
  });

  test('edit and forms start their servers and say where', async () => {
    const db = join(dir, 'site.db');
    await run('init', db);
    const editor = await run('edit', db, '0');
    try {
      expect(said.join('\n')).toMatch(/http:\/\/127\.0\.0\.1:\d+\/admin\/#token=\w+/);
    } finally {
      editor?.stop();
    }
    const forms = await run('forms', db, '0');
    try {
      expect(said.join('\n')).toContain('Set THECMS_SMTP and THECMS_MAIL_TO to be told by email.');
    } finally {
      forms?.stop();
    }
    process.env.THECMS_SMTP = 'smtp://127.0.0.1:2525';
    process.env.THECMS_MAIL_TO = 'owner@example.com';
    try {
      const told = await run('forms', db, '0');
      told?.stop();
      expect(said.join('\n')).toContain('Each message is also sent to owner@example.com.');
    } finally {
      delete process.env.THECMS_SMTP;
      delete process.env.THECMS_MAIL_TO;
    }
  });

  test('run serves the published site and says how forms reach it', async () => {
    const db = join(dir, 'site.db');
    await run('init', db);
    await expect(run('run', join(dir, 'none.db'))).rejects.toThrow('does not exist');
    const runtime = await run('run', db, '--port=0');
    try {
      expect(said.join('\n')).toContain('this command serves it without the editor');
      expect(said.join('\n')).toContain('Set THECMS_SMTP and THECMS_MAIL_TO to be told by email.');
      const page = await fetch(`${(runtime as unknown as { url: string }).url}/`);
      expect(await page.text()).toContain('<h1>Solid wood furniture, made to measure</h1>');
    } finally {
      runtime?.stop();
    }
    process.env.THECMS_SMTP = 'smtp://127.0.0.1:2525';
    process.env.THECMS_MAIL_TO = 'owner@example.com';
    try {
      const told = await run('run', db, '--port=0');
      told?.stop();
      expect(said.join('\n')).toContain('Each message is also sent to owner@example.com.');
    } finally {
      delete process.env.THECMS_SMTP;
      delete process.env.THECMS_MAIL_TO;
    }
  });

  test('help shows how to use it; an unknown command also does, and fails', async () => {
    await run('help');
    expect(said.join('\n')).toContain('Usage:');
    await run('--help');
    expect(said.join('\n')).toContain('Usage:');
    expect(process.exitCode).toBe(0);
    await run('nonsense');
    expect(said.join('\n')).toContain('Usage:');
    expect(process.exitCode).toBe(1);
    await run('version');
    expect(said.join('\n')).toMatch(/^thecms \d+\.\d+\.\d+/);
  });

  test('without a command, the site here is made if new and opened in the editor, or served with accounts', async () => {
    const site = join(dir, 'here.db');
    process.env.THECMS_SITE = site;
    try {
      const editor = await run('--port=0');
      editor?.stop();
      expect(said.join('\n')).toContain('with 3 sample pages');
      expect(said.join('\n')).toMatch(/#token=\w+/);
      const again = await run('--port=0');
      again?.stop();
      expect(said.join('\n')).not.toContain('sample pages');
      process.env.THECMS_PUBLIC = 'https://cms.example.com';
      const served = await run('--port=0');
      served?.stop();
      expect(said.join('\n')).toMatch(/https:\/\/cms\.example\.com\/admin\/#link=[\w-]+/);
      // While there is no owner, a new link can be had without starting it again; with one, not.
      await run('setup-link', site, '--public=https://cms.example.com');
      expect(said.join('\n')).toMatch(/within the hour[^\n]*\n\n {2}https:\/\/cms\.example\.com\/admin\/#link=[\w-]+$/);
      await expect(run('setup-link', site)).rejects.toThrow('--public=');
      await expect(run('setup-link', join(dir, 'none.db'), '--public=https://cms.example.com')).rejects.toThrow('does not exist');
      const store = await Store.open(site);
      await store.addUser({ email: 'ana@example.com', role: 'owner', password: 'a long enough password' });
      await store.close();
      await expect(run('setup-link', site, '--public=https://cms.example.com')).rejects.toThrow('has an owner');
    } finally {
      delete process.env.THECMS_SITE;
      delete process.env.THECMS_PUBLIC;
    }
  });

  test('init --if-new leaves a site that is there as it is', async () => {
    const db = join(dir, 'site.db');
    await run('init', db, '--if-new');
    expect(said.join('\n')).toContain('Created');
    await run('init', db, '--if-new');
    expect(said.join('\n')).toContain('already holds a site; it was left as it is');
  });

  test('update says it runs from the sources, and never replaces them', async () => {
    const real = globalThis.fetch;
    globalThis.fetch = (async () => Response.json([{ tag_name: 'v999.0.0' }])) as unknown as typeof fetch;
    try {
      await run('update', '--check');
      expect(said.join('\n')).toContain('999.0.0 is out');
      await expect(run('update')).rejects.toThrow('runs from the sources');
    } finally {
      globalThis.fetch = real;
    }
  });
});
