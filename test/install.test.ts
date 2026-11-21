/**
 * Installing (ADR 0023): the program built as one file, the install script
 * that puts it in place only when its checksum matches, and `update`, which
 * replaces it with a newer release the same way.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NAME, REPOSITORY } from '../src/core/index.ts';
import { SHIPPED_LANGUAGES, SHIPPED_THEMES } from '../src/site/shipped.ts';
import { isCompiled, newer, platformName, releaseFile, update } from '../src/site/update.ts';
import { VERSION } from '../src/site/version.ts';
import { build, PLATFORMS } from '../tools/build.ts';

const root = new URL('..', import.meta.url).pathname;
const dir = await mkdtemp(join(tmpdir(), 'thecms-install-'));
afterAll(() => rm(dir, { recursive: true, force: true }));

const sha256 = (bytes: Uint8Array | string): string => new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
const sh = (args: string[], env: Record<string, string> = {}) => {
  const run = Bun.spawnSync(['sh', ...args], { cwd: root, env: { PATH: process.env.PATH ?? '', HOME: dir, ...env } });
  return { code: run.exitCode, out: run.stdout.toString(), err: run.stderr.toString() };
};

test('what ships inside the program is every theme and language pack in their folders', async () => {
  expect(Object.keys(SHIPPED_THEMES).sort()).toEqual((await readdir(join(root, 'themes'))).filter((f) => f.endsWith('.json')).sort());
  expect(Object.keys(SHIPPED_LANGUAGES).sort()).toEqual((await readdir(join(root, 'languages'))).filter((f) => f.endsWith('.json')).sort());
});

test('the install scripts name the product as src/core/name.ts does', async () => {
  const shell = await readFile(join(root, 'install.sh'), 'utf8');
  const power = await readFile(join(root, 'install.ps1'), 'utf8');
  expect(shell).toContain(`\nNAME=${NAME}\n`);
  expect(shell).toContain(`\nREPOSITORY=${REPOSITORY}\n`);
  expect(power).toContain(`$Name = '${NAME}'`);
  expect(power).toContain(`$Repository = '${REPOSITORY}'`);
  expect(PLATFORMS.map(releaseFile)).toContain(`${NAME}-windows-x64.exe`);
});

describe('the install script', () => {
  test('refuses what it cannot do before it downloads anything', () => {
    expect(sh(['install.sh', '--nonsense']).err).toContain('unknown option --nonsense');
    expect(sh(['install.sh', '--server']).err).toContain('--server needs the address people will open');
    expect(sh(['install.sh', '--server', '--public=http://cms.example.com']).err).toContain('--server needs the address');
  });

  test('installs a file only when it matches the checksum the release lists', async () => {
    const release = join(dir, 'release');
    await mkdir(release, { recursive: true });
    const file = releaseFile(platformName());
    const program = `#!/bin/sh\necho "${NAME} 9.9.9"\n`;
    await writeFile(join(release, file), program);
    await writeFile(join(release, 'checksums.sha256'), `${sha256(program)}  ${file}\n`);
    const bin = join(dir, 'bin');
    const good = sh(['install.sh'], { RELEASE_URL: `file://${release}`, INSTALL_DIR: bin });
    expect(good.err).toBe('');
    expect(good.out).toContain(`Installed ${NAME} 9.9.9 in ${bin}.`);
    expect(good.out).toContain(`Add ${bin} to your PATH`);

    await writeFile(join(release, file), `${program}# changed\n`);
    await rm(bin, { recursive: true });
    const bad = sh(['install.sh'], { RELEASE_URL: `file://${release}`, INSTALL_DIR: bin });
    expect(bad.code).not.toBe(0);
    expect(bad.err).toContain('does not match its checksum; nothing was installed');
    expect(await Bun.file(join(bin, NAME)).exists()).toBe(false);

    await writeFile(join(release, 'checksums.sha256'), `${sha256('x')}  another-file\n`);
    expect(sh(['install.sh'], { RELEASE_URL: `file://${release}`, INSTALL_DIR: bin }).err).toContain('lists no checksum');
    expect(sh(['install.sh'], { RELEASE_URL: `file://${join(dir, 'nowhere')}`, INSTALL_DIR: bin }).err).toContain('could not download');
  });
});

describe('update', () => {
  const file = releaseFile('linux-x64');
  const program = new TextEncoder().encode('the new program');
  /** A release on GitHub, as fetch sees it. */
  const releases = (tag: string, sums = `${sha256(program)}  ${file}\n`) => async (url: string): Promise<Response> => {
    if (url.endsWith('/releases?per_page=1')) return Response.json(tag ? [{ tag_name: tag }] : []);
    if (url.endsWith(`/${tag}/checksums.sha256`)) return new Response(sums);
    if (url.endsWith(`/${tag}/${file}`)) return new Response(program);
    return new Response('not found', { status: 404 });
  };
  const said: string[] = [];
  const say = (line: string) => void said.push(line);

  test('puts a newer release in place of the program, checked', async () => {
    const executable = join(dir, 'program');
    await writeFile(executable, 'the old program');
    await chmod(executable, 0o755);
    expect(await update({ fetch: releases('v1.0.0'), current: '0.9.0', compiled: true, executable, platform: 'linux-x64', say })).toBe('updated');
    expect(await Bun.file(executable).text()).toBe('the new program');
    expect(said.at(-2)).toContain('is now 1.0.0 (it was 0.9.0)');
    // The program it replaced is kept, to go back to.
    expect(await Bun.file(`${executable}.previous`).text()).toBe('the old program');
    expect(said.at(-1)).toContain('0.9.0 is kept as');
    expect(await Bun.file(`${executable}.old`).exists()).toBe(false);
  });

  test('changes nothing when the download does not match, or there is nothing newer', async () => {
    const executable = join(dir, 'kept');
    await writeFile(executable, 'the old program');
    const options = { current: '0.9.0', compiled: true, executable, platform: 'linux-x64', say };
    await expect(update({ ...options, fetch: releases('v1.0.0', `${sha256('something else')}  ${file}\n`) })).rejects.toThrow('does not match its checksum');
    await expect(update({ ...options, fetch: releases('v1.0.0', 'abc  other-file\n') })).rejects.toThrow('has nothing for');
    await expect(update({ ...options, fetch: releases('') })).rejects.toThrow('has no version');
    await expect(update({ ...options, fetch: async () => new Response('', { status: 503 }) })).rejects.toThrow('answered 503');
    expect(await update({ ...options, fetch: releases('v0.9.0') })).toBe('newest');
    expect(await update({ ...options, fetch: releases('v1.0.0'), check: true })).toBe('available');
    expect(said.at(-1)).toContain('1.0.0 is out; this is 0.9.0');
    await expect(update({ ...options, fetch: releases('v1.0.0'), compiled: false })).rejects.toThrow('runs from the sources');
    expect(await Bun.file(executable).text()).toBe('the old program');
  });

  test('knows versions, platforms and whether it runs as the single file', () => {
    expect(newer('v1.2.10', '1.2.9')).toBe(true);
    expect(newer('1.2.9', '1.2.10')).toBe(false);
    expect(newer('1.3', '1.3.0')).toBe(false);
    expect(newer('2.0.0-rc.1', '1.9.9')).toBe(true);
    // Pre-releases come before their release and after one another (ADR 0045).
    expect(newer('0.1.0', '0.1.0-alpha.1')).toBe(true);
    expect(newer('0.1.0-alpha.1', '0.1.0')).toBe(false);
    expect(newer('0.1.0-alpha.2', '0.1.0-alpha.1')).toBe(true);
    expect(newer('0.1.0-alpha.10', '0.1.0-alpha.9')).toBe(true);
    expect(newer('0.1.0-beta.1', '0.1.0-alpha.7')).toBe(true);
    expect(newer('0.1.0-alpha.1', '0.1.0-alpha')).toBe(true);
    expect(newer('0.1.0-alpha.1', '0.1.0-alpha.1')).toBe(false);
    expect(platformName('win32', 'x64')).toBe('windows-x64');
    expect(platformName('darwin', 'arm64')).toBe('darwin-arm64');
    expect(releaseFile('linux-arm64')).toBe(`${NAME}-linux-arm64`);
    expect(isCompiled('/$bunfs/root/thecms')).toBe(true);
    expect(isCompiled('B:\\~BUN\\root\\thecms.exe')).toBe(true);
    expect(isCompiled()).toBe(false);
  });
});

