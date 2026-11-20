/**
 * Old addresses in a real browser (ADR 0036): a published page moved to
 * another address leaves a redirect behind, the settings list it and take
 * one written by hand, and the check before publishing says which lead
 * nowhere.
 *
 *   node e2e/redirects.cjs [folder for screenshots]
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
const PORT = 4395;

(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'thecms-e2e-redirects-'));
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

  const browser = await coverage.launch(chromium, 'redirects');
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const canvas = page.frameLocator('iframe');
    await page.goto(url);

    // Published, then moved: the old address leads to the new one.
    await page.locator('button[data-open="about"]').click();
    await page.locator('.builder:not([hidden])').waitFor();
    await canvas.locator('main').waitFor();
    // The demo's "About" is published.
    await page.waitForFunction(() => document.querySelector('.bar button.primary')?.disabled);
    const moving = () => page.waitForResponse((r) => r.url().endsWith('/api/move'));
    await page.locator('[data-page-address]').fill('despre-noi');
    let moved = moving();
    // Moved, the page is opened again at its new address.
    const reopened = page.waitForResponse((r) => r.url().includes('/api/page?') && r.url().includes('slug=despre-noi'));
    await page.locator('[data-page-address]').press('Tab');
    assert((await moved).ok(), 'a page moves to the address typed in the inspector');
    await reopened;
    await canvas.locator('main').waitFor();
    await page.locator('[data-page-address]').fill('contact');
    moved = moving();
    await page.locator('[data-page-address]').press('Tab');
    assert((await moved).status() === 400, 'an address another page has is refused');
    await page.getByText('is already the address of').first().waitFor();
    assert((await page.locator('[data-page-address]').inputValue()) === 'despre-noi', 'and the field says where the page still is');

    // The settings list it, and take one written by hand.
    await page.locator('[data-back]').click();
    await page.locator('[data-nav="settings"]').click();
    await page.locator('[data-redirect="/about/"]', { hasText: '/despre-noi/' }).waitFor();
    assert(true, 'the old address is listed, leading to the new one');
    await page.locator('[data-redirect-from]').fill('old-shop');
    await page.locator('[data-redirect-to]').fill('/nowhere/');
    await page.locator('[data-redirect-add]').click();
    await page.locator('[data-redirect="/old-shop/"]').waitFor();
    await page.locator('[data-redirect-from]').fill('/gone/');
    await page.locator('[data-redirect-to]').fill('/gone/');
    await page.locator('[data-redirect-add]').click();
    await page.getByText('That one was not kept').waitFor();
    if (shots) await page.screenshot({ path: join(shots, 'redirects.png') });
    assert(true, 'one written by hand is kept, cleaned; one that leads to itself is not');

    // The check before publishing says which lead nowhere; one is removed.
    await page.getByRole('button', { name: 'Back to the page' }).click().catch(() => {});
    await page.locator('[data-back]').click();
    await page.locator('[data-nav="pages"]').click();
    await page.locator('[data-check-run]').click();
    await page.locator('[data-check-redirects]', { hasText: '/old-shop/' }).waitFor();
    assert((await page.locator('[data-check-redirects] li').count()) === 1, 'the check names the redirect that leads nowhere, and only it');
    await page.locator('[data-nav="settings"]').click();
    await page.locator('[data-redirect-remove="/old-shop/"]').click();
    await page.locator('[data-redirect="/old-shop/"]').waitFor({ state: 'detached' });
    assert(true, 'a redirect is removed from the list');
    assert(errors.length === 0, `no errors in the browser ${errors.join(' | ')}`);
  } catch (error) {
    if (shots) await browser.contexts()[0]?.pages()[0]?.screenshot({ path: join(shots, 'failure.png') }).catch(() => {});
    throw error;
  } finally {
    await browser.close();
    server.kill();
  }
  rmSync(dir, { recursive: true, force: true });
  console.log('\nRedirects work.');
})().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
