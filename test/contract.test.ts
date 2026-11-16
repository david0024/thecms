/**
 * One list of block types. If the core offers a type the renderer cannot draw,
 * or the renderer draws one the core does not know, a page shows a hole where
 * a block should be. Zveltio shipped that for three months; this is the test
 * that would have caught it.
 */
import { expect, test } from 'bun:test';
import { render } from 'svelte/server';
import BlockView from '../src/blocks/BlockView.svelte';
import { COMPONENTS } from '../src/blocks/components.ts';
import { BLOCK_TYPES, createBlock } from '../src/core/index.ts';

test('the renderer draws exactly the types the core defines', () => {
  expect(Object.keys(COMPONENTS).sort()).toEqual([...BLOCK_TYPES].sort());
});

test('a new block of every type renders', () => {
  for (const type of BLOCK_TYPES) {
    const block = createBlock(type);
    const { body } = render(BlockView, { props: { block } });
    expect(body).toContain(`class="b b-${type}"`);
    expect(body).toContain(`data-b="${block.id}"`);
  }
});
