/**
 * Coverage of the whole source tree, from the unit tests and the browser.
 *
 *   bun test --coverage --coverage-reporter=lcov --coverage-dir=coverage
 *   THECMS_COVERAGE=coverage node e2e/editor.cjs   (and the other e2e scripts)
 *   bun tools/coverage.ts coverage --lines=90 --file=50
 *
 * `bun test --coverage` counts only the files the unit tests load. The admin
 * runs in a browser, so its lines are counted from what Chromium ran in the
 * end-to-end tests, traced back through the bundle's source map, and for a
 * Svelte component through the compiler's map too, to the line in the source.
 * A line is covered when either kind of test ran it.
 *
 * It fails when the whole tree is below `--lines`, when a file is below
 * `--file`, or when a source file was measured by neither: a file nobody
 * measures is the place coverage hides.
 */
import { Glob } from 'bun';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { decodedMappings, eachMapping, originalPositionFor, TraceMap } from '@jridgewell/trace-mapping';
import { compileForServer } from './svelte-plugin.ts';

/** Source line numbers each file has code on, and whether a test ran it. */
export type Lines = Map<string, Map<number, boolean>>;

interface Range {
  startOffset: number;
  endOffset: number;
  count: number;
}
interface Ran {
  url: string;
  source?: string;
  functions: { ranges: Range[] }[];
}

const SOURCES = ['src/**/*.ts', 'src/**/*.svelte', 'tools/**/*.ts', 'extensions/**/*.ts'];
/** Files with no code of their own to run. */
const NOTHING_TO_RUN = /\.d\.ts$/;

const mark = (lines: Lines, file: string, line: number, ran: boolean): void => {
  let found = lines.get(file);
  if (!found) lines.set(file, (found = new Map()));
  found.set(line, (found.get(line) ?? false) || ran);
};

/**
 * The component lines each line of a Svelte component's server code came from.
 * `bun test` counts a component in the lines of the code the compiler made of
 * it, not in the component's own, so they are read back through its map.
 */
export function componentLines(source: string, path: string): Map<number, number[]> {
  const found = new Map<number, number[]>();
  decodedMappings(new TraceMap(compileForServer(source, path).map as never)).forEach((segments, at) => {
    const from = [...new Set(segments.filter((s) => s.length >= 4).map((s) => (s[2] as number) + 1))];
    if (from.length) found.set(at + 1, from);
  });
  return found;
}

/** The lines an lcov file (from `bun test`) says each file has, and which ran. */
export function fromLcov(text: string, root: string, lines: Lines = new Map()): Lines {
  let file = '';
  let component: Map<number, number[]> | null = null;
  for (const row of text.split('\n')) {
    if (row.startsWith('SF:')) {
      file = relative(root, resolve(root, row.slice(3).trim()));
      const path = resolve(root, file);
      component = file.endsWith('.svelte') && existsSync(path) ? componentLines(readFileSync(path, 'utf8'), path) : null;
      // A file with nothing to run, only types, is still measured.
      if (!lines.has(file)) lines.set(file, new Map());
    } else if (row.startsWith('DA:') && file) {
      const [line, count] = row.slice(3).split(',').map(Number);
      if (!line) continue;
      for (const at of component ? (component.get(line) ?? []) : [line]) mark(lines, file, at, (count ?? 0) > 0);
    }
  }
  return lines;
}

/** How many times each character of a script ran, from V8's block coverage: inner ranges are painted over outer ones. */
export function counts(length: number, ran: Ran[]): Int32Array {
  const at = new Int32Array(length);
  const ranges = ran.flatMap((entry) => entry.functions.flatMap((fn) => fn.ranges));
  ranges.sort((a, b) => b.endOffset - b.startOffset - (a.endOffset - a.startOffset));
  for (const range of ranges) at.fill(range.count, range.startOffset, Math.min(range.endOffset, length));
  return at;
}

