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
const dir = await mkdtemp(join(tmpdir(), 'uhlaka-install-'));
afterAll(() => rm(dir, { recursive: true, force: true }));

const sha256 = (bytes: Uint8Array | string): string => new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
// Nothing is asked unless a test gives the answers (INSTALL_TTY): run from a terminal, the script would wait for one.
const sh = (args: string[], env: Record<string, string> = {}, cwd = root) => {
  const run = Bun.spawnSync(['sh', ...args.map((a) => (a === 'install.sh' ? join(root, a) : a))], {
    cwd,
    env: { PATH: process.env.PATH ?? '', HOME: dir, INSTALL_TTY: '/dev/null', ...env },
  });
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
    expect(sh(['install.sh', '--host=moon']).err).toContain('--host is computer, server, docker or platform, not moon');
    expect(sh(['install.sh', '--host=cpanel']).err).toContain('Shared hosting with cPanel runs PHP');
    expect(sh(['install.sh', '--host=cloudflare']).err).toContain('Cloudflare comes with the site running on Workers');
    // A server is set up as root, on Linux with systemd, at an https address; what is missing is said before anything is downloaded.
    const server = sh(['install.sh', '--server', '--yes']).err;
    expect(server).toMatch(/a server is Linux with systemd|set up as root|needs systemd|--public is the address people will open/);
    expect(sh(['install.sh', '--host=docker', '--public=http://cms.example.com']).err).toContain('--public is the address people will open');
  });

  test('a ready platform is pointed to how, and nothing is downloaded', () => {
    const run = sh(['install.sh', '--host=platform']);
    expect(run.code).toBe(0);
    expect(run.out).toContain(`https://github.com/${REPOSITORY}/blob/main/docs/install/platforms.md`);
  });

  test('asks where the site lives, one step at a time, and asks again when the answer cannot be', async () => {
    const release = join(dir, 'asked');
    await mkdir(release, { recursive: true });
    const file = releaseFile(platformName());
    const program = `#!/bin/sh\necho "${NAME} 9.9.9"\n`;
    await writeFile(join(release, file), program);
    await writeFile(join(release, 'checksums.sha256'), `${sha256(program)}  ${file}\n`);
    const answers = join(dir, 'answers');
    // cPanel, then a number that is not offered, then this computer.
    await writeFile(answers, '6\n9\n1\n');
    const run = sh(['install.sh'], { RELEASE_URL: `file://${release}`, INSTALL_DIR: join(dir, 'asked-bin'), INSTALL_TTY: answers });
    expect(run.err).toBe('');
    expect(run.out).toContain('Where will the site live?');
    expect(run.out).toContain('Shared hosting with cPanel runs PHP');
    expect(run.out).toContain('Type a number from 1 to 6.');
    expect(run.out).toContain(`Installed ${NAME} 9.9.9`);
  });

  test('for Docker, writes a folder with compose, the Dockerfile, and the answers as its settings', async () => {
    const release = join(dir, 'docker-release');
    await mkdir(release, { recursive: true });
    const files = ['compose.yaml', 'Dockerfile', 'install.sh'];
    for (const name of files) await writeFile(join(release, name), await readFile(join(root, name === 'install.sh' ? name : `docker/${name}`)));
    const sums = await Promise.all(files.map(async (name) => `${sha256(await readFile(join(release, name)))}  ${name}`));
    await writeFile(join(release, 'checksums.sha256'), `${sums.join('\n')}\n`);
    const env = { RELEASE_URL: `file://${release}` };
    const settings = async (folder: string) => Object.fromEntries((await readFile(join(folder, 'uhlaka', '.env'), 'utf8')).split('\n').filter((l) => /^[A-Z]/.test(l)).map((l) => l.split(/=(.*)/s).slice(0, 2)));

    // Answered by options: PostgreSQL beside it, with Valkey, at the address on this computer.
    const optioned = join(dir, 'docker-options');
    await mkdir(optioned);
    const run = sh(['install.sh', '--host=docker', '--database=postgres', '--yes', '--version=1.2.3'], env, optioned);
    expect(run.err).toBe('');
    expect(run.out).toContain('docker compose up -d --build');
    expect((await readdir(join(optioned, 'uhlaka'))).sort()).toEqual(['.env', 'Dockerfile', 'compose.yaml', 'install.sh']);
    const kept = await settings(optioned);
    expect(kept.COMPOSE_PROFILES).toBe('postgres,valkey');
    expect(kept.DATABASE_PASSWORD).toMatch(/^[0-9a-f]{36}$/);
    expect(kept.UHLAKA_SITE).toBe(`postgres://uhlaka:${kept.DATABASE_PASSWORD}@postgres:5432/uhlaka`);
    expect(kept.UHLAKA_PUBLIC).toBe('http://localhost:4321');
    expect(kept.UHLAKA_VERSION).toBe('1.2.3');
    expect(kept.UHLAKA_VALKEY_URL).toBe('redis://valkey:6379');
    // Run again, the settings are kept: the database's password among them.
    expect(sh(['install.sh', '--host=docker', '--database=mysql', '--yes'], env, optioned).out).toContain('they are left as they are');
    expect((await settings(optioned)).UHLAKA_SITE).toBe(kept.UHLAKA_SITE);

    // Asked: Docker, a database of mine (PostgreSQL, on another server), its details, and an address.
    const asked = join(dir, 'docker-asked');
    await mkdir(asked);
    const answers = join(dir, 'docker-answers');
    await writeFile(answers, ['3', '5', '1', 'db.example.com', '', 'shop', 'ana', 'p@ss:w/rd é', 'https://shop.example.com/', ''].join('\n'));
    const mine = sh(['install.sh', '--no-valkey'], { ...env, INSTALL_TTY: answers }, asked);
    expect(mine.err).toBe('');
    expect(mine.out).toContain('Which database is it?');
    expect(mine.out).toContain('The site connects to your database when it starts');
    const own = await settings(asked);
    expect(own.UHLAKA_SITE).toBe('postgres://ana:p%40ss%3Aw%2Frd%20%C3%A9@db.example.com:5432/shop');
    expect(own.UHLAKA_PUBLIC).toBe('https://shop.example.com');
    expect(own.COMPOSE_PROFILES).toBe('');
    expect(own.UHLAKA_VALKEY_URL).toBeUndefined();

    // SQLite: a file in the site's volume, and no database to start.
    const plain = join(dir, 'docker-sqlite');
    await mkdir(plain);
    sh(['install.sh', '--host=docker', '--yes', '--port=8080'], env, plain);
    expect(await settings(plain)).toMatchObject({ UHLAKA_SITE: '/site/site.db', COMPOSE_PROFILES: 'valkey', UHLAKA_PUBLIC: 'http://localhost:8080', UHLAKA_PORT: '8080' });
  });

  test('the compose file starts only the database the settings name', async () => {
    const compose = await readFile(join(root, 'docker', 'compose.yaml'), 'utf8');
    for (const service of ['postgres', 'mysql', 'mariadb', 'valkey']) expect(compose).toContain(`profiles: [${service}]`);
    expect(compose).toContain('127.0.0.1:${UHLAKA_PORT:-4321}:4321');
    const dockerfile = await readFile(join(root, 'docker', 'Dockerfile'), 'utf8');
    expect(dockerfile).toContain('install.sh --host=computer --yes');
    expect(dockerfile).toContain('setpriv --reuid=uhlaka');
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
    expect(isCompiled('/$bunfs/root/uhlaka')).toBe(true);
    expect(isCompiled('B:\\~BUN\\root\\uhlaka.exe')).toBe(true);
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
