/** A block of code (ADR 0067): kept as written, drawn as written, imported from `<pre>`. */
import { describe, expect, test } from 'bun:test';
import { type Block, blocksText, CODE_MAX, codeLanguage, describeBlocks, normalizeBlocks, normalizeSite, parseTheme, type Theme, wordsFrom } from '../src/core/index.ts';
import { type ContentContext, htmlToBlocks } from '../src/import/content.ts';
import { renderPage, renderParts } from '../src/site/document.ts';
import plain from '../themes/plain.json';

const theme = parseTheme(plain).theme as Theme;
const site = normalizeSite({ name: 'S' });
const blocks = (list: unknown[]): Block[] => normalizeBlocks(list).blocks;
const page = (list: unknown[]) => ({ slug: 'x', title: 'X', description: '', inMenu: false, blocks: blocks(list) });
const shown = (list: unknown[]): string => {
  const html = renderPage(site, theme, page(list), []);
  return html.slice(html.indexOf('<main'), html.indexOf('</main>'));
};
const lost: string[] = [];
const ctx: ContentContext = { link: (href) => href, image: (src) => src, attachment: () => null, lost: (what) => void lost.push(what) };

describe('a code block', () => {
  test('keeps every line and space, and only the blank lines around it go', () => {
    const [block] = blocks([{ type: 'code', content: { code: '\n\n  if (a) {\r\n\treturn 1;\r\n  }\n\n', language: 'TS' } }]);
    expect(block?.content.code).toBe('  if (a) {\n\treturn 1;\n  }');
    expect((block?.content.code as string).length).toBeLessThanOrEqual(CODE_MAX);
  });

  test('is drawn as written, escaped, with its language as a class', () => {
    const html = shown([{ type: 'code', content: { code: '<script>alert(1)</script>\n  two', language: 'html', caption: 'A file' } }]);
    expect(html).toContain('<pre class="code"><code class="language-html">&lt;script>alert(1)&lt;/script>\n  two</code></pre>');
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('<figcaption>A file</figcaption>');
  });

  test('a language that could not be a class name is left out', () => {
    expect(codeLanguage('c++')).toBe('c++');
    expect(codeLanguage(' Shell ')).toBe('shell');
    expect(codeLanguage('a" onclick="x')).toBe('');
    expect(shown([{ type: 'code', content: { code: 'x', language: 'a b' } }])).toContain('<pre class="code"><code>x</code></pre>');
  });

  test('can be typed on the page, line by line', () => {
    const body = renderParts(site, theme, page([{ type: 'code', content: { code: 'ls' } }]), [], true).body;
    expect(body).toMatch(/<code[^>]*data-edit="code"[^>]*data-multiline="1"/);
  });

  test('is not translated, and stays out of a description', () => {
    const list = blocks([{ type: 'code', content: { code: 'uhlaka update', caption: 'Updates the program' } }, { type: 'text', content: { body: [{ type: 'paragraph', children: [{ text: 'Words.' }] }] } }]);
    // The caption is translated; the code is the same in every language, changed only on the main page.
    const written = structuredClone(list);
    Object.assign((written[0] as Block).content, { caption: 'Actualizează programul' });
    expect(JSON.stringify(wordsFrom(list, written).fields)).toContain('Actualizează programul');
    Object.assign((written[0] as Block).content, { code: 'altceva' });
    expect(wordsFrom(list, written).problem).not.toBe('');
    expect(describeBlocks(list)).not.toContain('uhlaka update');
    expect(blocksText(list)).not.toContain('uhlaka update');
  });
});

describe('preformatted text, imported', () => {
  test('becomes a code block with its language, its spaces kept', () => {
    lost.length = 0;
    const out = htmlToBlocks('<p>Run:</p><pre><code class="language-sh">curl -fsSL https://x.example/install.sh | sh\n  --host=server\n</code></pre><p>Done.</p>', ctx);
    expect(out.map((b) => b.type)).toEqual(['text', 'code', 'text']);
    expect(out[1]?.content).toMatchObject({ code: 'curl -fsSL https://x.example/install.sh | sh\n  --host=server', language: 'sh' });
    expect(lost).toEqual([]);
  });

  test('WordPress\'s code and preformatted blocks, entities and line breaks', () => {
    const out = htmlToBlocks('<pre class="wp-block-code"><code>a &lt; b &amp;&amp; c</code></pre><pre class="wp-block-preformatted">one<br>  two</pre><pre>   </pre>', ctx);
    expect(out.map((b) => b.content.code)).toEqual(['a < b && c', 'one\n  two']);
    expect(normalizeBlocks(out).issues).toEqual([]);
  });
});
