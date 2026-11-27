/**
 * The coverage gate (tools/coverage.ts) counts what it says it counts: lines
 * from `bun test`, and lines a browser ran, traced back to the source through
 * the bundle's map and the Svelte compiler's.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compile } from 'svelte/compiler';
import { check, componentLines, counts, fromBrowser, fromLcov, report, toLcov } from '../tools/coverage.ts';

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'uhlaka-coverage-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Builds `files` for a browser as the admin is built, and gives the script with its maps. */
async function bundle(files: Record<string, string>, entry: string) {
  for (const [name, text] of Object.entries(files)) await writeFile(join(dir, 'src', name), text).catch(async () => {
    await Bun.$`mkdir -p ${join(dir, 'src')}`;
    await writeFile(join(dir, 'src', name), text);
  });
  const svelte: Record<string, unknown> = {};
  const result = await Bun.build({
    entrypoints: [join(dir, 'src', entry)],
    target: 'browser',
    sourcemap: 'external',
    external: ['svelte', 'svelte/*'],
    plugins: [
      {
        name: 'svelte-client',
        setup(build) {
          build.onLoad({ filter: /\.svelte$/ }, async ({ path }) => {
            const { js } = compile(await Bun.file(path).text(), { filename: path, generate: 'client', dev: false });
            svelte[path] = js.map;
            return { contents: js.code, loader: 'js' };
          });
        },
      },
    ],
  });
  const script = result.outputs.find((o) => o.kind !== 'sourcemap');
  const map = result.outputs.find((o) => o.kind === 'sourcemap');
  return { source: await script!.text(), maps: { root: process.cwd(), bundles: { 'app.js': await map!.json() }, svelte } };
}

/** V8's coverage of a script where everything ran once, except the code between two markers. */
const ranOnceExcept = (source: string, from: string, to: string) => {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start) + to.length;
  return [{ url: 'http://127.0.0.1:1/admin/app.js', source, functions: [{ ranges: [{ startOffset: 0, endOffset: source.length, count: 1 }] }, { ranges: [{ startOffset: start, endOffset: end, count: 0 }] }] }];
};

describe('the coverage gate', () => {
  test('reads lcov from bun test, a file with only types included', () => {
    const lines = fromLcov('SF:src/a.ts\nDA:1,3\nDA:2,0\nend_of_record\nSF:src/types.ts\nend_of_record\n', '/r');
    expect([...(lines.get('src/a.ts') ?? [])]).toEqual([
      [1, true],
      [2, false],
    ]);
    expect(lines.get('src/types.ts')?.size).toBe(0);
  });

  test('inner ranges count over outer ones', () => {
    const at = counts(10, [{ url: 'x', functions: [{ ranges: [{ startOffset: 0, endOffset: 10, count: 2 }, { startOffset: 3, endOffset: 5, count: 0 }] }] }]);
    expect([...at]).toEqual([2, 2, 2, 0, 0, 2, 2, 2, 2, 2]);
  });

  test('a line the browser ran is covered, one it skipped is not, through the bundle map', async () => {
    const { source, maps } = await bundle(
      { 'main.ts': 'export function used(): number {\n  return 1;\n}\nexport function unused(): number {\n  return 2;\n}\nconsole.log(used());\n(globalThis as any).u = unused;\n' },
      'main.ts',
    );
    const lines = fromBrowser(maps, ranOnceExcept(source, 'function unused', '}'), dir);
    const file = lines.get('src/main.ts');
    expect(file?.get(2)).toBe(true);
    expect(file?.get(5)).toBe(false);
  });

  test('and for a Svelte component, to the line in the .svelte file', async () => {
    const component = '<script>\n  let count = $state(0);\n  function never() {\n    count = 99;\n  }\n</script>\n\n<button onclick={never}>{count}</button>\n';
    const { source, maps } = await bundle({ 'Box.svelte': component, 'entry.ts': "import Box from './Box.svelte';\nconsole.log(Box);\n" }, 'entry.ts');
    const lines = fromBrowser(maps, ranOnceExcept(source, 'function never', '}'), dir);
    const file = lines.get('src/Box.svelte');
    expect(file?.get(4)).toBe(false);
    expect(file?.get(2)).toBe(true);
  });

  test('a source file no test measured is named, and the lcov it writes reads back', () => {
    const lines = fromLcov('SF:src/a.ts\nDA:1,1\nDA:2,0\nend_of_record\n', '/r');
    const result = report(lines, ['src/a.ts', 'src/b.ts']);
    expect(result).toMatchObject({ covered: 1, total: 2, unmeasured: ['src/b.ts'] });
    expect(fromLcov(toLcov(lines), '/r')).toEqual(lines);
  });
});

describe('the gate itself', () => {
  test('fails on a file nobody measured, a file under its floor and a tree under its line', async () => {
    const root = join(dir, 'tree');
    await Bun.$`mkdir -p ${join(root, 'src')} ${join(root, 'cov')}`;
    await writeFile(join(root, 'src', 'a.ts'), 'x\n');
    await writeFile(join(root, 'src', 'b.ts'), 'y\n');
    await writeFile(join(root, 'src', 'only.d.ts'), 'declare const z: 1;\n');
    await writeFile(join(root, 'cov', 'lcov.info'), 'SF:src/a.ts\nDA:1,1\nDA:2,0\nDA:3,0\nend_of_record\n');
    const said: string[] = [];
    const failures = check(join(root, 'cov'), { lines: 50, file: 50 }, root, (line) => void said.push(line));
    expect(failures).toEqual(['src/b.ts is measured by no test', 'the whole tree is at 33.3%, under 50%', 'src/a.ts is at 33.3%, under 50%']);
    expect(said.join('\n')).toContain('1 of 3 lines');
    expect(await Bun.file(join(root, 'cov', 'all.lcov')).text()).toContain('SF:src/a.ts');
    expect(check(join(root, 'cov'), {}, root, () => {})).toEqual(['src/b.ts is measured by no test']);
  });
});

describe('what bun test counts in a component', () => {
  test('is read back to the lines of the .svelte file', async () => {
    const path = join(dir, 'src', 'Two.svelte');
    const component = '<script>\n  let { a, b } = $props();\n</script>\n\n{#if a}\n  <p>{a}</p>\n{:else}\n  <p>{b}</p>\n{/if}\n';
    await writeFile(path, component);
    const map = componentLines(component, path);
    const compiledYes = [...map].find(([, from]) => from.includes(6))?.[0];
    const compiledNo = [...map].find(([, from]) => from.includes(8))?.[0];
    expect(compiledYes && compiledNo).toBeTruthy();
    const lcov = `SF:${path}\nDA:${compiledYes},1\nDA:${compiledNo},0\nend_of_record\n`;
    const file = fromLcov(lcov, dir).get('src/Two.svelte');
    expect(file?.get(6)).toBe(true);
    expect(file?.get(8)).toBe(false);
    expect(Math.max(...(file?.keys() ?? []))).toBeLessThanOrEqual(9);
  });
});
