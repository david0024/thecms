/**
 * Statistics in a real browser (ADR 0053): pages read by visitors (asked for
 * here with a browser's name, as a person's browser would), a robot that is
 * not counted, then the Statistics screen: the totals, the chart, the lists,
 * and each range.
 *
 *   node e2e/stats.cjs [folder for screenshots]
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
const PORT = 4400;
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const GOOGLEBOT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'thecms-e2e-stats-'));
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
  const site = `http://127.0.0.1:${PORT}`;

  const browser = await coverage.launch(chromium, 'stats');
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(url);
    // A new site: nothing counted yet, and said so.
    await page.locator('[data-nav="stats"]').click();
    await page.locator('[data-stats-empty]').waitFor();
    assert(true, 'nothing counted yet, and said so');

    // Three people and a robot read the site.
    const read = (path, agent, ip, referer) =>
      fetch(`${site}${path}`, { headers: { 'user-agent': agent, 'x-forwarded-for': ip, ...(referer ? { referer } : {}) } }).then((r) => r.status);
    assert((await read('/', CHROME, '10.0.0.1')) === 200, 'the home page is served');
    await read('/about/', CHROME, '10.0.0.1', `${site}/`);
    await read('/about/', CHROME, '10.0.0.2', 'https://www.google.com/');
    await read('/', IPHONE, '10.0.0.3', 'https://l.facebook.com/');
    await read('/_/search?q=oak', CHROME, '10.0.0.1');
    await read('/', GOOGLEBOT, '10.0.0.9');
    // Written to the database within a few seconds.
    await new Promise((resolve) => setTimeout(resolve, 6000));

    await page.locator('[data-stats-range="7"]').click();
    await page.locator('[data-stats-range="30"]').click();
    await page.locator('[data-stats-chart]').waitFor();
    assert((await page.locator('[data-stats-visitors]').textContent()) === '3', 'three visitors, the robot left out');
    assert((await page.locator('[data-stats-views]').textContent()) === '4', 'four pages seen');
    await page.locator('[data-stats-chart]').waitFor();
    assert((await page.locator('[data-stats-chart] rect.visitors').count()) === 30, 'a chart of 30 days');
    const pages = await page.locator('[data-stats-list="pages"] li').allTextContents();
    assert(pages.length === 2 && pages.every((p) => p.endsWith('2')), `the pages read most: ${pages.join(' | ')}`);
    const sources = await page.locator('[data-stats-list="sources"] li').allTextContents();
    assert(['Google', 'Facebook', 'Direct'].every((s) => sources.some((t) => t.includes(s))), `where visitors came from: ${sources.join(' | ')}`);
    const devices = await page.locator('[data-stats-list="devices"] li').allTextContents();
    assert(devices.some((d) => d.startsWith('Computer')) && devices.some((d) => d.startsWith('Phone')), `phone and computer: ${devices.join(' | ')}`);
    assert((await page.locator('[data-stats-list="searches"] li').allTextContents()).join() === 'oak1', 'what was searched for');
    const zone = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
    assert((await page.locator('[data-stats-zone]').textContent()).includes(zone), "the days are the owner's");
    if (shots) await page.screenshot({ path: join(shots, 'stats.png'), fullPage: true });

    // Each range.
    await page.locator('[data-stats-range="7"]').click();
    await page.locator('[data-stats-chart] rect.visitors >> nth=6').waitFor();
    assert((await page.locator('[data-stats-chart] rect.visitors').count()) === 7, 'a chart of 7 days');
    await page.locator('[data-stats-range="365"]').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-stats-chart] rect.visitors').length >= 12);
    assert(true, 'a chart of 12 months, by month');
    await page.locator('[data-stats-range="today"]').click();
    await page.locator('[data-stats-chart]').waitFor({ state: 'detached' });
    assert((await page.locator('[data-stats-views]').textContent()) === '4', 'today, without a chart of one bar');
    assert(errors.length === 0, `no errors in the browser ${errors.join(' | ')}`);
  } catch (error) {
    if (shots) await browser.contexts()[0]?.pages()[0]?.screenshot({ path: join(shots, 'failure.png') }).catch(() => {});
    throw error;
  } finally {
    await browser.close();
    server.kill();
  }
  rmSync(dir, { recursive: true, force: true });
  console.log('\nStatistics work.');
})().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