test('the program builds as one file that runs on its own, away from the sources', async () => {
  const out = join(dir, 'build');
  const [line] = await build(out, ['linux-x64']);
  const file = join(out, releaseFile('linux-x64'));
  expect(line).toBe(`${sha256(await Bun.file(file).bytes())}  ${releaseFile('linux-x64')}`);
  expect(await Bun.file(join(out, 'checksums.sha256')).text()).toBe(`${line}\n`);
  if (platformName() !== 'linux-x64') return;
  // Run somewhere with no sources: what it needs is inside it.
  const away = join(dir, 'away');
  await mkdir(away);
  const run = (...args: string[]) => Bun.spawnSync([file, ...args], { cwd: away, env: { PATH: process.env.PATH ?? '' } });
  expect(run('version').stdout.toString().trim()).toBe(`${NAME} ${VERSION}`);
  expect(run('init', 'site.db').exitCode).toBe(0);
  expect(run('export', 'site.db', 'out').exitCode).toBe(0);
  expect(await Bun.file(join(away, 'out', 'index.html')).text()).toContain('<h1>Solid wood furniture, made to measure</h1>');
  expect(await Bun.file(join(away, 'out', 'assets', 'site.css')).text()).toContain('--t-color-primary');
  // An extension's code runs in the same file, started as its runner (ADR 0026).
  const reply = await new Promise<unknown>((resolve) => {
    const child = Bun.spawn([file, '__extension-runner'], {
      cwd: away,
      env: { PATH: process.env.PATH ?? '' },
      serialization: 'json',
      ipc(message: { t: string }) {
        if (message.t === 'loaded') child.send({ t: 'run', id: 1, action: 'hello', input: { name: 'Ana' } });
        else {
          resolve(message);
          child.kill();
        }
      },
    });
    child.send({ t: 'load', code: 'export const actions = { hello: async (input) => `Hello, ${input.name}` };' });
  });
  expect(reply).toEqual({ t: 'done', id: 1, ok: true, value: 'Hello, Ana' });
  await expect(build(join(dir, 'never'), ['plan9-x64'])).rejects.toThrow();
}, 120_000);
