/**
 * The core stays pure (ADR 0001, "what Zveltio gives us"): no database, no
 * framework, no runtime API. Whatever becomes a shared package one day starts
 * here, and it can only be shared if it never learned where it runs.
 */
import { expect, test } from 'bun:test';
import { readdir } from 'node:fs/promises';

const CORE = new URL('../src/core/', import.meta.url);
const VIEW = new URL('../src/view/', import.meta.url);

/** Every import of every file in the folder must match; nothing reaches the runtime. */
async function pure(folder: URL, allowed: RegExp, atLeast: number): Promise<void> {
  const files = (await readdir(folder)).filter((f) => f.endsWith('.ts'));
  expect(files.length).toBeGreaterThanOrEqual(atLeast);
  for (const file of files) {
    const source = await Bun.file(new URL(file, folder)).text();
    const imports = [...source.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1]!);
    for (const spec of imports) expect(`${file} imports ${spec}`).toMatch(allowed);
    expect(`${file}: ${/\b(Bun|process|document|window)\.[A-Za-z]/.test(source)}`).toBe(`${file}: false`);
  }
}

test('core files import only each other, and the view format', () => pure(CORE, / imports (\.\/[a-z]+|\.\.\/view\/index)\.ts$/, 6));

// ADR 0031 d4: the view format stands on its own, so another front end can take it as it is.
test('the view format imports only itself', () => pure(VIEW, / imports \.\/[a-z]+\.ts$/, 3));
