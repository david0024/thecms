/**
 * Moving blocks around a page.
 *
 * Everything works by block id, never by position or path: a path is
 * invalidated by the very move that uses it, which is how a drag-and-drop tree
 * corrupts itself. Every function returns a new tree and leaves its input
 * alone, so an undo stack can keep earlier versions.
 *
 * The behaviour follows the page builder in Zveltio
 * (`packages/studio/src/lib/page-builder/lib/block-tree.ts`), written again
 * here because that module is not published as a package (ADR 0001).
 */
import type { Block } from './blocks.ts';
import { isContainerType } from './blocks.ts';
import { newId } from './util.ts';

const kids = (b: Block): Block[] => (isContainerType(b.type) ? (b.children ?? []) : []);
const withKids = (b: Block, children: Block[]): Block => ({ ...b, children });

export function findById(blocks: Block[], id: string): Block | null {
  for (const b of blocks) {
    if (b.id === id) return b;
    const hit = findById(kids(b), id);
    if (hit) return hit;
  }
  return null;
}

/** The id of the container holding this block; null at the top; undefined when absent. */
export function parentIdOf(blocks: Block[], id: string, parent: string | null = null): string | null | undefined {
  for (const b of blocks) {
    if (b.id === id) return parent;
    const hit = parentIdOf(kids(b), id, b.id);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

export function isSelfOrDescendant(blocks: Block[], ancestorId: string, id: string): boolean {
  if (ancestorId === id) return true;
  const ancestor = findById(blocks, ancestorId);
  return ancestor !== null && findById(kids(ancestor), id) !== null;
}

export function removeById(blocks: Block[], id: string): Block[] {
  return blocks.filter((b) => b.id !== id).map((b) => (isContainerType(b.type) ? withKids(b, removeById(kids(b), id)) : b));
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(Math.max(n, lo), hi);

/** Insert at `index` inside the container `parentId`, or at the top when it is null. */
export function insertAt(blocks: Block[], parentId: string | null, index: number, block: Block): Block[] {
  if (parentId === null) {
    const next = [...blocks];
    next.splice(clamp(index, 0, next.length), 0, block);
    return next;
  }
  return blocks.map((b) => {
    if (!isContainerType(b.type)) return b;
    if (b.id !== parentId) return withKids(b, insertAt(kids(b), parentId, index, block));
    const next = [...kids(b)];
    next.splice(clamp(index, 0, next.length), 0, block);
    return withKids(b, next);
  });
}

/**
 * Move a block to a new parent and index. The index is read against the tree
 * the block has already left. A move into the block itself, into its own
 * subtree or into something that is not a container changes nothing: each of
 * those would detach the branch from the page and lose it.
 */
export function moveTo(blocks: Block[], id: string, parentId: string | null, index: number): Block[] {
  const block = findById(blocks, id);
  if (!block) return blocks;
  if (parentId !== null) {
    const parent = findById(blocks, parentId);
    if (!parent || !isContainerType(parent.type) || isSelfOrDescendant(blocks, id, parentId)) return blocks;
  }
  return insertAt(removeById(blocks, id), parentId, index, block);
}

/** Replace one block, wherever it is, with the result of `fn`. */
export function patchById(blocks: Block[], id: string, fn: (b: Block) => Block): Block[] {
  return blocks.map((b) => {
    if (b.id === id) return fn(b);
    return isContainerType(b.type) ? withKids(b, patchById(kids(b), id, fn)) : b;
  });
}

/** Move a block one place up or down among its siblings. */
export function nudge(blocks: Block[], id: string, delta: -1 | 1): Block[] {
  const parent = parentIdOf(blocks, id);
  if (parent === undefined) return blocks;
  const siblings = parent === null ? blocks : kids(findById(blocks, parent) as Block);
  const from = siblings.findIndex((b) => b.id === id);
  const to = from + delta;
  if (to < 0 || to >= siblings.length) return blocks;
  return moveTo(blocks, id, parent, to);
}

/** Every block, depth first. */
export function flatten(blocks: Block[]): Block[] {
  return blocks.flatMap((b) => [b, ...flatten(kids(b))]);
}

const reId = (b: Block): Block => ({
  ...structuredClone(b),
  id: newId(),
  ...(b.children ? { children: b.children.map(reId) } : {}),
});

/** A copy of a block, with new ids all the way down, placed right after it. */
export function duplicate(blocks: Block[], id: string): Block[] {
  const block = findById(blocks, id);
  const parent = parentIdOf(blocks, id);
  if (!block || parent === undefined) return blocks;
  const siblings = parent === null ? blocks : kids(findById(blocks, parent) as Block);
  return insertAt(blocks, parent, siblings.findIndex((b) => b.id === id) + 1, reId(block));
}
