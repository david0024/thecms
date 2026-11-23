/**
 * Documents, sound and video in the library (ADR 0046) and the blocks that
 * use them (ADR 0047), driven in a real browser: upload a PDF into a list of
 * documents, build a table, paste a YouTube address into a video, an address
 * no player knows into an embed, upload sound, filter the media screen, then
 * publish and export. Each step is checked by the stored page and the
 * exported files.
 *
 *   node e2e/media-blocks.cjs [folder for screenshots]
 */
const { chromium } = require('playwright');
const coverage = require('./coverage.cjs');
const { spawn, execFileSync } = require('node:child_process');
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const root = join(__dirname, '..');
const cli = (...args) => execFileSync('bun', ['src/site/cli.ts', ...args], { cwd: root, encoding: 'utf8' });
const assert = (condition, message) => {
  if (!condition) throw new Error(`FAILED: ${message}`);
  console.log(`ok  ${message}`);
};

(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'uhlaka-e2e-'));
  const db = join(dir, 'site.db');
  const shots = process.argv[2];
  cli('init', db);
  const pdf = join(dir, 'Summer menu.pdf');
  writeFileSync(pdf, '%PDF-1.7\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');
  const mp3 = join(dir, 'episode.mp3');
  writeFileSync(mp3, Buffer.concat([Buffer.from('ID3\x04\0\0\0\0\0\0'), Buffer.alloc(64)]));

  const server = spawn('bun', ['src/site/cli.ts', 'edit', db, '4396'], { cwd: root });
  const url = await new Promise((resolve, reject) => {
    let out = '';
    server.stdout.on('data', (chunk) => {
      out += chunk;
      const found = out.match(/http:\/\/127\.0\.0\.1:\d+\/admin\/#token=\w+/);
      if (found) resolve(found[0]);
    });
    server.stderr.on('data', (chunk) => process.stderr.write(chunk));
    server.on('exit', () => reject(new Error('the editor stopped')));
  });
  const token = url.split('#token=')[1];

  const browser = await coverage.launch(chromium, 'media-blocks');
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: shots ? 2 : 1 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.goto(url);
    const canvas = page.frameLocator('iframe');
    await page.locator('[data-list="page"] [data-open=""]').waitFor();
    await page.locator('[data-open=""]').click();
    await canvas.locator('h1').waitFor();
    const saved = () => page.locator('.status[data-state="saved"]').waitFor();
    const stored = async () => {
      await saved();
      await page.waitForTimeout(300);
      await saved();
      return page.evaluate(async (t) => (await (await fetch('/api/page?slug=', { headers: { 'x-uhlaka-token': t } })).json()).page.blocks, token);
    };
    const block = async (type) => (await stored()).find((b) => b.type === type);

    // A list of documents: a PDF uploaded from the panel, named after its file.
    await page.locator('[data-add="files"]').click();
    await canvas.locator('.b-files [data-empty="files"]').waitFor();
    assert(true, 'a new list of documents asks for documents');
    await page.getByRole('button', { name: 'Add' }).last().click();
    await page.locator('[data-file-field="document"] [data-file-input]').setInputFiles(pdf);
    await canvas.locator('.b-files .file-kind', { hasText: 'PDF' }).waitFor();
    const files = await block('files');
    const doc = files.content.items[0].file;
    assert(/^\/media\/[a-f0-9]{32}\.pdf$/.test(doc.src) && doc.label === 'Summer menu', `the PDF is stored with the site, its link named after the file (${doc.src}, ${doc.label})`);
    await page.locator('[data-file-words]').fill('Meniul de vară');
    assert((await block('files')).content.items[0].file.label === 'Meniul de vară', 'the words of its link are changed in the panel');
    // The same document, picked again from the library.
    await page.getByRole('button', { name: 'Add' }).last().click();
    await page.locator('[data-file-field="document"]').nth(1).locator('[data-file-library]').click();
    await page.locator(`[data-file="${doc.src.slice(7)}"]`).click();
    assert((await block('files')).content.items[1].file.src === doc.src, 'a document already uploaded is picked from the library');

    // A table: a row and a column added, a cell typed, the headings switched off and on.
    await page.locator('[data-add="table"]').click();
    await canvas.locator('.b-table table').waitFor();
    await page.locator('[data-table-add-row]').click();
    await page.locator('[data-table-add-column]').click();
    await page.locator('[data-cell="3.2"]').fill('Closed');
    let table = (await block('table')).content.table;
    assert(table.rows.length === 4 && table.rows[0].length === 3 && table.rows[3][2] === 'Closed', `rows and columns are added, and a cell typed (${JSON.stringify(table.rows)})`);
    await page.locator('[data-table-remove-column]').click();
    await page.locator('[data-table-header]').uncheck();
    table = (await block('table')).content.table;
    assert(table.rows[0].length === 2 && table.header === false && !(await canvas.locator('.b-table thead').count()), 'a column is taken away, and without headings the table has none');
    await page.locator('[data-table-header]').check();
    await canvas.locator('.b-table thead th').first().waitFor();
    await page.getByRole('button', { name: /^Remove row 4/ }).click();
    assert((await block('table')).content.table.rows.length === 3, 'a row is taken away');
    if (shots) await page.screenshot({ path: join(shots, 'editor-table.png') });

    // A video from YouTube, pasted as the address of its page.
    await page.locator('[data-add="video"]').click();
    await canvas.locator('[data-empty="video"]').waitFor();
    await page.locator('[data-file-field="video"] summary').click();
    await page.locator('[data-file-field="video"] [data-file-address]').fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30');
    await page.locator('[data-file-field="video"] [data-file-address]').press('Tab');
    await canvas.locator('.b-video iframe').waitFor({ state: 'attached' });
    assert((await canvas.locator('.b-video iframe').getAttribute('src')) === 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=30', 'a YouTube address plays in the privacy-friendly player, from where it was pasted');
    // An address that is not a video is refused, and said so.
    await page.locator('[data-file-field="video"] [data-file-address]').fill('https://example.com/film');
    await page.locator('[data-file-field="video"] [data-file-address]').press('Tab');
    await page.locator('[data-file-field="video"] [role="alert"]').waitFor();
    assert((await block('video')).content.video === null, 'an address no player knows is not kept as a video');

    // A player pasted into an embed: unknown first, then a map.
    await page.locator('[data-add="embed"]').click();
    await page.getByLabel('Address of the video, song or map').fill('https://example.com/not-a-player');
    await canvas.locator('[data-empty="embedUnknown"]').waitFor();
    assert(true, 'an address no player knows is a hint in the editor');
    await page.getByLabel('Address of the video, song or map').fill('https://www.openstreetmap.org/export/embed.html?bbox=26.08,44.42,26.12,44.44&layer=mapnik');
    await canvas.locator('.b-embed .embed-map iframe').waitFor({ state: 'attached' });
    assert(true, 'an OpenStreetMap address becomes a map');

    // Sound, uploaded.
    await page.locator('[data-add="audio"]').click();
    await page.locator('[data-file-field="audio"] [data-file-input]').setInputFiles(mp3);
    await canvas.locator('.b-audio audio').waitFor({ state: 'attached' });
    const sound = (await block('audio')).content.audio.src;
    assert(/^\/media\/[a-f0-9]{32}\.mp3$/.test(sound), `the sound file is stored with the site (${sound})`);
    // A file of another kind than the field takes is refused there.
    await page.locator('[data-file-field="audio"] [data-file-input]').setInputFiles(pdf);
    await page.locator('[data-file-field="audio"] [role="alert"]').waitFor();
    assert((await block('audio')).content.audio.src === sound, 'a document chosen for sound is refused, and the sound stays');

    // Buttons, the second leading to the document.
    await page.locator('[data-add="buttons"]').click();
    await canvas.locator('.b-buttons .button').first().waitFor();
    assert((await canvas.locator('.b-buttons .button').count()) === 2, 'new buttons show in the editor while they have no address');
    await page.getByLabel('Where it goes (for example /contact/)').first().fill('/contact/');
    await page.getByLabel('Where it goes (for example /contact/)').nth(1).fill(doc.src);
    if (shots) await page.screenshot({ path: join(shots, 'editor-media-blocks.png') });
    await saved();
    await page.getByRole('button', { name: 'Publish' }).click();
    await page.getByText('Published', { exact: true }).waitFor();

    // The media screen: every kind, filtered by kind; a document a page uses is not deleted.
    await page.locator('[data-back]').click();
    await page.locator('[data-nav="media"]').click();
    await page.locator('[data-list="media"] [data-media-item]').first().waitFor();
    await page.locator('[data-media-kind="document"]').click();
    assert((await page.locator('[data-list="media"] [data-media-item]').count()) === 1, 'the media screen shows the documents alone');
    await page.locator('[data-list="media"] [data-media-item]').getByRole('button', { name: 'Delete this file' }).click();
    assert((await page.locator('[data-list="media"] [role="alert"]').innerText()).includes('this file is used on'), 'a document a page links to is not deleted');
    await page.locator('[data-media-kind="audio"]').click();
    assert((await page.locator('[data-list="media"] audio').count()) === 1, 'sound is shown with a player');
    if (shots) await page.screenshot({ path: join(shots, 'admin-media-kinds.png') });
    const unexpected = errors.filter((e) => !e.includes('400'));
    assert(unexpected.length === 0, `nothing failed but the refused upload ${unexpected.join(' | ')}`);
  } finally {
    await browser.close();
    server.kill();
  }

  // The export carries the document and the sound, and draws each block.
  const out = join(dir, 'out');
  cli('export', db, out);
  const home = readFileSync(join(out, 'index.html'), 'utf8');
  const pdfPath = /href="(\/media\/[a-f0-9]{32}\.pdf)"/.exec(home)?.[1];
  assert(pdfPath && readFileSync(join(out, pdfPath), 'utf8').startsWith('%PDF-'), 'the export carries the document the page links to');
  assert(home.includes('Meniul de vară') && home.includes('<th scope="col">') && home.includes('Closed') === false, 'the list of documents and the table are exported');
  assert(home.includes('src="https://www.openstreetmap.org/export/embed.html?bbox=26.08,44.42,26.12,44.44&amp;layer=mapnik"'), 'the map is exported as its player');
  assert(/<audio class="audio" src="\/media\/[a-f0-9]{32}\.mp3"/.test(home), 'the sound is exported with the browser\'s player');
  rmSync(dir, { recursive: true, force: true });
  console.log('\nDocuments and the blocks that use them work end to end.');
})().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
