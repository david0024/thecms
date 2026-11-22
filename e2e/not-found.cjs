/**
 * The addresses visitors ask for that the site does not have, in a real
 * browser (ADR 0063): listed in the settings with where the visitor came
 * from, a redirect made from one in a click, forgotten; and IndexNow asked for.
 *
 *   node e2e/not-found.cjs [folder for screenshots]
 */
const { chromium } = require('playwright');
const coverage = require('./coverage.cjs');
const { spawn, execFileSync } = require('node:child_process');
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs');
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
  const dir = mkdtempSync(join(tmpdir(), 'thecms-e2e-not-found-'));
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
  const site = (path) => new URL(path, url).href;
  const token = url.split('#token=')[1];

  const browser = await coverage.launch(chromium, 'not-found');
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const canvas = page.frameLocator('iframe');
    await page.goto(url);

    // Visitors ask for addresses the site does not have; robots look for another software's files.
    const missing = await page.request.get(site('/old-shop/'), { headers: { referer: 'https://other.example/links' } });
    assert(missing.status() === 404, 'an address the site does not have is not found');
    await page.request.get(site('/old-shop/'));
    await page.request.get(site('/wp-login.php'));

    await page.locator('[data-nav="settings"]').click();
    const row = page.locator('[data-not-found-path="/old-shop/"]');
    await row.waitFor();
    assert((await row.textContent()).includes('other.example/links'), 'the settings list it, with where the visitor came from');
    assert((await page.locator('[data-not-found] li').count()) === 1, "and not what a robot looked for");
    if (shots) await page.screenshot({ path: join(shots, 'not-found.png') });

    // One click fills a redirect from it.
    await page.locator('[data-not-found-lead="/old-shop/"]').click();
    assert((await page.locator('[data-redirect-from]').inputValue()) === '/old-shop/', 'Redirect fills the old address');
    await page.locator('[data-redirect-to]').fill('/about/');
    await page.locator('[data-redirect-add]').click();
    await page.locator('[data-redirect="/old-shop/"]').waitFor();
    await page.locator('[data-not-found-none]').waitFor();
    assert(true, 'and the address leaves the list once it leads somewhere');
    let led = 0;
    for (let i = 0; i < 30 && led !== 301; i++) {
      led = (await page.request.get(site('/old-shop/'), { maxRedirects: 0 })).status();
      if (led !== 301) await page.waitForTimeout(200);
    }
    assert(led === 301, 'the old address now leads to the page');

    // Forgotten one by one, or all at once.
    await page.request.get(site('/a/'));
    await page.request.get(site('/b/'));
    await page.reload();
    await page.locator('[data-nav="settings"]').click();
    await page.locator('[data-not-found-path="/b/"]').waitFor();
    await page.locator('[data-not-found-forget="/b/"]').click();
    await page.locator('[data-not-found-path="/b/"]').waitFor({ state: 'detached' });
    await page.locator('[data-not-found-forget-all]').click();
    await page.locator('[data-not-found-none]').waitFor();
    assert(true, 'one is forgotten, then all of them');

    // IndexNow, when the owner asks for it: kept, as the settings show it again.
    await page.locator('[data-site-indexnow]').check();
    await page.waitForTimeout(500);
    await page.reload();
    await page.locator('[data-nav="settings"]').click();
    assert(await page.locator('[data-site-indexnow]').isChecked(), 'the owner asks for IndexNow, and it is kept');
    assert(errors.length === 0, `no errors in the browser ${errors.join(' | ')}`);
  } catch (error) {
    if (shots) await browser.contexts()[0]?.pages()[0]?.screenshot({ path: join(shots, 'failure.png') }).catch(() => {});
    throw error;
  } finally {
    await browser.close();
    server.kill();
  }
  rmSync(dir, { recursive: true, force: true });
  console.log('\nThe addresses not found and IndexNow work.');
})().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
