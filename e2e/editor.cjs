/**
 * The editor, driven in a real browser from the first click to the exported
 * file: add a block, type on the page, style it with a token and with a free
 * value, change the theme, build on it in the theme builder, publish, export. Each step is checked by what it
 * left behind (the stored document, the exported HTML), not by what the
 * screen said.
 *
 *   node e2e/editor.cjs [folder for screenshots]
 */
const { chromium } = require('playwright');
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
  const dir = mkdtempSync(join(tmpdir(), 'thecms-e2e-'));
  const db = join(dir, 'site.db');
  const shots = process.argv[2];
  cli('init', db);

  const server = spawn('bun', ['src/site/cli.ts', 'edit', db, '4398'], { cwd: root });
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

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: shots ? 2 : 1 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.goto(url);
    const canvas = page.frameLocator('iframe');
    await canvas.locator('h1').waitFor();
    assert((await canvas.locator('h1').innerText()).includes('Solid wood'), 'the canvas shows the real home page');
    const saved = () => page.locator('.status[data-state="saved"]').waitFor();

    // Type directly on the page.
    await canvas.locator('h1').click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('Furniture that lasts <b>longer</b>');
    await saved();
    if (shots) await page.screenshot({ path: join(shots, 'editor-typing.png') });

    // Add a block after the selected one and write in it.
    await page.locator('[data-add="text"]').click();
    const prose = canvas.locator('.b-text .prose');
    await prose.waitFor();
    await prose.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('Every piece is drawn first.');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Then it is built.');
    await saved();
    assert((await canvas.locator('section.b').nth(1).getAttribute('class')).includes('b-text'), 'the new block sits right after the selected one');

    // Move it down, then style it: one token, one free value, one refused value.
    await canvas.locator('.cms-bar button[data-action="down"]').click();
    await canvas.locator('section.b').nth(2).locator('.prose').waitFor();
    await page.getByRole('tab', { name: 'Style' }).click();
    await page.locator('select[data-style="background"]').selectOption('token:surface');
    await page.locator('select[data-style="paddingBlock"]').selectOption('$custom');
    await page.locator('input[data-custom="paddingBlock"]').fill('7rem');
    await page.locator('select[data-style="color"]').selectOption('$custom');
    await page.locator('input[data-custom="color"]').fill('red;}body{display:none');
    assert(await page.getByText('Not a valid value').isVisible(), 'a value that is not a colour is refused where it is typed');
    await saved();
    await page.waitForTimeout(400);
    if (shots) await page.screenshot({ path: join(shots, 'editor-plain.png') });

    // Change the theme; the page is drawn again with the same content.
    await page.locator('select[data-theme]').selectOption('Studio');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('iframe').contentDocument.body).backgroundColor === 'rgb(18, 17, 15)');
    assert(true, 'changing the theme repaints the canvas');
    const padding = await canvas.locator('section.b-text').evaluate((el) => getComputedStyle(el).paddingTop);
    assert(padding === '112px', `the free value stayed through the theme change (${padding})`);
    const background = await canvas.locator('section.b-text').evaluate((el) => getComputedStyle(el).backgroundColor);
    assert(background === 'rgb(29, 27, 24)', `the token followed the new theme (${background})`);
    if (shots) await page.screenshot({ path: join(shots, 'editor-studio.png') });

    // The theme builder: change a colour and see it on the page at once.
    await page.locator('[data-theme-mode]').click();
    const primary = page.locator('input[data-token="color.primary"]');
    await primary.fill('#ff0066');
    const buttonColour = () => canvas.locator('a.button').first().evaluate((el) => getComputedStyle(el).backgroundColor);
    await page.waitForFunction(() => getComputedStyle(document.querySelector('iframe').contentDocument.querySelector('a.button')).backgroundColor === 'rgb(255, 0, 102)');
    assert(true, 'a colour changed in the theme builder repaints the page');
    if (shots) await page.screenshot({ path: join(shots, 'theme-colours.png') });
    await primary.fill('red;}body{display:none');
    await page.waitForTimeout(600);
    assert((await buttonColour()) === 'rgb(255, 0, 102)', 'a theme value that is not a colour is not applied; the theme keeps what it had');
    await primary.fill('#ff0066');

    // A token of the author's own, used as a block type's default.
    await page.locator('[data-new-token-name="color"]').fill('brand');
    await page.locator('[data-new-token-value="color"]').fill('#00aa88');
    await page.locator('[data-add-token="color"]').click();
    await page.getByText('Blocks', { exact: true }).click();
    await page.locator('select[data-theme-block]').selectOption('services');
    await page.locator('[data-theme-style="default"] select[data-style="background"]').selectOption('token:brand');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('iframe').contentDocument.querySelector('.b-services')).backgroundColor === 'rgb(0, 170, 136)');
    assert(true, 'a new token can style every block of a type');
    await page.getByRole('button', { name: 'Remove brand' }).click();
    await page.getByRole('alert').waitFor();
    assert(await page.locator('input[data-token="color.brand"]').isVisible(), 'a token still in use cannot be removed, and the builder says why');
    await page.locator('[data-new-variant]').fill('quiet');
    await page.getByRole('button', { name: 'Add variant' }).click();
    await page.locator('[data-theme-style="quiet"]').waitFor();

    // A theme is a file: download it, and refuse a file that is not a theme.
    await page.getByText('Save or load a theme file').click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download this theme' }).click()]);
    const themeFile = join(dir, 'downloaded.theme.json');
    await download.saveAs(themeFile);
    const downloaded = JSON.parse(readFileSync(themeFile, 'utf8'));
    assert(downloaded.tokens.color.brand === '#00aa88' && downloaded.blocks.services.variants.quiet, 'the downloaded theme file holds what was built');
    const bad = join(dir, 'bad.theme.json');
    writeFileSync(bad, JSON.stringify({ ...downloaded, tokens: { ...downloaded.tokens, color: { ...downloaded.tokens.color, primary: 'url(https://evil.example)' } } }));
    await page.locator('[data-theme-file]').setInputFiles(bad);
    await page.getByText('This file is not a valid theme.').waitFor();
    assert((await buttonColour()) === 'rgb(255, 0, 102)', 'a theme file with a bad value is refused whole');
    if (shots) await page.screenshot({ path: join(shots, 'theme-builder.png') });

    // Nothing of this has reached visitors yet: the theme has a draft too.
    await page.waitForTimeout(500);
    const early = join(dir, 'early');
    cli('export', db, early);
    assert(readFileSync(join(early, 'assets/site.css'), 'utf8').includes('--t-color-primary:#2563eb'), 'until the theme is published, the export keeps the published theme');
    await page.locator('[data-publish-theme]').click();
    await page.locator('[data-publish-theme]').waitFor({ state: 'detached' });
    await page.locator('[data-theme-mode]').click();

    // Undo brings the padding back off, redo puts it on again.
    await page.locator('aside.left h2').first().click();
    await page.keyboard.press('ControlOrMeta+z');
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await saved();

    // A new page.
    await page.getByRole('button', { name: '+ New page' }).click();
    await page.getByPlaceholder('Page title').fill('Prețuri și comenzi');
    await page.getByRole('button', { name: 'Create' }).click();
    await canvas.locator('.cms-empty').waitFor();
    await page.locator('[data-add="hero"]').click();
    await canvas.locator('h1').waitFor();
    await saved();
    await page.getByRole('button', { name: 'Publish' }).click();
    await page.getByText('Published', { exact: true }).waitFor();

    // Back to the home page and publish it too.
    await page.getByRole('button', { name: /^Home/ }).click();
    await canvas.locator('.b-text').waitFor();
    await page.getByRole('button', { name: 'Publish' }).click();
    await page.getByText('Published', { exact: true }).waitFor();
    assert(errors.length === 0, `no errors in the browser console ${errors.join(' | ')}`);
  } finally {
    await browser.close();
    server.kill();
  }

  // What matters: the files a visitor would get.
  const out = join(dir, 'out');
  cli('export', db, out);
  const home = readFileSync(join(out, 'index.html'), 'utf8');
  assert(home.includes('<h1>Furniture that lasts &lt;b>longer&lt;/b></h1>'), 'the typed title is in the export, as text');
  assert(home.includes('<p>Every piece is drawn first.</p><p>Then it is built.</p>'), 'the typed paragraphs are in the export');
  assert(/\{background-color:var\(--t-color-surface\);padding-block:7rem\}/.test(home), 'the block carries its token and its free value, and nothing else');
  assert(!/display:none|red;/.test(home), 'the refused value never reached the page');
  assert(!/data-edit|contenteditable|cms-|<script/.test(home), 'nothing of the editor is in the export');
  const css = readFileSync(join(out, 'assets/site.css'), 'utf8');
  assert(css.includes('--t-color-background:#12110f'), 'the export uses the theme chosen in the editor');
  assert(css.includes('--t-color-primary:#ff0066') && css.includes('.b-services{background-color:var(--t-color-brand)}'), 'the export carries the theme as it was built');
  assert(!/evil|display:none/.test(css), 'no refused theme value reached the stylesheet');
  assert(readFileSync(join(out, 'preturi-si-comenzi/index.html'), 'utf8').includes('<h1>A headline that says what you do</h1>'), 'the new page is exported at its own address');
  rmSync(dir, { recursive: true, force: true });
  console.log('\nThe editor works end to end.');
})().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
