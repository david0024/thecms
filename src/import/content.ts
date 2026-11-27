/**
 * Content written as HTML, as blocks (ADR 0009).
 *
 * The converter reads meaning and leaves appearance behind: a heading stays a
 * heading, a link a link, an image an image. Classes, inline styles, fonts and
 * layouts are not brought over, because here they belong to the theme. What
 * has no block to become (a form, a script, an embedded player) is left out
 * and named through `lost`, so the owner is told instead of finding out.
 */
import { type Block, CODE_MAX, codeLanguage, TABLE_MAX_COLUMNS, TABLE_MAX_ROWS, type Mark, newId, type RichNode, type Span } from '../core/index.ts';
import { find, type HtmlElement, type HtmlNode, isElement, parseHtml, plainText } from './html.ts';

export interface ContentContext {
  /** An address as written in the old site, as the address to use here. */
  link(href: string): string;
  /** An image's address as written, as the address to use here; '' leaves the image out. */
  image(src: string): string;
  /** The image an attachment number stands for (a gallery names its pictures by number). */
  attachment(id: string): { src: string; alt: string } | null;
  /** Says that something could not be brought over as it was; `which` names the one of its kind (a shortcode's name). */
  lost(what: string, which?: string): void;
}

type Piece = Span | 'break';
type Item =
  | { kind: 'rich'; node: RichNode }
  | { kind: 'image'; src: string; alt: string; caption: string }
  | { kind: 'code'; code: string; language: string }
  | { kind: 'table'; header: boolean; rows: string[][] };

const INLINE = new Set([
  'a', 'abbr', 'b', 'big', 'br', 'cite', 'code', 'del', 'em', 'font', 'i', 'img', 'ins', 'kbd', 'label', 'mark', 'q', 's',
  'samp', 'small', 'span', 'strike', 'strong', 'sub', 'sup', 'time', 'tt', 'u', 'var',
]);
const MARK_OF: Record<string, Mark> = { b: 'bold', strong: 'bold', i: 'italic', em: 'italic', code: 'code', kbd: 'code', samp: 'code', tt: 'code' };
const EMBEDS = new Set(['iframe', 'video', 'audio', 'embed', 'object', 'canvas', 'svg', 'math']);
const FORMS = new Set(['form', 'input', 'select', 'button', 'textarea', 'fieldset']);
const SILENT = new Set(['style', 'noscript', 'template', 'hr', 'link', 'meta', 'figcaption']);

const LOST = {
  embed: 'embedded media (video, maps, audio): a link was kept where the address was known',
  form: 'forms',
  script: 'scripts',
  table: 'tables too large for a table block, or one inside another: their text was kept, one line for each row',
  columns: 'column layouts: their content was kept, one part under another',
  nested: 'lists inside lists: the items were kept in one list',
  dynamic: 'blocks WordPress fills in by itself',
  shortcode: 'shortcodes, which call a plugin of the old site',
};

const sameFormat = (a: Span, b: Span): boolean => a.href === b.href && !!a.nofollow === !!b.nofollow && (a.marks ?? []).join() === (b.marks ?? []).join();

/** Spans with their spaces settled: none doubled, none at either end, neighbours with one format joined. */
function tidy(spans: Span[]): Span[] {
  const out: Span[] = [];
  for (const span of spans) {
    const last = out[out.length - 1];
    let text = span.text.replace(/[ \t\n\r\f]+/g, ' ');
    if (!last || last.text.endsWith(' ')) text = text.replace(/^ /, '');
    if (!text) continue;
    if (last && sameFormat(last, span)) last.text += text;
    else out.push({ ...span, text });
  }
  const last = out[out.length - 1];
  if (last) {
    last.text = last.text.replace(/ $/, '');
    if (!last.text) out.pop();
  }
  return out;
}

const isBareUrl = (spans: Span[]): boolean => spans.length === 1 && !spans[0]?.href && /^https?:\/\/\S+$/.test(spans[0]?.text ?? '');

class Converter {
  private readonly items: Item[] = [];

  constructor(
    private readonly ctx: ContentContext,
    /** Written in the classic editor: there a line break in the text is a line break on the page. */
    private readonly classic: boolean,
  ) {}

