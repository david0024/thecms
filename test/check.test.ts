/** The check before publishing (ADR 0029): links that lead nowhere, pictures with no words. */
import { expect, test } from 'bun:test';
import { checkSite, describeCheck } from '../src/site/check.ts';

const files = new Map<string, string | Uint8Array>([
  ['index.html', '<a href="/about/">About</a><a class="x" href="/servicii/#oak">Services</a><a href="https://elsewhere.example/">Out</a><a href="//cdn.example/x">CDN</a><img src="/media/a.webp" alt="An oak table"><img src="/media/b.webp" alt=""><a href="/assets/site.css">css</a>'],
  ['about/index.html', '<a href="/servicii/?x=1">Again</a><a href="/caf%C3%A9/">Café</a><a href="/%E0%A4%A/">bad</a><img alt="  " src="/media/b.webp"><img src="/media/c&amp;d.webp"><a href="/a&amp;b">amp</a><a href="/blog">blog</a>'],
  ['café/index.html', '<p>ok</p>'],
  ['blog/index.html', '<p>ok</p>'],
  ['404.html', '<a href="/servicii/">Services</a>'],
  ['assets/site.css', 'a{}'],
  ['media/a.webp', new Uint8Array([1])],
  ['x/index.html', new Uint8Array([1])],
]);

test('a link to an address nothing answers is found, with every page that has it', () => {
  const check = checkSite(files);
  expect(check.broken).toEqual([
    { href: '/%E0%A4%A/', from: ['/about/'] },
    { href: '/a&b', from: ['/about/'] },
    { href: '/servicii/', from: ['/', '/404.html', '/about/'] },
  ]);
  expect(check.unnamed).toEqual([
    { src: '/media/b.webp', on: ['/', '/about/'] },
    { src: '/media/c&d.webp', on: ['/about/'] },
  ]);
});

test('said in plain lines, a long list of pages cut short', () => {
  const lines = describeCheck({ broken: [{ href: '/x/', from: ['/', '/a/', '/b/', '/c/', '/d/'] }], unnamed: [{ src: '/media/b.webp', on: ['/'] }] });
  expect(lines).toEqual({ problems: ['/x/ does not exist; linked from /, /a/, /b/ and 2 more'], warnings: ['/media/b.webp has no description, on /'] });
  expect(describeCheck(checkSite(new Map()))).toEqual({ problems: [], warnings: [] });
});
