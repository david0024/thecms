/**
 * A small XML reader, enough for a WordPress export file (ADR 0009).
 *
 * It reads elements, attributes, text and CDATA into a tree, and nothing
 * else: no DTD, no external entities, no namespaces beyond keeping the prefix
 * in the name (`wp:post_id`). Not resolving entities a file declares is on
 * purpose: that is how an XML file is made to read other files.
 */

export interface XmlElement {
  name: string;
  attrs: Record<string, string>;
  children: XmlElement[];
  /** The text directly inside, CDATA included, entities decoded. */
  text: string;
}

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** `&amp;` and `&#8217;` as the characters they stand for. An entity it does not know is left as written. */
export function decodeXml(value: string): string {
  if (!value.includes('&')) return value;
  return value.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-z]+);/g, (whole, name: string) => {
    if (name[0] !== '#') return NAMED[name] ?? whole;
    const code = name[1] === 'x' ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '';
  });
}

const ATTR = /([^\s=/]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/** The file as a tree. Throws when it is not well formed, saying where. */
export function parseXml(source: string): XmlElement {
  const root: XmlElement = { name: '', attrs: {}, children: [], text: '' };
  const stack: XmlElement[] = [root];
  const top = (): XmlElement => stack[stack.length - 1] as XmlElement;
  const fail = (at: number, what: string): never => {
    const line = source.slice(0, at).split('\n').length;
    throw new Error(`not a well-formed XML file: ${what} (line ${line})`);
  };
  const until = (from: number, end: string, what: string): number => {
    const at = source.indexOf(end, from);
    return at < 0 ? fail(from, `${what} is never closed`) : at;
  };

  let i = 0;
  while (i < source.length) {
    const lt = source.indexOf('<', i);
    if (lt < 0) break;
    if (lt > i) top().text += decodeXml(source.slice(i, lt));
    if (source.startsWith('<![CDATA[', lt)) {
      const end = until(lt, ']]>', 'a CDATA section');
      top().text += source.slice(lt + 9, end);
      i = end + 3;
    } else if (source.startsWith('<!--', lt)) {
      i = until(lt, '-->', 'a comment') + 3;
    } else if (source.startsWith('<?', lt)) {
      i = until(lt, '?>', 'a processing instruction') + 2;
    } else if (source.startsWith('<!', lt)) {
      i = until(lt, '>', 'a declaration') + 1;
    } else if (source[lt + 1] === '/') {
      const end = until(lt, '>', 'a closing tag');
      const name = source.slice(lt + 2, end).trim();
      if (stack.length < 2 || top().name !== name) fail(lt, `</${name}> closes nothing that is open`);
      stack.pop();
      i = end + 1;
    } else {
      const end = until(lt, '>', 'a tag');
      const selfClosing = source[end - 1] === '/';
      const inner = source.slice(lt + 1, selfClosing ? end - 1 : end);
      const name = /^[^\s/]+/.exec(inner)?.[0] ?? fail(lt, 'a tag has no name');
      const element: XmlElement = { name, attrs: {}, children: [], text: '' };
      for (const m of inner.slice(name.length).matchAll(ATTR)) element.attrs[m[1] as string] = decodeXml(m[2] ?? m[3] ?? '');
      top().children.push(element);
      if (!selfClosing) stack.push(element);
      i = end + 1;
    }
  }
  if (stack.length > 1) fail(source.length, `<${top().name}> is never closed`);
  const first = root.children[0];
  if (!first) throw new Error('not a well-formed XML file: it holds no element');
  return first;
}

export const child = (el: XmlElement, name: string): XmlElement | undefined => el.children.find((c) => c.name === name);
export const childrenOf = (el: XmlElement, name: string): XmlElement[] => el.children.filter((c) => c.name === name);
/** The text of a child, trimmed; '' when there is no such child. */
export const textOf = (el: XmlElement, name: string): string => child(el, name)?.text.trim() ?? '';