  blocks(nodes: HtmlNode[]): Block[] {
    this.flow(nodes, this.items);
    const out: Block[] = [];
    let body: RichNode[] = [];
    const flush = (): void => {
      if (body.length) out.push({ id: newId(), type: 'text', content: { body } });
      body = [];
    };
    for (const item of this.items) {
      if (item.kind === 'rich') {
        body.push(item.node);
        continue;
      }
      flush();
      if (item.kind === 'table') out.push({ id: newId(), type: 'table', content: { title: '', table: { header: item.header, rows: item.rows }, caption: '' } });
      else if (item.kind === 'code') out.push({ id: newId(), type: 'code', content: { title: '', code: item.code, language: item.language, caption: '' } });
      else out.push({ id: newId(), type: 'image', content: { image: { src: item.src, alt: item.alt }, caption: item.caption } });
    }
    flush();
    return out;
  }

  private image(el: HtmlElement, caption = ''): Item | null {
    const written = el.attrs.src && !el.attrs.src.startsWith('data:') ? el.attrs.src : (el.attrs['data-lazy-src'] ?? el.attrs['data-src'] ?? '');
    const src = written ? this.ctx.image(written.trim()) : '';
    return src ? { kind: 'image', src, alt: (el.attrs.alt ?? '').trim(), caption } : null;
  }

  /** What is inside as formatted text. Images met on the way are set aside in `images`. */
  private inline(nodes: HtmlNode[], marks: Mark[], href: string, out: Piece[], images: Item[], nofollow = false): void {
    for (const node of nodes) {
      if (!isElement(node)) {
        const lines = this.classic ? node.split(/\r?\n/) : [node];
        lines.forEach((line, i) => {
          if (i > 0) out.push('break');
          if (line) out.push({ text: line, ...(marks.length ? { marks } : {}), ...(href ? { href } : {}), ...(href && nofollow ? { nofollow: true as const } : {}) });
        });
        continue;
      }
      if (node.tag === 'br') out.push('break');
      else if (node.tag === 'img') {
        const image = this.image(node);
        if (image) images.push(image);
      } else if (node.tag === 'script') this.ctx.lost(LOST.script);
      else if (EMBEDS.has(node.tag)) this.ctx.lost(LOST.embed);
      else if (FORMS.has(node.tag)) this.ctx.lost(LOST.form);
      else if (SILENT.has(node.tag)) continue;
      else {
        const mark = MARK_OF[node.tag];
        const inner = mark && !marks.includes(mark) ? [...marks, mark] : marks;
        const link = node.tag === 'a' && !!node.attrs.href;
        const to = link ? this.ctx.link((node.attrs.href as string).trim()) : href;
        // A link WordPress kept as rel="nofollow" (or "sponsored", "ugc") stays one (ADR 0058 d6).
        const unfollowed = link ? /\b(nofollow|sponsored|ugc)\b/i.test(node.attrs.rel ?? '') : nofollow;
        const apart = !INLINE.has(node.tag);
        // Two blocks side by side are two sets of words, not one run-on word.
        if (apart) out.push({ text: ' ' });
        this.inline(node.children, inner, to, out, images, unfollowed);
        if (apart) out.push({ text: ' ' });
      }
    }
  }

  /** One line of formatted text: a heading, a list item. Line breaks become spaces. */
  private line(nodes: HtmlNode[], images: Item[]): Span[] {
    const pieces: Piece[] = [];
    this.inline(nodes, [], '', pieces, images);
    return tidy(pieces.map((p) => (p === 'break' ? { text: ' ' } : p)));
  }

  /** Running text as paragraphs: a line break starts a new one. */
  private paragraphs(nodes: HtmlNode[], into: Item[], make: (children: Span[]) => RichNode = (children) => ({ type: 'paragraph', children })): void {
    const pieces: Piece[] = [];
    const images: Item[] = [];
    const before: Item[] = [];
    let wrote = false;
    // An image that comes before the words is shown before them.
    const seen = (): void => {
      if (!wrote) before.push(...images.splice(0));
    };
    for (const node of nodes) {
      this.inline([node], [], '', pieces, images);
      seen();
      if (pieces.some((p) => p !== 'break' && p.text.trim())) wrote = true;
    }
    into.push(...before);
    let current: Span[] = [];
    const flush = (): void => {
      const spans = tidy(current);
      current = [];
      if (!spans.length) return;
      const only = spans[0] as Span;
      into.push({ kind: 'rich', node: make(isBareUrl(spans) ? [{ ...only, href: this.ctx.link(only.text) }] : spans) });
    };
    for (const piece of pieces) {
      if (piece === 'break') flush();
      else current.push(piece);
    }
    flush();
    into.push(...images);
  }

