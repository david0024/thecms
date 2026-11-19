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

  test('without a command it shows how to use it; with an unknown one it also fails', async () => {
    await run();
    expect(said.join('\n')).toContain('Usage:');
    expect(process.exitCode).toBe(0);
    await run('nonsense');
    expect(process.exitCode).toBe(1);
  });
});
