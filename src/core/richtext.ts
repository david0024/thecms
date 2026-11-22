/**
 * Rich text as a document, not as HTML.
 *
 * Stored HTML has to be sanitised on every write and every read, and one miss
 * is a script running for every visitor. A document of typed nodes has no such
 * path: a renderer draws the nodes it knows and escapes every string, so there
 * is nothing to sanitise.
 */
import { isObject, safeHref, str } from './util.ts';

export const MARKS = ['bold', 'italic', 'code'] as const;
export type Mark = (typeof MARKS)[number];

export interface Span {
  text: string;
  marks?: Mark[];
  /** A link; checked with `safeHref`. */
  href?: string;
  /** The link asks search engines not to follow it: `rel="nofollow"` (ADR 0058 d6). Only with `href`. */
  nofollow?: true;
}

export type RichNode =
  | { type: 'paragraph'; children: Span[] }
  | { type: 'heading'; level: 2 | 3 | 4; children: Span[] }
  | { type: 'quote'; children: Span[] }
  | { type: 'list'; ordered: boolean; items: Span[][] };

export type RichText = RichNode[];

const MAX_NODES = 2000;
const MAX_SPANS = 500;

function spans(input: unknown): Span[] {
  if (!Array.isArray(input)) return [];
  const out: Span[] = [];
  for (const raw of input.slice(0, MAX_SPANS)) {
    if (!isObject(raw)) continue;
    const text = str(raw.text, 20_000);
    if (!text) continue;
    const span: Span = { text };
    if (Array.isArray(raw.marks)) {
      const marks = MARKS.filter((m) => (raw.marks as unknown[]).includes(m));
      if (marks.length) span.marks = marks;
    }
    const href = safeHref(raw.href);
    if (href) span.href = href;
    if (href && raw.nofollow === true) span.nofollow = true;
    out.push(span);
  }
  return out;
}

/** Untrusted input as a clean document. Unknown node types are dropped. */
export function normalizeRichText(input: unknown): RichText {
  if (!Array.isArray(input)) return [];
  const out: RichText = [];
  for (const raw of input.slice(0, MAX_NODES)) {
    if (!isObject(raw)) continue;
    switch (raw.type) {
      case 'paragraph':
        out.push({ type: 'paragraph', children: spans(raw.children) });
        break;
      case 'quote':
        out.push({ type: 'quote', children: spans(raw.children) });
        break;
      case 'heading': {
        const level = raw.level === 3 ? 3 : raw.level === 4 ? 4 : 2;
        out.push({ type: 'heading', level, children: spans(raw.children) });
        break;
      }
      case 'list': {
        const items = Array.isArray(raw.items) ? raw.items.slice(0, 200).map(spans) : [];
        out.push({ type: 'list', ordered: raw.ordered === true, items });
        break;
      }
    }
  }
  return out;
}

/** Plain paragraphs as a document: what a new text block starts from. */
export function paragraphs(...texts: string[]): RichText {
  return texts.map((text) => ({ type: 'paragraph', children: [{ text }] }));
}

const spanText = (children: Span[]): string => children.map((s) => s.text).join('');

/** The document's words, for excerpts, search and meta descriptions. */
export function richTextPlain(doc: RichText): string {
  return doc
    .map((node) => (node.type === 'list' ? node.items.map(spanText).join(' ') : spanText(node.children)))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}