  private list(el: HtmlElement, into: Item[]): void {
    const items: Span[][] = [];
    const images: Item[] = [];
    const walk = (list: HtmlElement, depth: number): void => {
      if (depth > 0) this.ctx.lost(LOST.nested);
      for (const li of list.children) {
        if (!isElement(li)) continue;
        if (li.tag !== 'li') {
          if (li.tag === 'ul' || li.tag === 'ol') walk(li, depth + 1);
          continue;
        }
        const nested = li.children.filter((c): c is HtmlElement => isElement(c) && (c.tag === 'ul' || c.tag === 'ol'));
        const spans = this.line(li.children.filter((c) => !nested.includes(c as HtmlElement)), images);
        if (spans.length) items.push(spans);
        for (const inner of nested) walk(inner, depth + 1);
      }
    };
    walk(el, 0);
    if (items.length) into.push({ kind: 'rich', node: { type: 'list', ordered: el.tag === 'ol', items } });
    into.push(...images);
  }

  private figure(el: HtmlElement, into: Item[]): void {
    const inner = el.children.filter(isElement);
    // A gallery is a figure of figures: each picture keeps its own caption.
    if (inner.some((c) => find([c], 'figure')) || !find(el.children, 'img')) return this.flow(el.children, into);
    const caption = plainText(find(el.children, 'figcaption')?.children ?? []).slice(0, 300);
    const collect = (nodes: HtmlNode[]): void => {
      for (const node of nodes) {
        if (!isElement(node)) continue;
        if (node.tag === 'img') {
          const image = this.image(node, caption);
          if (image) into.push(image);
        } else collect(node.children);
      }
    };
    collect(el.children);
  }

  /**
   * A table as a table block (ADR 0067 d5): the text of each cell, the first
   * row its headings when it is in `<thead>` or made of `<th>`. A table larger
   * than a block holds, or one inside another, keeps its text one line a row.
   */
  private table(el: HtmlElement, into: Item[]): void {
    const found: { cells: string[]; head: boolean }[] = [];
    let nested = false;
    const rows = (nodes: HtmlNode[], inHead: boolean): void => {
      for (const node of nodes) {
        if (!isElement(node)) continue;
        if (node.tag === 'table') nested = true;
        if (node.tag !== 'tr') {
          rows(node.children, inHead || node.tag === 'thead');
          continue;
        }
        const cells = node.children.filter(isElement).filter((cell) => cell.tag === 'td' || cell.tag === 'th');
        found.push({ cells: cells.map((cell) => plainText(cell.children).replace(/\s+/g, ' ').trim()), head: inHead || (cells.length > 0 && cells.every((cell) => cell.tag === 'th')) });
      }
    };
    rows(el.children, false);
    // A Markdown table with no headings has a row of empty ones.
    if (found[0]?.head && found[0].cells.every((cell) => !cell)) found.shift();
    const kept = found.filter((row) => row.cells.some(Boolean));
    if (!kept.length) return;
    if (nested || kept.length > TABLE_MAX_ROWS || kept.some((row) => row.cells.length > TABLE_MAX_COLUMNS)) {
      this.ctx.lost(LOST.table);
      for (const row of kept) into.push({ kind: 'rich', node: { type: 'paragraph', children: [{ text: row.cells.filter(Boolean).join(' · ') }] } });
      return;
    }
    into.push({ kind: 'table', header: (kept[0] as { head: boolean }).head && kept.length > 1, rows: kept.map((row) => row.cells.map((cell) => cell.slice(0, 500))) });
  }

