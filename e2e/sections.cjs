/**
 * Sections in a real browser (ADR 0033): one written once in its list, put on
 * a page with the "Section" block, drawn there, said where it is shown, and
 * kept while a page shows it.
 *
 *   node e2e/sections.cjs [folder for screenshots]
 */
const { chromium } = require('playwright');
const coverage = require('./coverage.cjs');
const { spawn, execFileSync } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const root = join(__dirname, '..');
const cli = (...args) => execFileSync('bun', ['src/site/cli.ts', ...args], { cwd: root, encoding: 'utf8' });
const assert = (condition, message) => {
  if (!condition) throw new Error(`FAILED: ${message}`);
  console.log(`ok  ${message}`);
};
const PORT = 4399;

(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'thecms-e2e-sections-'));
  const db = join(dir, 'site.db');
  const shots = process.argv[2];
  cli('init', db);

  const server = spawn('bun', ['src/site/cli.ts', 'edit', db, String(PORT)], { cwd: root });
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

  const browser = await coverage.launch(chromium, 'sections');
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const canvas = page.frameLocator('iframe');
    const stored = () => page.locator('.status[data-state="saved"]').waitFor();
    await page.goto(url);

    // Written once, in the list of sections.
    await page.locator('[data-nav="sections"]').click();
    await page.locator('[data-no-sections]').waitFor();
    await page.locator('[data-new="section"]').click();
    await page.locator('[data-section-name]').fill('Get in touch');
    await page.locator('[data-section-name]').press('Enter');
    await page.locator('.builder:not([hidden])').waitFor();
    await page.locator('[data-add="hero"]').click();
    await canvas.locator('h1').waitFor();
    await canvas.locator('h1').click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('Call us today');
    await stored();
    assert(true, 'a section is written in the builder, like a page');

    // Put on the home page with the "Section" block, and drawn there.
    await page.locator('[data-back]').click();
    await page.locator('[data-nav="pages"]').click();
    await page.locator('button[data-open=""]').click();
    await canvas.locator('section.b').first().click();
    await page.locator('[data-add="section"]').click();
    await page.locator('[data-field-section]').selectOption('get-in-touch');
    await canvas.locator('[data-frozen] h1', { hasText: 'Call us today' }).waitFor();
    await stored();
    if (shots) await page.screenshot({ path: join(shots, 'section-on-page.png') });
    assert(true, 'the "Section" block shows it on the page, not to be typed into there');

    // The list says where it is shown, and it is kept while it is.
    await page.locator('[data-back]').click();
    await page.locator('[data-nav="sections"]').click();
    assert((await page.locator('[data-section="get-in-touch"] [data-used-on]').innerText()) === '/', 'the list says where it is shown');
    await page.locator('[data-open-section="get-in-touch"]').click();
    await page.locator('[data-section-used]').waitFor();
    await page.getByRole('button', { name: 'Delete this section' }).click();
    await page.getByText('take it off there first').first().waitFor();
    if (shots) await page.screenshot({ path: join(shots, 'section-kept.png') });
    assert(true, 'a section shown on a page is not deleted');
    assert(errors.length === 0, `no errors in the browser ${errors.join(' | ')}`);
  } catch (error) {
    if (shots) await browser.contexts()[0]?.pages()[0]?.screenshot({ path: join(shots, 'failure.png') }).catch(() => {});
    throw error;
  } finally {
    await browser.close();
    server.kill();
  }
  rmSync(dir, { recursive: true, force: true });
  console.log('\nSections work.');
})().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
