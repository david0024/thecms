/**
 * A forgiving HTML reader for content written elsewhere (ADR 0009).
 *
 * It only ever produces a tree to be read: nothing it returns is written to a
 * page as markup. So a mistake here loses some words at worst; it cannot let a
 * script through, because the converter keeps text and a short list of
 * meanings (a heading, a link, an image) and drops everything else.
 */

export interface HtmlElement {
  tag: string;
  attrs: Record<string, string>;
  children: HtmlNode[];
}
export type HtmlNode = HtmlElement | string;

export const isElement = (node: HtmlNode): node is HtmlElement => typeof node !== 'string';

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
/** Elements whose inside is not HTML. Their contents are skipped whole. */
const RAW = new Set(['script', 'style', 'noscript', 'template', 'textarea']);

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»', copy: '©', reg: '®', trade: '™',
  euro: '€', pound: '£', bull: '•', middot: '·', deg: '°', times: '×', shy: '',
};

export function decodeHtml(value: string): string {
  if (!value.includes('&')) return value;
  return value.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z]{2,8});/g, (whole, name: string) => {
    if (name[0] !== '#') return ENTITIES[name] ?? whole;
    const code = name[1] === 'x' || name[1] === 'X' ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '';
  });
}

const TAG = /^<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/;
const ATTR = /([^\s=/"'<>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

/** Opening one of these closes the same one still open: `<p>one<p>two`. */
const CLOSES_ITSELF = new Set(['p', 'li', 'dt', 'dd', 'tr', 'td', 'th', 'option']);

/** A piece of HTML as a tree. Never throws: what it cannot read becomes text or is skipped. */
export function parseHtml(source: string): HtmlNode[] {
  const root: HtmlElement = { tag: '', attrs: {}, children: [] };
  const stack: HtmlElement[] = [root];
  const top = (): HtmlElement => stack[stack.length - 1] as HtmlElement;
  const text = (value: string): void => {
    if (value) top().children.push(decodeHtml(value));
  };

  let i = 0;
  while (i < source.length) {
    const lt = source.indexOf('<', i);
    if (lt < 0) {
      text(source.slice(i));
      break;
    }
    text(source.slice(i, lt));
    if (source.startsWith('<!--', lt)) {
      const end = source.indexOf('-->', lt + 4);
      i = end < 0 ? source.length : end + 3;
      continue;
    }
    if (source[lt + 1] === '!' || source[lt + 1] === '?') {
      const end = source.indexOf('>', lt);
      i = end < 0 ? source.length : end + 1;
      continue;
    }
    const m = TAG.exec(source.slice(lt, lt + 20_000));
    if (!m) {
      // A lone "<": it was meant as a character.
      text('<');
      i = lt + 1;
      continue;
    }
    i = lt + m[0].length;
    const tag = (m[2] as string).toLowerCase();
    if (m[1]) {
      const open = stack.findLastIndex((el) => el.tag === tag);
      if (open > 0) stack.length = open;
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of (m[3] ?? '').matchAll(ATTR)) attrs[(a[1] as string).toLowerCase()] = decodeHtml(a[2] ?? a[3] ?? a[4] ?? '');
    if (RAW.has(tag)) {
      const close = source.toLowerCase().indexOf(`</${tag}`, i);
      const end = close < 0 ? -1 : source.indexOf('>', close);
      i = end < 0 ? source.length : end + 1;
      top().children.push({ tag, attrs, children: [] });
      continue;
    }
    if (CLOSES_ITSELF.has(tag) && top().tag === tag) stack.pop();
    const element: HtmlElement = { tag, attrs, children: [] };
    top().children.push(element);
    if (!VOID.has(tag) && !(m[3] ?? '').trimEnd().endsWith('/')) stack.push(element);
  }
  return root.children;
}

/** Every word inside, as one line of plain text. */
export function plainText(nodes: HtmlNode[]): string {
  const walk = (list: HtmlNode[]): string => list.map((n) => (isElement(n) ? (n.tag === 'br' ? ' ' : walk(n.children)) : n)).join('');
  return walk(nodes).replace(/\s+/g, ' ').trim();
}

/** The first element with this tag, anywhere inside. */
export function find(nodes: HtmlNode[], tag: string): HtmlElement | undefined {
  for (const node of nodes) {
    if (!isElement(node)) continue;
    if (node.tag === tag) return node;
    const inside = find(node.children, tag);
    if (inside) return inside;
  }
  return undefined;
}
