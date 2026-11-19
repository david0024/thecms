/**
 * The blocks the brief named for a presentation site that came after the first
 * slice: a gallery, questions and answers, testimonials and prices.
 */
import { describe, expect, test } from 'bun:test';
import { type Block, blocksText, imageSources, normalizeBlocks, normalizeSite, parseTheme, type Theme } from '../src/core/index.ts';
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
const edited = (list: unknown[]): string => renderParts(site, theme, page(list), [], true).body;
const attack = '<img src=x onerror=alert(1)>';

describe('a gallery', () => {
  test('keeps pictures with a safe address, each with its caption, and no more than it holds', () => {
    const [block] = blocks([
      {
        type: 'gallery',
        content: {
          title: 'Work',
          images: [
            { image: { src: '/media/a.webp', alt: 'A table' }, caption: 'Oak', extra: 'dropped' },
            { image: { src: 'javascript:alert(1)', alt: '' }, caption: 'Bad' },
            ...Array.from({ length: 60 }, () => ({ image: { src: '/media/b.webp', alt: '' } })),
          ],
        },
      },
    ]);
    const images = block?.content.images as { image: unknown; caption: string }[];
    expect(images).toHaveLength(48);
    expect(images[0]).toEqual({ image: { src: '/media/a.webp', alt: 'A table' }, caption: 'Oak' });
    expect(images[1]?.image).toBeNull();
  });

  test('draws the chosen pictures on the site, and a place to choose one in the editor', () => {
    const list = [{ type: 'gallery', content: { title: 'Work', images: [{ image: { src: '/media/a.webp', alt: 'A table' }, caption: 'Oak' }, { caption: 'Not chosen yet' }] } }];
    const html = shown(list);
    expect(html).toContain('<img src="/media/a.webp" alt="A table"');
    expect(html).toContain('<figcaption>Oak</figcaption>');
    expect(html).not.toContain('Not chosen yet');
    expect(html).not.toContain('cms-empty');
    expect(edited(list)).toContain('data-empty="image"');
    expect(shown([{ type: 'gallery', content: { title: '', images: [] } }])).not.toContain('class="gallery"');
  });

  test('its pictures count as used by the page, so they are exported and not deleted', () => {
    const list = blocks([
      { type: 'gallery', content: { images: [{ image: { src: '/media/a.webp', alt: '' } }] } },
      { type: 'testimonials', content: { items: [{ quote: 'Good', photo: { src: '/media/p.webp', alt: '' } }] } },
    ]);
    expect(imageSources(list)).toEqual(['/media/a.webp', '/media/p.webp']);
  });
});

describe('questions and answers', () => {
  test('on the site each answer opens under its question, without any script', () => {
    const html = shown([{ type: 'faq', content: { title: 'FAQ', items: [{ question: 'Do you deliver?', answer: 'Yes.\nAnywhere.' }, { question: '', answer: 'An answer to nothing' }] } }]);
    expect(html).toContain('<details class="faq-item"><summary class="faq-question">Do you deliver?</summary>');
    expect(html).not.toContain('An answer to nothing');
    expect(html).not.toContain('<script');
  });

  test('in the editor every question and answer is open to be typed into', () => {
    const html = edited([{ type: 'faq', content: { items: [{ question: 'Q', answer: 'A' }] } }]);
    expect(html).not.toContain('<details');
    expect(html).toMatch(/data-edit="items\.0\.question"/);
    expect(html).toMatch(/data-edit="items\.0\.answer"/);
  });

  test('its words are the words of the page, for a description', () => {
    expect(blocksText(blocks([{ type: 'faq', content: { title: '', items: [{ question: 'Do you deliver?', answer: 'Yes.' }] } }]))).toBe('Do you deliver? Yes.');
  });
});

describe('testimonials', () => {
  test('what someone said is text, never markup', () => {
    const html = shown([{ type: 'testimonials', content: { items: [{ quote: attack, name: attack, role: 'CEO' }] } }]);
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)>');
    expect(html).toContain('<blockquote>');
  });
});

describe('prices', () => {
  test('a plan lists what it includes, one line a feature, and its button needs an address on the site', () => {
    const list = [
      {
        type: 'pricing',
        content: {
          plans: [
            { name: 'Basic', price: '€100', period: 'per month', features: 'One\n\n  Two  \n', action: { label: 'Choose', href: '/contact/' } },
            { name: 'Odd', action: { label: 'Half done', href: '' } },
            { name: 'Bad', action: { label: 'Bad', href: 'javascript:alert(1)' } },
          ],
        },
      },
    ];
    const html = shown(list);
    expect(html).toContain('<ul class="plan-features"><li>One</li><li>Two</li></ul>');
    expect(html).toContain('href="/contact/"');
    expect(html).not.toContain('Half done');
    expect(html).not.toContain('javascript:');
    expect(edited(list)).toContain('Half done');
  });

  test('holds no more than six plans', () => {
    const [block] = blocks([{ type: 'pricing', content: { plans: Array.from({ length: 9 }, (_, i) => ({ name: `P${i}` })) } }]);
    expect(block?.content.plans).toHaveLength(6);
  });
});
