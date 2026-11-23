/**
 * Entries in more than one language (ADR 0054), in a real browser: the blog
 * named and placed in Romanian, a post started in Romanian from its list,
 * its words and address written, published with its post, and the exported
 * site with the post at its Romanian address and only it in the Romanian list.
 *
 *   node e2e/entry-languages.cjs [folder for screenshots]
 */
const { chromium } = require('playwright');
const coverage = require('./coverage.cjs');
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
const PORT = 4400;

(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'uhlaka-e2e-entry-languages-'));
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

  const browser = await coverage.launch(chromium, 'entry-languages');
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const canvas = page.frameLocator('iframe');
    const siteSaved = () => page.waitForResponse((r) => r.url().endsWith('/api/site') && r.request().method() === 'PUT');
    const stored = () => page.locator('.status[data-state="saved"]').waitFor();
    await page.goto(url);

    // Romanian, and the home page in it.
    await page.locator('[data-nav="settings"]').click();
    await page.locator('[data-language-new]').fill('ro');
    const saved = siteSaved();
    await page.locator('[data-language-add]').click();
    await saved;
    await page.locator('[data-back]').click();
    await page.locator('[data-translate="ro"]').click();
    await page.locator('.builder:not([hidden])').waitFor();
    await page.getByRole('button', { name: 'Publish' }).click();
    await page.getByText('Published', { exact: true }).waitFor();
    await page.locator('[data-back]').click();

    // The blog has a name and an address in Romanian.
    await page.locator('[data-nav="types"]').click();
    await page.locator('[data-type="posts"] button.open').click();
    await page.locator('[data-type-language="ro"] [data-type-language-name]').fill('Jurnal');
    await page.locator('[data-type-language="ro"] [data-type-language-path]').fill('jurnal');
    await page.locator('[data-type-language="ro"]').getByText('/ro/jurnal/').waitFor();
    if (shots) await page.screenshot({ path: join(shots, 'entry-languages-type.png'), fullPage: true });
    await page.locator('[data-type-save]').click();
    await page.locator('[data-type="posts"]').waitFor();
    assert(true, 'a type is named and placed in another language in its settings');

    // A post started in Romanian from its list.
    await page.locator('[data-nav="posts"]').click();
    const first = await page.locator('[data-list="post"] tbody tr button.open').first().getAttribute('data-open');
    const others = await page.locator('[data-list="post"] tbody tr').count();
    await page.locator(`[data-translate="ro/${first}"]`).click();
    await canvas.locator('article.post h1').waitFor();
    assert((await canvas.locator('.crumbs a').nth(1).innerText()) === 'Jurnal', 'a post in Romanian is drawn in its type\'s Romanian name');
    const settingsOpen = page.getByRole('button', { name: 'Back to the page' });
    if (await settingsOpen.isVisible()) await settingsOpen.click();
    const title = page.locator('aside label.field input').first();
    await title.fill('Prima noastră poveste');
    await canvas.locator('article.post h1', { hasText: 'Prima noastră poveste' }).waitFor();
    await page.locator('[data-translation-address]').fill('prima-poveste');
    await page.locator('[data-translation-address]').press('Tab');
    await stored();
    await page.locator('[data-add="text"]').click();
    await page.getByText('The date, pictures, categories, choices and links are those of the main entry').first().waitFor();
    assert(true, 'a translation adds no block: the layout is the main entry\'s');
    if (shots) await page.screenshot({ path: join(shots, 'entry-languages-editor.png') });
    await page.getByRole('button', { name: 'Publish' }).click();
    await page.getByText('Published', { exact: true }).waitFor();
    await page.locator('[data-back]').click();
    await page.locator('button[data-open="ro/prima-poveste"]').waitFor();
    assert(true, 'the list shows the post\'s Romanian translation at its own address');
    if (shots) await page.screenshot({ path: join(shots, 'entry-languages-list.png') });

    // The exported site: the post at its Romanian address, and only it in the Romanian list.
    const out = join(dir, 'out');
    cli('export', db, out);
    const ro = readFileSync(join(out, 'ro/jurnal/prima-poveste/index.html'), 'utf8');
    assert(ro.includes('<html lang="ro">') && ro.includes('Prima noastră poveste'), 'the post is published in Romanian at /ro/jurnal/prima-poveste/');
    const list = readFileSync(join(out, 'ro/jurnal/index.html'), 'utf8');
    assert(list.includes('/ro/jurnal/prima-poveste/') && (list.match(/class="post-card"/g) ?? []).length === 1 && others > 1, 'the Romanian list shows only the posts translated into Romanian');
    assert(readFileSync(join(out, 'ro/index.html'), 'utf8').includes('href="/ro/jurnal/"'), 'the Romanian menu leads to the Romanian list');
    assert(errors.length === 0, `no errors in the browser ${errors.join(' | ')}`);
  } catch (error) {
    if (shots) await browser.contexts()[0]?.pages()[0]?.screenshot({ path: join(shots, 'failure.png') }).catch(() => {});
    throw error;
  } finally {
    await browser.close();
    server.kill();
  }
  rmSync(dir, { recursive: true, force: true });
  console.log('\nEntries in a second language work.');
})().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
