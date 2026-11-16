/**
 * The core stays pure (ADR 0001, "what Zveltio gives us"): no database, no
 * framework, no runtime API. Whatever becomes a shared package one day starts
 * here, and it can only be shared if it never learned where it runs.
 */
import { expect, test } from 'bun:test';
import { readdir } from 'node:fs/promises';

const CORE = new URL('../src/core/', import.meta.url);

test('core files import only each other', async () => {
  const files = (await readdir(CORE)).filter((f) => f.endsWith('.ts'));
  expect(files.length).toBeGreaterThan(5);
  for (const file of files) {
    const source = await Bun.file(new URL(file, CORE)).text();
    const imports = [...source.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1]!);
    for (const spec of imports) {
      expect(`${file} imports ${spec}`).toMatch(/ imports \.\/[a-z]+\.ts$/);
    }
    expect(`${file}: ${/\b(Bun|process|document|window)\.[A-Za-z]/.test(source)}`).toBe(`${file}: false`);
  }
});
