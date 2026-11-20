/**
 * Sections (ADR 0033): blocks written once ("Get in touch", an offer) and
 * shown on any number of pages through a block of type `section`. A section
 * is kept like a page, with a title, blocks and translations by field
 * (ADR 0032), and has no address of its own.
 *
 * A page keeps only the section's name. When a page is drawn, each section
 * block gets the section's blocks, in the page's language, as its children;
 * so the export writes them out as HTML and the site stays static.
 */
import type { Block } from './blocks.ts';
import { localizeBlocks } from './localize.ts';
import type { Page } from './page.ts';

/** What the admin calls the sections when it edits one, as `page` or a content type's name: no content type can have this name. */
export const SECTION_KIND = '_section';

/** How many sections a site keeps. */
export const MAX_SECTIONS = 100;

/** The names of the sections these blocks show, each once. */
export function sectionsIn(blocks: Block[]): string[] {
  const out = new Set<string>();
  const walk = (list: Block[]): void => {
    for (const block of list) {
      if (block.type === 'section' && typeof block.content.section === 'string' && block.content.section) out.add(block.content.section);
      if (block.children && block.type !== 'section') walk(block.children);
    }
  };
  walk(blocks);
  return [...out];
}

/** A section's blocks in a language: its words there, its own blocks when it is split, or the main language's. */
export function sectionBlocks(section: Page, language: string): Block[] {
  const translation = section.translations?.[language];
  if (!translation) return section.blocks;
  return translation.blocks ?? localizeBlocks(section.blocks, translation.fields);
}

/** A section met inside a section draws nothing: a section never holds itself. */
const flat = (blocks: Block[]): Block[] =>
  blocks.flatMap((b) => (b.type === 'section' ? [] : [b.children ? { ...b, children: flat(b.children) } : b]));

/**
 * The blocks with each section block holding its section's blocks, in this
 * language. A section that is missing (deleted, or not published) shows
 * nothing.
 */
export function fillSections(blocks: Block[], sections: readonly Page[], language: string): Block[] {
  if (sections.length === 0 || !blocks.some(function has(b: Block): boolean { return b.type === 'section' || (b.children ?? []).some(has); })) return blocks;
  const byName = new Map(sections.map((s) => [s.slug, s]));
  const walk = (list: Block[]): Block[] =>
    list.map((block) => {
      if (block.type === 'section') {
        const section = byName.get(String(block.content.section ?? ''));
        return { ...block, children: section ? flat(sectionBlocks(section, language)) : [] };
      }
      return block.children ? { ...block, children: walk(block.children) } : block;
    });
  return walk(blocks);
}
