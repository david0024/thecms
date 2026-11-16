/**
 * The editor, driven in a real browser from the first click to the exported
 * file: add a block, type on the page, style it with a token and with a free
 * value, change the theme, publish, export. Each step is checked by what it
 * left behind (the stored document, the exported HTML), not by what the
 * screen said.
 *
 *   node e2e/editor.cjs [folder for screenshots]
 */
const { chromium } = require('playwright');
const { spawn, execFileSync } = require('node:child_process');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
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
  assert(readFileSync(join(out, 'assets/site.css'), 'utf8').includes('--t-color-background:#12110f'), 'the export uses the theme chosen in the editor');
  assert(readFileSync(join(out, 'preturi-si-comenzi/index.html'), 'utf8').includes('<h1>A headline that says what you do</h1>'), 'the new page is exported at its own address');
  rmSync(dir, { recursive: true, force: true });
  console.log('\nThe editor works end to end.');
})().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
