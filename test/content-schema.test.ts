/**
 * The schema of a content file (docs/content-schema.json) and the example in
 * docs/examples: an AI that writes a site from them must get one the program
 * takes whole. So the schema is held to the core it is made from, a file the
 * program writes is held to the schema, and the example is imported into a
 * new site with nothing dropped.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BLOCK_TYPES, normalizeBlocks } from '../src/core/index.ts';
import { readContentFile, runContentImport } from '../src/import/uhlaka.ts';
import { DEMO_PAGES, DEMO_SITE } from '../src/site/demo.ts';
import { Store } from '../src/site/store.ts';
import { exportContent } from '../src/site/transfer.ts';
import plain from '../themes/plain.json';
import { contentSchema, contentSchemaText } from '../tools/content-schema.ts';

type Schema = Record<string, unknown>;
const root = contentSchema();
const defs = root.$defs as Record<string, Schema>;

/** The part of JSON Schema the schema uses, enough to say where a value breaks it. */
function errors(schema: Schema, value: unknown, at = '$'): string[] {
  if (typeof schema.$ref === 'string') return errors(defs[schema.$ref.replace('#/$defs/', '')] as Schema, value, at);
  if (Array.isArray(schema.anyOf)) return (schema.anyOf as Schema[]).some((s) => errors(s, value, at).length === 0) ? [] : [`${at}: matches none of anyOf`];
  if (Array.isArray(schema.oneOf)) {
    const found = (schema.oneOf as Schema[]).map((s) => errors(s, value, at));
    const fit = found.filter((e) => e.length === 0).length;
    if (fit === 1) return [];
    // For a block, say what is wrong with the block of its own type.
    const own = (schema.oneOf as Schema[]).findIndex((s) => typeof s.$ref === 'string' && s.$ref.endsWith(`block-${(value as { type?: string })?.type}`));
    return own >= 0 ? (found[own] as string[]) : [`${at}: matches ${fit} of oneOf`];
  }
  const out: string[] = [];
  if ('const' in schema && JSON.stringify(schema.const) !== JSON.stringify(value)) return [`${at}: not ${JSON.stringify(schema.const)}`];
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) return [`${at}: not one of ${schema.enum.join(', ')}`];
  if (schema.not && errors(schema.not as Schema, value, at).length === 0) return [`${at}: a value it may not be`];
  const kind = Array.isArray(value) ? 'array' : value === null ? 'null' : Number.isInteger(value) ? 'integer' : typeof value;
  if (schema.type && !(schema.type === kind || (schema.type === 'number' && kind === 'integer'))) return [`${at}: a ${kind}, not a ${String(schema.type)}`];
  if (typeof value === 'string') {
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) out.push(`${at}: longer than ${schema.maxLength}`);
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) out.push(`${at}: shorter than ${schema.minLength}`);
    if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern).test(value)) out.push(`${at}: does not match ${schema.pattern}`);
  }
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) out.push(`${at}: below ${schema.minimum}`);
    if (typeof schema.maximum === 'number' && value > schema.maximum) out.push(`${at}: above ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) out.push(`${at}: more than ${schema.maxItems} items`);
    if (schema.items) value.forEach((item, i) => out.push(...errors(schema.items as Schema, item, `${at}[${i}]`)));
  }
  if (kind === 'object') {
    const object = value as Record<string, unknown>;
    for (const key of (schema.required as string[] | undefined) ?? []) if (!(key in object)) out.push(`${at}: ${key} is missing`);
    const properties = (schema.properties ?? {}) as Record<string, Schema>;
    for (const [key, item] of Object.entries(object)) {
      if (properties[key]) out.push(...errors(properties[key], item, `${at}.${key}`));
      else if (schema.additionalProperties === false) out.push(`${at}: ${key} is not a known field`);
    }
  }
  return out;
}

const example = await Bun.file(new URL('../docs/examples/dental-clinic.uhlaka.json', import.meta.url)).text();

describe('the schema', () => {
  test('the file in docs/ is the one the core makes now (run `bun tools/content-schema.ts`)', async () => {
    expect(await Bun.file(new URL('../docs/content-schema.json', import.meta.url)).text()).toBe(contentSchemaText());
  });

  test('every block type the core has is in it', () => {
    for (const type of BLOCK_TYPES) expect(defs[`block-${type}`]).toBeDefined();
  });

  test('a block that breaks it is caught: an unknown type, a field the type does not have, a text too long', () => {
    const block = { $ref: '#/$defs/block' };
    expect(errors(block, { type: 'slider', content: {} })).not.toEqual([]);
    expect(errors(block, { type: 'hero', content: { headline: 'x' } })).toEqual(['$.content: headline is not a known field']);
    expect(errors(block, { type: 'hero', content: { title: 'x'.repeat(201) } })).toEqual(['$.content.title: longer than 200']);
    expect(errors(block, { type: 'hero', content: { title: 'A headline' } })).toEqual([]);
  });
});

describe('what the program writes keeps to it', () => {
  let dir: string;
  let store: Store;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'uhlaka-schema-'));
    store = await Store.open(join(dir, 'site.db'));
    await store.setSite(DEMO_SITE);
    await store.setTheme(plain);
    await store.publishTheme();
    for (const page of DEMO_PAGES) await store.publish((await store.savePage(page)).slug);
  });
  afterAll(async () => {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  });

  test('a complete export of the demo site', async () => {
    const file = await exportContent(store, ['pages', 'sections', 'forms', 'design', 'type:posts']);
    expect(errors(root, JSON.parse(JSON.stringify(file)))).toEqual([]);
  });
});

describe('the example', () => {
  let dir: string;
  let store: Store;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'uhlaka-example-'));
    store = await Store.open(join(dir, 'site.db'));
  });
  afterAll(async () => {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  });

  test('keeps to the schema', () => {
    expect(errors(root, JSON.parse(example))).toEqual([]);
  });

  test('every block is taken as written: nothing dropped, nothing reported', () => {
    const file = readContentFile(example);
    const docs = [...(file.pages ?? []), ...file.types.flatMap((t) => t.entries)];
    for (const doc of docs) {
      const blocks = (doc.draft as { blocks: unknown[] }).blocks;
      const { blocks: clean, issues } = normalizeBlocks(blocks);
      expect(issues).toEqual([]);
      // What the author wrote is all there after cleaning (cleaning only adds the fields left empty and the ids).
      clean.forEach((block, i) => expect(block.content).toMatchObject((blocks[i] as { content: object }).content));
    }
  });

  test('a new site made from it alone: settings, pages, the form, the posts, all published', async () => {
    expect(await store.isEmpty()).toBe(true);
    const report = await runContentImport(store, readContentFile(example), { fresh: true });
    expect(report.notes).toEqual([]);
    expect(report).toMatchObject({ pages: 3, posts: 1, drafts: 0, menu: false });
    const site = await store.site();
    expect(site.name).toBe('Linden Dental');
    expect(site.action?.href).toBe('/contact/');
    expect((await store.forms()).map((f) => f.name)).toContain('appointment');
    expect((await store.published()).map((p) => p.slug).sort()).toEqual(['', 'contact', 'prices']);
    expect(await store.publishedEntries('posts')).toHaveLength(1);
  });
});
