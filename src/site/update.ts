/**
 * `uhlaka update`: the newest release from GitHub Releases, put in place of
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

/**
 * Whether version `a` is newer than `b`, as semantic versions are ordered
 * (ADR 0045): 1.2.10 is newer than 1.2.9, and a release is newer than its
 * pre-releases, which follow one another: 0.1.0-alpha.1, 0.1.0-alpha.2,
 * 0.1.0-beta.1, 0.1.0.
 */
export function newer(a: string, b: string): boolean {
  const split = (v: string) => {
    const [core = '', ...pre] = v.replace(/^v/, '').split('-');
    return { core: core.split('.').map((n) => Number(n) || 0), pre: pre.join('-') };
  };
  const [x, y] = [split(a), split(b)];
  for (let i = 0; i < Math.max(x.core.length, y.core.length); i++) if ((x.core[i] ?? 0) !== (y.core[i] ?? 0)) return (x.core[i] ?? 0) > (y.core[i] ?? 0);
  if (x.pre === y.pre) return false;
  if (!x.pre || !y.pre) return !x.pre;
  const [p, q] = [x.pre.split('.'), y.pre.split('.')];
  for (let i = 0; i < Math.max(p.length, q.length); i++) {
    const [m, n] = [p[i], q[i]];
    if (m === n) continue;
    if (m === undefined || n === undefined) return n === undefined;
    const [mn, nn] = [/^\d+$/.test(m), /^\d+$/.test(n)];
    if (mn && nn) return Number(m) > Number(n);
    if (mn !== nn) return nn;
    return m > n;
  }
  return false;
}

/** GitHub's list of releases: the program's and its extensions', in an order of GitHub's own. */
export const RELEASES = `https://api.github.com/repos/${REPOSITORY}/releases?per_page=100`;

interface Listed {
  tag_name?: string;
  draft?: boolean;
}

/**
 * The program's newest release, a pre-release among them: while it is in
 * alpha or beta, those are all there is (ADR 0045). GitHub does not list
 * releases newest first (0.1.0-alpha.10 came after alpha.4), and an
 * extension's release (`ai-v1.2.0`) is in the same list, so the version is
 * compared, not the place.
 */
export function newestTag(list: Listed[]): string {
  let best = '';
  for (const one of list) {
    const tag = String(one?.tag_name ?? '');
    if (one?.draft || !/^v\d+\.\d+/.test(tag)) continue;
    if (!best || newer(tag, best)) best = tag;
  }
  return best;
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
  const list = (await (await asked(options.api ?? RELEASES)).json()) as Listed[];
  const tag = newestTag(Array.isArray(list) ? list : []);
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
  // The program it replaces is kept beside it, so going back is one rename (ADR 0045 d4).
  const old = `${executable}.previous`;
  await Bun.write(fresh, bytes);
  await chmod(fresh, 0o755);
  // A running program can be renamed, even on Windows, but not written over.
  await rm(old, { force: true });
  await rename(executable, old);
  await rename(fresh, executable);
  if ((options.platform ?? platformName()).startsWith('darwin')) Bun.spawnSync(['codesign', '--force', '--sign', '-', executable]);
  say(`${NAME} is now ${tag.replace(/^v/, '')} (it was ${current}). Start it again to use it; installed as a server: systemctl restart ${NAME}`);
  say(`${current} is kept as ${old}; to go back, put it in place of ${executable}.`);
  return 'updated';
}