  private block(el: HtmlElement, into: Item[]): void {
    const tag = el.tag;
    if (tag === 'p') return this.paragraphs(el.children, into);
    if (/^h[1-6]$/.test(tag)) {
      const images: Item[] = [];
      const children = this.line(el.children, images);
      const level = tag === 'h1' || tag === 'h2' ? 2 : tag === 'h3' ? 3 : 4;
      if (children.length) into.push({ kind: 'rich', node: { type: 'heading', level, children } });
      into.push(...images);
      return;
    }
    if (tag === 'ul' || tag === 'ol') return this.list(el, into);
    if (tag === 'figure') return this.figure(el, into);
    if (tag === 'table') return this.table(el, into);
    if (tag === 'blockquote') {
      const inside: Item[] = [];
      this.flow(el.children, inside);
      for (const item of inside) {
        into.push(item.kind === 'rich' && item.node.type === 'paragraph' ? { kind: 'rich', node: { type: 'quote', children: item.node.children } } : item);
      }
      return;
    }
    // Preformatted text is a code block, its lines and spaces kept (ADR 0067);
    // the language is read from `class="language-…"`, as Markdown and WordPress write it.
    if (tag === 'pre') {
      const code = rawText(el.children).replace(/\r\n?/g, '\n').replace(/^(?:[ \t]*\n)+/, '').replace(/\s+$/, '');
      if (!code) return;
      const named = [el, ...el.children.filter(isElement)].map((e) => /\blang(?:uage)?-([A-Za-z0-9+#.-]+)/.exec(e.attrs.class ?? '')?.[1] ?? '').find(Boolean);
      into.push({ kind: 'code', code: code.slice(0, CODE_MAX), language: codeLanguage(named) });
      return;
    }
    if (tag === 'script') return this.ctx.lost(LOST.script);
    if (FORMS.has(tag)) return this.ctx.lost(LOST.form);
    if (EMBEDS.has(tag)) {
      this.ctx.lost(LOST.embed);
      const src = /^https?:\/\//i.test(el.attrs.src ?? '') ? (el.attrs.src as string) : '';
      if (src) into.push({ kind: 'rich', node: { type: 'paragraph', children: [{ text: src, href: src }] } });
      return;
    }
    if (SILENT.has(tag)) return;
    if (/\bwp-block-columns\b/.test(el.attrs.class ?? '')) this.ctx.lost(LOST.columns);
    this.flow(el.children, into);
  }

  private flow(nodes: HtmlNode[], into: Item[]): void {
    let run: HtmlNode[] = [];
    const flush = (): void => {
      if (run.length) this.paragraphs(run, into);
      run = [];
    };
    for (const node of nodes) {
      if (!isElement(node) || INLINE.has(node.tag)) {
        run.push(node);
        continue;
      }
      flush();
      this.block(node, into);
    }
    flush();
  }
}

/** The text inside, every space and line kept: a `<br>` is a line. */
function rawText(nodes: HtmlNode[]): string {
  return nodes.map((n) => (isElement(n) ? (n.tag === 'br' ? '\n' : rawText(n.children)) : n)).join('');
}

const attr = (value: string): string => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/**
 * Shortcodes are WordPress's own notation inside the text. The two that stand
 * for pictures are turned into pictures; any other is a call to a plugin that
 * is not here, so it is taken out and named.
 */
function shortcodes(html: string, ctx: ContentContext): string {
  let out = html.replace(/\[caption\b[^\]]*\]([\s\S]*?)\[\/caption\]/g, (_, inner: string) => {
    const m = /^([\s\S]*?<img\b[^>]*>(?:\s*<\/a>)?)([\s\S]*)$/.exec(inner);
    return m ? `<figure>${m[1]}<figcaption>${m[2]}</figcaption></figure>` : inner;
  });
  out = out.replace(/\[gallery\b([^\]]*)\]/g, (_, attrs: string) => {
    const ids = /\bids\s*=\s*["']?([\d,\s]+)/.exec(attrs)?.[1]?.split(',').map((id) => id.trim()) ?? [];
    const images = ids.map((id) => ctx.attachment(id)).filter((image) => image !== null);
    if (!images.length) ctx.lost(LOST.shortcode, 'gallery');
    return images.map((image) => `<figure><img src="${attr(image.src)}" alt="${attr(image.alt)}"></figure>`).join('');
  });
  // Only what is plainly a call: `[name key="value"]`, or a pair `[name]…[/name]`. "[sic]" is someone's words.
  const closed = new Set([...out.matchAll(/\[\/([a-zA-Z][\w-]*)\]/g)].map((m) => m[1]));
  return out.replace(/\[(\/?)([a-zA-Z][\w-]*)(\s[^\]<>]*)?\]/g, (whole, slash: string, name: string, rest: string | undefined) => {
    if (!slash && !closed.has(name) && !(rest ?? '').includes('=')) return whole;
    if (!slash) ctx.lost(LOST.shortcode, name);
    return '';
  });
}

/** A post's or a page's content, as WordPress stores it, as blocks. */
export function htmlToBlocks(html: string, ctx: ContentContext): Block[] {
  const classic = !html.includes('<!-- wp:');
  for (const m of html.matchAll(/<!--\s+wp:([a-z0-9/-]+)(?:\s+\{[^\n]*?\})?\s+\/-->/g)) {
    if (!['more', 'nextpage', 'spacer', 'separator'].includes(m[1] as string)) ctx.lost(LOST.dynamic, m[1] as string);
  }
  return new Converter(ctx, classic).blocks(parseHtml(shortcodes(html, ctx)));
}
