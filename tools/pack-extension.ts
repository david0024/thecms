/**
 * Packs an extension's folder into the one file thecms installs (ADR 0026):
 *
 *   bun tools/pack-extension.ts <folder> [out-folder]
 *
 * The folder holds `manifest.json` and, when it has actions, `index.ts`,
 * which exports `actions`. The code is bundled into one module: nothing is
 * installed beside it. The package is checked as thecms will check it.
 */
import { join } from 'node:path';
import { EXTENSION_FORMAT, parseExtension } from '../src/core/index.ts';

export async function packExtension(folder: string, out = folder): Promise<{ file: string; sha256: string }> {
  const manifest = await Bun.file(join(folder, 'manifest.json')).json();
  const entry = join(folder, 'index.ts');
  let code = '';
  if (await Bun.file(entry).exists()) {
    const built = await Bun.build({ entrypoints: [entry], target: 'bun', format: 'esm', minify: false });
    if (!built.success) throw new Error(built.logs.map(String).join('\n'));
    code = await (built.outputs[0] as Blob).text();
  }
  const raw = { format: EXTENSION_FORMAT, manifest, code };
  const { pkg, problems } = parseExtension(raw);
  if (!pkg) throw new Error(problems.join('\n'));
  const text = `${JSON.stringify(raw)}\n`;
  const file = join(out, `${pkg.manifest.name}-${pkg.manifest.version}.thecms-extension`);
  await Bun.write(file, text);
  return { file, sha256: new Bun.CryptoHasher('sha256').update(text).digest('hex') };
}

/** The command: packs the folder given, and says the file and its SHA-256. */
export async function packCommand(args: string[], say: (line: string) => void = console.log): Promise<void> {
  const [folder, out] = args;
  if (!folder) throw new Error('usage: bun tools/pack-extension.ts <folder> [out-folder]');
  const { file, sha256 } = await packExtension(folder, out);
  say(`${sha256}  ${file}`);
}

if (import.meta.main) await packCommand(Bun.argv.slice(2));
