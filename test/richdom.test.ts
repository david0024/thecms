import { expect, test } from 'bun:test';
import { type DomNode, domToRichText } from '../src/admin/richdom.ts';

const t = (text: string): DomNode => ({ nodeType: 3, nodeName: '#text', textContent: text, childNodes: [] });
const el = (name: string, kids: DomNode[], attrs: Record<string, string> = {}): DomNode => ({
  nodeType: 1,
  nodeName: name,
  textContent: null,
  childNodes: kids,
  getAttribute: (n) => attrs[n] ?? null,
});

test('reads paragraphs, headings, quotes, lists, marks and links', () => {
  const doc = domToRichText(
    el('DIV', [
      el('H1', [t('Title')]),
      el('P', [t('Plain '), el('STRONG', [t('bold '), el('EM', [t('both')])]), t(' '), el('A', [t('link')], { href: '/about/' })]),
      el('BLOCKQUOTE', [t('Said')]),
      el('OL', [el('LI', [t('one')]), el('LI', [el('CODE', [t('two')])]), el('LI', [])]),
      el('H5', [t('Small')]),
    ]),
  );
  expect(doc).toEqual([
    { type: 'heading', level: 2, children: [{ text: 'Title' }] },
    {
      type: 'paragraph',
      children: [{ text: 'Plain ' }, { text: 'bold ', marks: ['bold'] }, { text: 'both', marks: ['bold', 'italic'] }, { text: ' ' }, { text: 'link', href: '/about/' }],
    },
    { type: 'quote', children: [{ text: 'Said' }] },
    { type: 'list', ordered: true, items: [[{ text: 'one' }], [{ text: 'two', marks: ['code'] }]] },
    { type: 'heading', level: 4, children: [{ text: 'Small' }] },
  ]);
});

test('keeps nothing of pasted markup but its words', () => {
  const doc = domToRichText(
    el('DIV', [
      t('loose text'),
      el('SPAN', [t(' in a span')], { style: 'color:red', onclick: 'alert(1)' }),
      el('DIV', [el('P', [t('wrapped')])]),
      el('P', [el('A', [t('bad link')], { href: 'javascript:alert(1)' }), el('SCRIPT', [t('alert(2)')])]),
      el('P', [el('BR', [])]),
      el('IMG', [], { src: 'x', onerror: 'alert(3)' }),
    ]),
  );
  expect(doc).toEqual([
    { type: 'paragraph', children: [{ text: 'loose text in a span' }] },
    { type: 'paragraph', children: [{ text: 'wrapped' }] },
    { type: 'paragraph', children: [{ text: 'bad link' }, { text: 'alert(2)' }] },
  ]);
});
