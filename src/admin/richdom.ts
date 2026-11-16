/**
 * What an author typed into an editable rich text area, read back as a
 * document. The browser's DOM is only the typing surface: nothing of its
 * markup is kept, only which of our node types and marks it shows.
 *
 * Written against a minimal node shape so it can be tested without a browser.
 */
import { type Mark, normalizeRichText, type RichNode, type RichText, type Span } from '../core/index.ts';

export interface DomNode {
  nodeType: number;
  nodeName: string;
  textContent: string | null;
  childNodes: ArrayLike<DomNode>;
  getAttribute?: (name: string) => string | null;
}

const TEXT = 3;
const ELEMENT = 1;
const MARK_OF: Record<string, Mark> = { B: 'bold', STRONG: 'bold', I: 'italic', EM: 'italic', CODE: 'code' };
const BLOCKS = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'UL', 'OL', 'LI']);

const children = (node: DomNode): DomNode[] => Array.from(node.childNodes);

function spansOf(node: DomNode, marks: Mark[], href: string, out: Span[]): Span[] {
  for (const child of children(node)) {
    if (child.nodeType === TEXT) {
      const text = (child.textContent ?? '').replace(/ /g, ' ');
      if (!text) continue;
      const last = out[out.length - 1];
      if (last && (last.href ?? '') === href && (last.marks ?? []).join() === marks.join()) last.text += text;
      else out.push({ text, ...(marks.length ? { marks: [...marks] } : {}), ...(href ? { href } : {}) });
    } else if (child.nodeType === ELEMENT) {
      if (child.nodeName === 'BR') continue;
      const mark = MARK_OF[child.nodeName];
      const nextMarks = mark && !marks.includes(mark) ? [...marks, mark] : marks;
      const nextHref = child.nodeName === 'A' ? (child.getAttribute?.('href') ?? '') : href;
      spansOf(child, nextMarks, nextHref, out);
    }
  }
  return out;
}

const hasBlockChild = (node: DomNode): boolean => children(node).some((c) => c.nodeType === ELEMENT && BLOCKS.has(c.nodeName));

function walk(node: DomNode, out: RichNode[]): void {
  let loose: DomNode[] = [];
  const flush = (): void => {
    if (!loose.length) return;
    const spans = spansOf({ nodeType: ELEMENT, nodeName: 'P', textContent: null, childNodes: loose }, [], '', []);
    if (spans.length) out.push({ type: 'paragraph', children: spans });
    loose = [];
  };
  for (const child of children(node)) {
    if (child.nodeType !== ELEMENT || !BLOCKS.has(child.nodeName)) {
      loose.push(child);
      continue;
    }
    flush();
    const name = child.nodeName;
    if (name === 'UL' || name === 'OL') {
      const items = children(child)
        .filter((li) => li.nodeName === 'LI')
        .map((li) => spansOf(li, [], '', []))
        .filter((spans) => spans.length);
      if (items.length) out.push({ type: 'list', ordered: name === 'OL', items });
    } else if (hasBlockChild(child)) {
      walk(child, out); // a wrapper the browser added around real blocks
    } else {
      const spans = spansOf(child, [], '', []);
      if (!spans.length) continue;
      if (name === 'BLOCKQUOTE') out.push({ type: 'quote', children: spans });
      else if (/^H[1-6]$/.test(name)) out.push({ type: 'heading', level: name === 'H3' ? 3 : name <= 'H2' ? 2 : 4, children: spans });
      else out.push({ type: 'paragraph', children: spans });
    }
  }
  flush();
}

export function domToRichText(root: DomNode): RichText {
  const out: RichNode[] = [];
  walk(root, out);
  return normalizeRichText(out);
}
