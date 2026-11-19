/**
 * `thecms update`: the newest release from GitHub Releases, put in place of
 * the program that runs it. The file is checked against the release's
 * `checksums.sha256` before anything is replaced; a file that does not match
 * is thrown away, and the program stays as it was.
 */
import { chmod, rename, rm } from 'node:fs/promises';
import { NAME, REPOSITORY } from '../core/index.ts';
import { VERSION } from './version.ts';

/** This computer's platform, as releases name it: `linux-x64`, `darwin-arm64`, `windows-x64`. */
export const platformName = (platform: string = process.platform, arch: string = process.arch): string => `${platform === 'win32' ? 'windows' : platform}-${arch}`;
/** The release file for a platform. */
export const releaseFile = (platform: string): string => `${NAME}-${platform}${platform.startsWith('windows') ? '.exe' : ''}`;

/** Run as the single executable, not from the sources: only then is there a file to replace. */
export const isCompiled = (main: string = Bun.main): boolean => main.includes('$bunfs') || main.includes('~BUN');

/** 1.2.10 is newer than 1.2.9; anything after a dash is ignored. */
export function newer(a: string, b: string): boolean {
  const parts = (v: string) => v.replace(/^v/, '').split('-')[0]!.split('.').map((n) => Number(n) || 0);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
}

export interface UpdateOptions {
  /** Where the releases are: GitHub's, unless a test gives its own. */
  api?: string;
  downloads?: string;
  fetch?: (url: string) => Promise<Response>;
  /** The file to replace: this program. */
  executable?: string;
  platform?: string;
  current?: string;
  compiled?: boolean;
  /** Only say whether there is a newer one. */
  check?: boolean;
  say?: (line: string) => void;
}

export async function update(options: UpdateOptions = {}): Promise<'newest' | 'available' | 'updated'> {
  const say = options.say ?? console.log;
  const get = options.fetch ?? ((url: string) => fetch(url, { headers: { 'user-agent': NAME, accept: 'application/vnd.github+json' } }));
  const current = options.current ?? VERSION;
  const asked = async (url: string): Promise<Response> => {
    const response = await get(url);
    if (!response.ok) throw new Error(`${url} answered ${response.status}`);
    return response;
  };
  const latest = (await (await asked(options.api ?? `https://api.github.com/repos/${REPOSITORY}/releases/latest`)).json()) as { tag_name?: string };
  const tag = String(latest.tag_name ?? '');
  if (!tag) throw new Error('the newest release has no version');
  if (!newer(tag, current)) {
    say(`${NAME} ${current} is the newest.`);
    return 'newest';
  }
  if (options.check) {
    say(`${NAME} ${tag.replace(/^v/, '')} is out; this is ${current}. Run "${NAME} update" to have it.`);
    return 'available';
  }
  if (!(options.compiled ?? isCompiled())) throw new Error(`this runs from the sources; update them with git, or install the program (see the README)`);

  const file = releaseFile(options.platform ?? platformName());
  const base = `${options.downloads ?? `https://github.com/${REPOSITORY}/releases/download`}/${tag}`;
  const sums = await (await asked(`${base}/checksums.sha256`)).text();
  const expected = sums.split('\n').find((line) => line.trim().endsWith(`  ${file}`))?.split(/\s+/)[0];
  if (!expected) throw new Error(`release ${tag} has nothing for ${file}`);
  const bytes = new Uint8Array(await (await asked(`${base}/${file}`)).arrayBuffer());
  const got = new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
  if (got !== expected) throw new Error(`the download of ${file} does not match its checksum; nothing was changed`);

  const executable = options.executable ?? process.execPath;
  const fresh = `${executable}.new`;
  const old = `${executable}.old`;
  await Bun.write(fresh, bytes);
  await chmod(fresh, 0o755);
  // A running program can be renamed, even on Windows, but not written over.
  await rm(old, { force: true });
  await rename(executable, old);
  await rename(fresh, executable);
  await rm(old, { force: true }).catch(() => {});
  if ((options.platform ?? platformName()).startsWith('darwin')) Bun.spawnSync(['codesign', '--force', '--sign', '-', executable]);
  say(`${NAME} is now ${tag.replace(/^v/, '')} (it was ${current}). Start it again to use it; installed as a server: systemctl restart ${NAME}`);
  return 'updated';
}
