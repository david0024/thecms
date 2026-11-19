/**
 * The program as one executable file a platform, with nothing to install
 * beside it: the runtime, the code, the Svelte components compiled, the admin
 * built for the browser, the themes and the language packs (`bun build
 * --compile`). The release workflow runs it for every platform; the install
 * scripts download what it makes.
 *
 *   bun tools/build.ts [folder] [--targets=linux-x64,darwin-arm64,...]
 *
 * Each file is named `<name>-<platform>` (`.exe` on Windows), and
 * `checksums.sha256` beside them lists the SHA-256 of each, as `sha256sum`
 * writes and checks it.
 */
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { NAME } from '../src/core/index.ts';
import { buildAdmin } from '../src/site/server.ts';
import { releaseFile } from '../src/site/update.ts';
import { svelteServer } from './svelte-plugin.ts';

/** Every platform a release has. */
export const PLATFORMS = ['linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64', 'windows-x64'] as const;


export async function build(folder: string, platforms: readonly string[] = PLATFORMS): Promise<string[]> {
  await rm(folder, { recursive: true, force: true });
  await mkdir(folder, { recursive: true });
  // Built once, the same for every platform: it runs in the browser.
  const admin = JSON.stringify(Object.fromEntries(await buildAdmin('')));
  const builtAdmin = new URL('../src/site/built-admin.ts', import.meta.url).pathname;
  const lines: string[] = [];
  for (const platform of platforms) {
    const file = releaseFile(platform);
    const result = await Bun.build({
      entrypoints: [new URL('../src/site/cli.ts', import.meta.url).pathname],
      compile: { target: `bun-${platform}` as Bun.Build.CompileTarget, outfile: join(folder, file) },
      minify: true,
      sourcemap: 'none',
      plugins: [
        svelteServer,
        {
          name: 'built-admin',
          setup(b) {
            b.onLoad({ filter: /built-admin\.ts$/ }, ({ path }) => (path === builtAdmin ? { contents: `export const BUILT_ADMIN = ${admin};`, loader: 'js' } : undefined));
          },
        },
      ],
    });
    if (!result.success) throw new AggregateError(result.logs, `${file} did not build`);
    const bytes = await Bun.file(join(folder, file)).bytes();
    lines.push(`${new Bun.CryptoHasher('sha256').update(bytes).digest('hex')}  ${file}`);
    console.log(`${file}  ${(bytes.length / 1_048_576).toFixed(1)} MB`);
  }
  await Bun.write(join(folder, 'checksums.sha256'), `${lines.join('\n')}\n`);
  return lines;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const targets = args.find((a) => a.startsWith('--targets='))?.slice(10).split(',').filter(Boolean);
  const unknown = targets?.filter((t) => !(PLATFORMS as readonly string[]).includes(t)) ?? [];
  if (unknown.length) throw new Error(`no such platform: ${unknown.join(', ')}; there are ${PLATFORMS.join(', ')}`);
  await build(args.find((a) => !a.startsWith('--')) ?? 'dist-bin', targets);
}