/** The source lines a browser ran, through the bundle's map and, for a component, the Svelte compiler's. */
export function fromBrowser(
  maps: { root: string; bundles: Record<string, unknown>; svelte: Record<string, unknown> },
  runs: Ran[],
  root: string,
  lines: Lines = new Map(),
): Lines {
  const svelte = new Map(Object.entries(maps.svelte).map(([path, map]) => [resolve(path), new TraceMap(map as never)]));
  for (const [name, bundle] of Object.entries(maps.bundles)) {
    const ran = runs.filter((entry) => new URL(entry.url).pathname.endsWith(`/${name}`));
    const source = ran.find((entry) => entry.source)?.source;
    if (!source) continue;
    const lineStart = [0];
    for (let i = 0; i < source.length; i++) if (source[i] === '\n') lineStart.push(i + 1);
    // Every run of the script is the same text: add their counts.
    const total = new Int32Array(source.length);
    for (const one of ran) {
      const each = counts(source.length, [one]);
      for (let i = 0; i < total.length; i++) total[i] = (total[i] as number) + (each[i] as number);
    }
    eachMapping(new TraceMap(bundle as never), (m) => {
      if (m.source === null || m.originalLine === null) return;
      const offset = (lineStart[m.generatedLine - 1] ?? 0) + m.generatedColumn;
      // Bun maps the indentation that starts a line to where the line before ended: that is no code of its own.
      if (/\s/.test(source[offset] ?? ' ')) return;
      const didRun = (total[offset] ?? 0) > 0;
      const path = isAbsolute(m.source) ? m.source : resolve(maps.root, m.source);
      let file = path;
      let line = m.originalLine;
      if (path.endsWith('.svelte')) {
        const compiled = svelte.get(path);
        const original = compiled && originalPositionFor(compiled, { line: m.originalLine, column: m.originalColumn });
        if (!original || original.line === null) return;
        line = original.line;
        if (original.source) file = resolve(path, '..', original.source.replace(/^.*[\\/]/, ''));
      }
      const shown = relative(root, file);
      if (shown.startsWith('src/')) mark(lines, shown, line, didRun);
    });
  }
  return lines;
}

export interface Report {
  files: { file: string; covered: number; total: number }[];
  covered: number;
  total: number;
  unmeasured: string[];
}

export function report(lines: Lines, sources: string[]): Report {
  const files = [...lines]
    .filter(([file]) => sources.includes(file))
    .map(([file, found]) => ({ file, covered: [...found.values()].filter(Boolean).length, total: found.size }))
    .sort((a, b) => a.file.localeCompare(b.file));
  const covered = files.reduce((sum, f) => sum + f.covered, 0);
  const total = files.reduce((sum, f) => sum + f.total, 0);
  return { files, covered, total, unmeasured: sources.filter((file) => !lines.has(file)) };
}

const percent = (covered: number, total: number): number => (total ? (100 * covered) / total : 100);

export function toLcov(lines: Lines): string {
  return [...lines]
    .map(([file, found]) => {
      const rows = [...found].sort((a, b) => a[0] - b[0]).map(([line, ran]) => `DA:${line},${ran ? 1 : 0}`);
      return `SF:${file}\n${rows.join('\n')}\nLF:${found.size}\nLH:${[...found.values()].filter(Boolean).length}\nend_of_record`;
    })
    .join('\n');
}

/** Reads a coverage folder, prints the table, writes `all.lcov`, and gives back what failed. */
export function check(dir: string, limits: { lines?: number; file?: number } = {}, root = process.cwd(), print = console.log): string[] {
  const lines: Lines = new Map();
  if (existsSync(join(dir, 'lcov.info'))) fromLcov(readFileSync(join(dir, 'lcov.info'), 'utf8'), root, lines);
  if (existsSync(join(dir, 'admin-maps.json'))) {
    const runs = readdirSync(dir)
      .filter((f) => /^browser-.*\.json$/.test(f))
      .flatMap((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as Ran[]);
    fromBrowser(JSON.parse(readFileSync(join(dir, 'admin-maps.json'), 'utf8')), runs, root, lines);
  }
  const sources = SOURCES.flatMap((pattern) => [...new Glob(pattern).scanSync(root)]).filter((f) => !NOTHING_TO_RUN.test(f)).sort();
  const result = report(lines, sources);
  writeFileSync(join(dir, 'all.lcov'), toLcov(lines));

  const width = Math.max(...result.files.map((f) => f.file.length), 10);
  for (const f of result.files) print(`${f.file.padEnd(width)}  ${percent(f.covered, f.total).toFixed(1).padStart(5)}%  ${String(f.total - f.covered).padStart(4)} lines not run`);
  const whole = percent(result.covered, result.total);
  print(`\n${'All files'.padEnd(width)}  ${whole.toFixed(1).padStart(5)}%  ${result.covered} of ${result.total} lines`);

  const failures: string[] = [];
  for (const file of result.unmeasured) failures.push(`${file} is measured by no test`);
  if (whole < (limits.lines ?? 0)) failures.push(`the whole tree is at ${whole.toFixed(1)}%, under ${limits.lines}%`);
  for (const f of result.files) if (percent(f.covered, f.total) < (limits.file ?? 0)) failures.push(`${f.file} is at ${percent(f.covered, f.total).toFixed(1)}%, under ${limits.file}%`);
  return failures;
}

if (import.meta.main) {
  const args = Bun.argv.slice(2);
  const option = (name: string): number => Number(args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? 0);
  const failures = check(args.find((a) => !a.startsWith('--')) ?? 'coverage', { lines: option('lines'), file: option('file') });
  if (failures.length) {
    console.error(`\n${failures.join('\n')}`);
    process.exit(1);
  }
}
