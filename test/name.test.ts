/**
 * The name (ADR 0066): what was made as thecms is read as it would be
 * written now, and only the new name is written.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { DISPLAY_NAME, fromOldName, NAME, parseExtension, parseTheme } from '../src/core/index.ts';
import { isContentFile, readContentFile } from '../src/import/uhlaka.ts';
import { backupHeader, isBackupName } from '../src/site/backup.ts';

const asThecms = (text: string): string => text.replaceAll('uhlaka.', 'thecms.').replaceAll('uhlakaMinVersion', 'thecmsMinVersion');

describe('the name (ADR 0066)', () => {
  test('is uhlaka in commands and files, Uhlaka to read', () => {
    expect(NAME).toBe('uhlaka');
    expect(DISPLAY_NAME).toBe('Uhlaka');
  });

  test('an old format is the new one; other words are left as they are', () => {
    expect(fromOldName('thecms.content/1')).toBe('uhlaka.content/1');
    expect(fromOldName<unknown>({ format: 'thecms.extension/3', manifest: { thecmsMinVersion: '0.1.0', note: 'thecms is fine' } })).toEqual({
      format: 'uhlaka.extension/3',
      manifest: { uhlakaMinVersion: '0.1.0', note: 'thecms is fine' },
    });
    expect(fromOldName(['thecms.view/1', 'thecms.view', 3, null])).toEqual(['uhlaka.view/1', 'thecms.view', 3, null]);
  });

  test('an extension packed as thecms installs, screens and all', () => {
    const text = readFileSync(resolve(import.meta.dir, '../extensions/stats/stats.uhlaka-extension'), 'utf8');
    const old = asThecms(text);
    expect(old).toContain('"thecms.extension/3"');
    const { pkg, problems } = parseExtension(JSON.parse(old));
    expect(problems).toEqual([]);
    expect(pkg?.manifest.uhlakaMinVersion).toBe('0.1.0');
    expect(pkg?.manifest.views?.[0]?.spec).toBe('uhlaka.view/1');
  });

  test('a theme written as thecms is a theme', () => {
    const theme = JSON.parse(readFileSync(resolve(import.meta.dir, '../themes/plain.json'), 'utf8')) as Record<string, unknown>;
    expect(parseTheme({ ...theme, spec: 'thecms.theme/1' }).issues).toEqual([]);
  });

  test('a content file made as thecms is read back', () => {
    const old = '{"format":"thecms.content/1","program":"thecms 0.1.0-alpha.2","madeAt":"2026-11-20","parts":["pages"],"from":{"name":"Old"},"types":[],"people":[],"comments":[],"media":[]}';
    expect(isContentFile(old)).toBe(true);
    expect(readContentFile(old)).toMatchObject({ format: 'uhlaka.content/1', from: { name: 'Old' } });
  });

  test('a backup made as thecms is a backup, by its name and by its header', async () => {
    expect(isBackupName('daily-2026-11-20-0300.thecms-backup')).toBe(true);
    expect(isBackupName('daily-2026-11-20-0300.uhlaka-backup')).toBe(true);
    expect(isBackupName('daily.backup')).toBe(false);
    const file = join(await mkdtemp(join(tmpdir(), 'uhlaka-name-')), 'old.thecms-backup');
    writeFileSync(file, gzipSync('{"format":"thecms.backup/1","version":"0.1.0-alpha.2","at":"2026-11-20T03:00:00Z","database":"sqlite"}\n'));
    expect(await backupHeader(file)).toMatchObject({ format: 'thecms.backup/1', version: '0.1.0-alpha.2' });
  });

  test('THECMS_ in the environment stands for UHLAKA_, unless that is given', async () => {
    process.env.THECMS_NAME_TEST_A = 'old';
    process.env.THECMS_NAME_TEST_B = 'old';
    process.env.UHLAKA_NAME_TEST_B = 'new';
    await import(`../src/site/old-env.ts?${Date.now()}`);
    expect(process.env.UHLAKA_NAME_TEST_A).toBe('old');
    expect(process.env.UHLAKA_NAME_TEST_B).toBe('new');
  });
});
