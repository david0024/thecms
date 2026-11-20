/**
 * The site in a second language, in a real browser (ADR 0024, ADR 0032): the
 * language added in the settings with its own footer, a page translated from
 * the list of pages and drawn in that language, its words written over the
 * main page's blocks, its own address, the page split for the language, and a
 * language that still has pages kept.
 *
 *   node e2e/translations.cjs [folder for screenshots]
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
const PORT = 4398;

(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'thecms-e2e-translations-'));
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

  const browser = await coverage.launch(chromium, 'translations');
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const canvas = page.frameLocator('iframe');
    const siteSaved = () => page.waitForResponse((r) => r.url().endsWith('/api/site') && r.request().method() === 'PUT');
    await page.goto(url);

    // Romanian, added in the settings, with a footer of its own.
    await page.locator('[data-nav="settings"]').click();
    await page.locator('[data-language-new]').fill('ro');
    let saved = siteSaved();
    await page.locator('[data-language-add]').click();
    await saved;
    await page.locator('[data-site-other="ro"]').getByText('Română').waitFor();
    saved = siteSaved();
    await page.locator('[data-own-footer="ro"]').fill('Mobilă făcută de mână');
    await saved;
    saved = siteSaved();
    await page.locator('[data-own-action="ro"] input').first().fill('Cere o ofertă');
    await page.locator('[data-own-action="ro"] input').nth(1).fill('/ro/');
    await saved;
    assert(true, 'a second language is added in the settings, with its own footer and button');

    // The home page and "About", translated from the list of pages.
    await page.locator('[data-back]').click();
    await page.locator('[data-translate="ro"]').click();
    await page.locator('.builder:not([hidden])').waitFor();
    await page.locator('[data-back]').click();
    await page.locator('[data-translate="ro/about"]').click();
    await canvas.getByText('Mobilă făcută de mână').waitFor();
    assert((await canvas.locator('.menu-button').innerText()) === 'Meniu', 'a translation is drawn in its language: its words, its footer');
    assert((await canvas.locator('.site-languages a').count()) === 2, 'with a switcher between the languages');
    if (shots) await page.screenshot({ path: join(shots, 'translation-builder.png') });
    await page.locator('[data-back]').click();
    await page.locator('button[data-open="ro/about"]').waitFor();
    assert((await page.locator('[data-translate]').count()) > 0, 'the list of pages shows each page\'s translations, and what is still to translate');
    if (shots) await page.screenshot({ path: join(shots, 'translation-list.png') });

    // In Romanian only the words are written (ADR 0032): the blocks stay the main page's.
    const stored = () => page.locator('.status[data-state="saved"]').waitFor();
    await page.locator('button[data-open="ro/about"]').click();
    const prose = canvas.locator('.b-text .prose').first();
    await prose.waitFor();
    const main = (await prose.innerText()).split('\n')[0];
    const blocks = await canvas.locator('section.b').count();
    await prose.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('Despre atelier');
    await stored();
    await page.locator('[data-add="text"]').click();
    await page.getByText('The blocks, pictures and prices are those of the main page').first().waitFor();
    assert((await canvas.locator('section.b').count()) === blocks, 'a translation adds no block: the layout is the main page\'s');
    // Opened again, nothing is chosen on it, and the page itself is in the panel.
    await page.locator('[data-back]').click();
    await page.locator('button[data-open="ro/about"]').click();
    await canvas.locator('.b-text .prose').first().waitFor();
    const settingsOpen = page.getByRole('button', { name: 'Back to the page' });
    if (await settingsOpen.isVisible()) await settingsOpen.click();
    await page.locator('[data-translation-address]').fill('despre');
    await page.locator('[data-translation-address]').press('Tab');
    await page.waitForResponse((r) => r.url().endsWith('/api/page') && r.request().method() === 'PUT');
    await page.locator('[data-back]').click();
    await page.locator('button[data-open="ro/despre"]').waitFor();
    assert(true, 'a translation has an address of its own');
    await page.locator('button[data-open="about"]').click();
    await canvas.locator('.b-text .prose', { hasText: main }).waitFor();
    assert(true, 'and the main page keeps its words');

    // Split for Romanian: its blocks become its own.
    await page.locator('[data-back]').click();
    await page.locator('button[data-open="ro/despre"]').click();
    await canvas.locator('.b-text .prose', { hasText: 'Despre atelier' }).waitFor();
    await page.locator('[data-split]').click();
    await page.locator('[data-split-note]').waitFor();
    await canvas.locator('section.b').first().click();
    await page.locator('[data-add="text"]').click();
    await canvas.locator('section.b').nth(blocks).waitFor();
    await stored();
    assert(true, 'a page split for a language takes blocks of its own');
    await page.locator('[data-back]').click();

    // A language that still has pages is kept.
    await page.locator('[data-nav="settings"]').click();
    saved = siteSaved();
    await page.locator('[data-site-other="ro"] [data-language-remove]').click();
    await saved;
    await page.getByText('remove its translation before removing the language').first().waitFor();
    await page.locator('[data-site-other="ro"]').waitFor();
    assert(true, 'a language that still has pages is not removed');
    assert(errors.length === 0, `no errors in the browser ${errors.join(' | ')}`);
  } catch (error) {
    if (shots) await browser.contexts()[0]?.pages()[0]?.screenshot({ path: join(shots, 'failure.png') }).catch(() => {});
    throw error;
  } finally {
    await browser.close();
    server.kill();
  }
  rmSync(dir, { recursive: true, force: true });
  console.log('\nThe site in a second language works.');
})().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
