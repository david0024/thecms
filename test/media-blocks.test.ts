/**
 * The blocks that close stage 1 (ADR 0047): buttons, a table, a player from
 * another service, a video, sound, and a list of documents.
 */
import { describe, expect, test } from 'bun:test';
import {
  type Block,
  blocksText,
  cleanFile,
  cleanTable,
  embedOf,
  mediaSources,
  normalizeBlocks,
  normalizeSite,
  parseTheme,
  TABLE_MAX_COLUMNS,
  TABLE_MAX_ROWS,
  type Theme,
  localizeBlocks,
} from '../src/core/index.ts';
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
const PDF = `/media/${'a'.repeat(32)}.pdf`;
const MP4 = `/media/${'b'.repeat(32)}.mp4`;
const MP3 = `/media/${'c'.repeat(32)}.mp3`;
const PNG = `/media/${'d'.repeat(32)}.png`;

describe('players from other services', () => {
  test('a page address of a known service becomes that service\'s player', () => {
    const cases: [string, string, string][] = [
      ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', 'video'],
      ['https://youtu.be/dQw4w9WgXcQ?t=1m30s', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=90', 'video'],
      ['https://youtube.com/shorts/dQw4w9WgXcQ', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', 'video'],
      ['https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=42', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=42', 'video'],
      ['https://vimeo.com/76979871', 'https://player.vimeo.com/video/76979871?dnt=1', 'video'],
      ['https://vimeo.com/76979871/abc123def0', 'https://player.vimeo.com/video/76979871?dnt=1&h=abc123def0', 'video'],
      ['https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=x', 'https://open.spotify.com/embed/track/4uLU6hMCjMI75M1A2tKUQC', 'audio'],
      ['https://open.spotify.com/intl-ro/album/1DFixLWuPkv3KT3TnV35m3', 'https://open.spotify.com/embed/album/1DFixLWuPkv3KT3TnV35m3', 'audio'],
      ['https://soundcloud.com/artist/a-song', `https://w.soundcloud.com/player/?url=${encodeURIComponent('https://soundcloud.com/artist/a-song')}&visual=false`, 'audio'],
      ['https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d2848.8', 'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d2848.8', 'map'],
      ['https://www.openstreetmap.org/export/embed.html?bbox=26.08,44.42,26.12,44.44&layer=mapnik&marker=44.43,26.10', 'https://www.openstreetmap.org/export/embed.html?bbox=26.08,44.42,26.12,44.44&layer=mapnik&marker=44.43,26.10', 'map'],
    ];
    for (const [address, src, kind] of cases) expect(embedOf(address)).toMatchObject({ src, kind });
    expect(embedOf('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M')?.shape).toBe('audio-tall');
  });

  test('any other address, or a known service\'s with something slipped in, is no player', () => {
    for (const address of [
      'https://evil.example/embed/dQw4w9WgXcQ',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ"><script>',
      'https://www.youtube.com/watch?v=short',
      'javascript:alert(1)',
      'https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ',
      'https://www.google.com/maps/place/Bucharest',
      'https://www.google.com/maps/embed?pb=<script>',
      'https://vimeo.com/channels/staffpicks',
      'https://soundcloud.com/only-an-artist',
      'https://www.openstreetmap.org/export/embed.html?bbox=javascript:1',
      '<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>',
      42,
    ]) {
      expect(embedOf(address)).toBeNull();
    }
  });

  test('draws the player in a sandboxed frame on the site; an address it cannot show is a hint in the editor and nothing on the site', () => {
    const html = shown([{ type: 'embed', content: { url: 'https://youtu.be/dQw4w9WgXcQ', title: 'Our workshop', caption: 'Five minutes in the workshop' } }]);
    expect(html).toContain('<iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ" title="Our workshop" loading="lazy"');
    expect(html).toContain('sandbox="allow-scripts allow-same-origin allow-popups allow-presentation"');
    expect(html).toContain('class="embed embed-video"');
    expect(html).toContain('<figcaption>Five minutes in the workshop</figcaption>');
    const unknown = [{ type: 'embed', content: { url: `https://evil.example/${attack}` } }];
    expect(shown(unknown)).not.toContain('iframe');
    expect(shown(unknown)).not.toContain('evil.example');
    expect(edited(unknown)).toContain('data-empty="embedUnknown"');
    expect(edited([{ type: 'embed', content: {} }])).toContain('data-empty="embed"');
  });
});

describe('files a block uses', () => {
  test('from the library, only of the kind the field takes; sound and video may be a service\'s page, a document any address', () => {
    expect(cleanFile('document', { src: PDF, label: 'The menu\n' })).toEqual({ src: PDF, label: 'The menu' });
    expect(cleanFile('document', { src: MP4 })).toBeNull();
    expect(cleanFile('document', { src: 'https://example.com/terms.pdf', label: 'Terms' })).toEqual({ src: 'https://example.com/terms.pdf', label: 'Terms' });
    expect(cleanFile('document', { src: 'javascript:alert(1)' })).toBeNull();
    expect(cleanFile('video', { src: MP4 })).toEqual({ src: MP4, label: '' });
    expect(cleanFile('video', { src: MP3 })).toBeNull();
    expect(cleanFile('video', { src: 'https://vimeo.com/76979871' })?.src).toBe('https://vimeo.com/76979871');
    expect(cleanFile('video', { src: 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC' })).toBeNull();
    expect(cleanFile('video', { src: 'https://example.com/film.mp4' })).toBeNull();
    expect(cleanFile('audio', { src: MP3 })?.src).toBe(MP3);
    expect(cleanFile('audio', { src: 'https://soundcloud.com/artist/a-song' })?.src).toBe('https://soundcloud.com/artist/a-song');
    expect(cleanFile('audio', { src: '/media/../site.db' })).toBeNull();
    expect(cleanFile('audio', null)).toBeNull();
  });

  test('a page needs the files its blocks play and list, and the poster it shows', () => {
    const list = blocks([
      { type: 'video', content: { video: { src: MP4 }, poster: { src: PNG, alt: '' } } },
      { type: 'video', content: { video: { src: 'https://youtu.be/dQw4w9WgXcQ' } } },
      { type: 'audio', content: { audio: { src: MP3 } } },
      { type: 'files', content: { items: [{ file: { src: PDF, label: 'Menu' } }, { file: { src: 'https://example.com/a.pdf', label: 'Elsewhere' } }] } },
    ]);
    expect(mediaSources(list).sort()).toEqual([MP3, MP4, PDF, PNG].sort());
  });
});

describe('a video and sound', () => {
  test('a video from the library is played by the browser, with its poster; one from YouTube by its player', () => {
    const own = shown([{ type: 'video', content: { video: { src: MP4 }, title: 'The workshop', poster: { src: PNG, alt: '' }, caption: 'Spring' } }]);
    expect(own).toContain(`<video class="video" src="${MP4}" poster="${PNG}" title="The workshop" controls="" preload="metadata" playsinline="">`);
    expect(own).toContain('<figcaption>Spring</figcaption>');
    const elsewhere = shown([{ type: 'video', content: { video: { src: 'https://youtu.be/dQw4w9WgXcQ' } } }]);
    expect(elsewhere).toContain('src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"');
    expect(elsewhere).not.toContain('<video');
    expect(shown([{ type: 'video', content: {} }])).not.toContain('figure');
    expect(edited([{ type: 'video', content: {} }])).toContain('data-empty="video"');
  });

  test('sound from the library has the browser\'s player; from Spotify, Spotify\'s', () => {
    expect(shown([{ type: 'audio', content: { audio: { src: MP3 }, title: 'Episode 1' } }])).toContain(`<audio class="audio" src="${MP3}" title="Episode 1" controls="" preload="metadata">`);
    expect(shown([{ type: 'audio', content: { audio: { src: 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC' } } }])).toContain('class="embed embed-audio"');
    expect(edited([{ type: 'audio', content: {} }])).toContain('data-empty="audio"');
  });
});

describe('a list of documents', () => {
  test('each links to its file under its words, with its kind; one not chosen yet shows nowhere', () => {
    const html = shown([{ type: 'files', content: { title: 'Menus', items: [{ file: { src: PDF, label: attack }, text: 'Summer' }, { text: 'Not chosen yet' }, { file: { src: 'https://example.com/list.xlsx?v=2', label: '' } }] } }]);
    expect(html).toContain(`<a href="${PDF}"><span>&lt;img src=x onerror=alert(1)></span><small class="file-kind">PDF</small></a>`);
    expect(html).toContain('<p>Summer</p>');
    expect(html).not.toContain('Not chosen yet');
    expect(html).toContain('<small class="file-kind">XLSX</small>');
    expect(edited([{ type: 'files', content: { items: [] } }])).toContain('data-empty="files"');
  });
});

describe('buttons', () => {
  test('the first stands out, the rest are quiet, and one with no address shows only in the editor', () => {
    const list = [{ type: 'buttons', content: { items: [{ action: { label: 'Book', href: '/book/' } }, { action: { label: 'Menu', href: PDF } }, { action: { label: 'Not yet' } }] } }];
    const html = shown(list);
    expect(html).toContain('<a class="button" href="/book/"><span>Book</span></a>');
    expect(html).toContain(`<a class="button quiet" href="${PDF}"><span>Menu</span></a>`);
    expect(html).not.toContain('Not yet');
    expect(edited(list)).toContain('Not yet');
    expect(blocks([{ type: 'buttons', content: { items: Array.from({ length: 9 }, () => ({ action: { label: 'x', href: '/' } })) } }])[0]?.content.items).toHaveLength(6);
    expect(shown([{ type: 'buttons', content: { items: [{ action: { label: 'x', href: 'javascript:alert(1)' } }] } }])).not.toContain('javascript');
  });
});

describe('a table', () => {
  test('is cleaned to plain text, rows as wide as the widest, within its limits', () => {
    expect(cleanTable({ header: false, rows: [['a', 'b\nc'], ['d'], 'not a row'] })).toEqual({ header: false, rows: [['a', 'b c'], ['d', ''], ['', '']] });
    expect(cleanTable(null)).toEqual({ header: true, rows: [['']] });
    const big = cleanTable({ rows: Array.from({ length: 100 }, () => Array.from({ length: 20 }, () => 'x'.repeat(900))) });
    expect(big.rows).toHaveLength(TABLE_MAX_ROWS);
    expect(big.rows[0]).toHaveLength(TABLE_MAX_COLUMNS);
    expect(big.rows[0]?.[0]).toHaveLength(500);
  });

  test('draws headings when the first row holds them, every cell escaped, and each cell editable on the page', () => {
    const list = [{ type: 'table', content: { title: 'Hours', caption: 'Closed on holidays', table: { header: true, rows: [['Day', 'Hours'], ['Monday', attack]] } } }];
    const html = shown(list);
    expect(html).toContain('<thead><tr><th scope="col">Day</th><th scope="col">Hours</th></tr></thead>');
    expect(html).toContain('<td>Monday</td><td>&lt;img src=x onerror=alert(1)></td>');
    expect(html).toContain('<caption>Closed on holidays</caption>');
    expect(html).toContain('<div class="table-wrap">');
    expect(edited(list)).toContain('data-edit="table.rows.1.1"');
    const plainRows = shown([{ type: 'table', content: { table: { header: false, rows: [['a', 'b']] } } }]);
    expect(plainRows).not.toContain('<thead');
    expect(plainRows).toContain('<td>a</td><td>b</td>');
  });

  test('its words are the page\'s words, and each cell is translated on its own', () => {
    const list = blocks([{ type: 'table', content: { table: { rows: [['Day', 'Hours'], ['Monday', '9–18']] } } }, { type: 'files', content: { items: [{ file: { src: PDF, label: 'The menu' } }] } }]);
    expect(blocksText(list, 500)).toBe('Day Hours Monday 9–18 The menu');
    const [table, files] = list as [Block, Block];
    const ro = localizeBlocks(list, { [`${table.id}.table.rows.1.0`]: 'Luni', [`${files.id}.items.0.file.label`]: 'Meniul' });
    expect((ro[0]?.content.table as { rows: string[][] }).rows).toEqual([['Day', 'Hours'], ['Luni', '9–18']]);
    expect((ro[1]?.content.items as { file: { src: string; label: string } }[])[0]?.file).toEqual({ src: PDF, label: 'Meniul' });
  });
});
