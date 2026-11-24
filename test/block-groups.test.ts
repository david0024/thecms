import { describe, expect, test } from 'bun:test';
import { BLOCK_GROUPS, BLOCK_WORDS, matches, plain } from '../src/admin/blockGroups.ts';
import { BLOCK_TYPES } from '../src/core/index.ts';

describe('"Add a block" in groups (ADR 0073)', () => {
  test('every block but an extension\'s is in exactly one group', () => {
    const listed = BLOCK_GROUPS.flatMap((g) => g.types);
    expect(new Set(listed).size).toBe(listed.length);
    expect([...listed].sort()).toEqual(BLOCK_TYPES.filter((t) => t !== 'extension').sort());
  });

  test('a block is found by its name, its words, or another word for it, without the marks over letters', () => {
    expect(plain('Hartă și Întrebări')).toBe('harta si intrebari');
    expect(matches('youtube', 'From another site', BLOCK_WORDS.embed ?? '')).toBe(true);
    expect(matches('hartă', 'De pe alt site', BLOCK_WORDS.embed ?? '')).toBe(true);
    expect(matches('FAQ', 'Questions and answers', BLOCK_WORDS.faq ?? '')).toBe(true);
    expect(matches('photo gallery', 'Gallery', BLOCK_WORDS.gallery ?? '')).toBe(true);
    expect(matches('pricing', 'Text', BLOCK_WORDS.text ?? '')).toBe(false);
    expect(matches('', 'anything')).toBe(true);
  });
});
