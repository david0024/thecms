/**
 * Search engines and sharing in a real browser (ADR 0050): the panel beside a
 * page writes its title for search engines, hides it and shows the preview;
 * the site's settings turn the breadcrumbs off; the check before publishing
 * says what would hurt.
 *
 *   node e2e/seo.cjs [folder for screenshots]
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
const PORT = 4397;
const LONG = 'Handmade oak tables, benches and shelves from a small family workshop';

(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'thecms-e2e-seo-'));
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

  const browser = await coverage.launch(chromium, 'seo');
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const canvas = page.frameLocator('iframe');
    await page.goto(url);

    // The panel beside a page: closed until opened, then a title, a preview, and the choice to hide.
    await page.locator('button[data-open="about"]').click();
    await page.locator('.builder:not([hidden])').waitFor();
    await canvas.locator('main').waitFor();
    assert(!(await page.locator('[data-seo-title]').isVisible()), 'the panel is closed until it is opened');
    await page.locator('[data-seo] > summary').click();
    const placeholder = await page.locator('[data-seo-title]').getAttribute('placeholder');
    assert(placeholder.startsWith('About'), `empty, the title is the page's own (${placeholder})`);
    await page.locator('[data-seo-title]').fill(LONG);
    await page.locator('[data-seo-preview] strong', { hasText: 'Handmade oak' }).waitFor();
    assert((await page.locator('[data-seo-preview] strong').innerText()).endsWith('…'), 'the search preview shows the title, cut where a search engine cuts it');
    assert((await page.locator('[data-share-preview] strong').innerText()) === LONG, 'and the share preview shows it whole');
    await page.locator('[data-seo-noindex]').check();
    await page.waitForFunction(() => document.querySelector('[data-seo-preview]')?.classList.contains('hidden'));
    assert(true, 'hidden, the search preview is struck through');
    if (shots) await page.screenshot({ path: join(shots, 'seo-panel.png') });
    await page.getByRole('button', { name: 'Publish' }).click();
    await page.getByText('Published', { exact: true }).waitFor();
    const about = await (await page.request.get(site('/about/'))).text();
    assert(about.includes(`<title>${LONG}</title>`), 'published, the page has its title for search engines');
    assert(about.includes('<meta name="robots" content="noindex">'), 'and asks search engines to leave it out');

    // A post shows where it is; the settings turn that off.
    await page.locator('[data-back]').click();
    await page.locator('[data-nav="posts"]').click();
    await page.locator('[data-open="how-we-choose-wood"]').click();
    await canvas.locator('nav.crumbs').waitFor();
    assert((await canvas.locator('nav.crumbs a').first().innerText()) === 'Home', 'a post shows the breadcrumbs, from home');
    assert(await page.locator('[data-seo]').evaluate((d) => d.open), 'the panel stays open from one page to the next');
    assert((await page.locator('[data-seo-preview] small').innerText()) === '/blog/how-we-choose-wood/', `a post's search preview shows its address (${await page.locator('[data-seo-preview] small').innerText()})`);
    await page.locator('[data-back]').click();
    await page.locator('[data-nav="settings"]').click();
    await page.locator('[data-site-breadcrumbs]').uncheck();
    await page.waitForResponse((r) => r.url().endsWith('/api/site') && r.request().method() !== 'GET');
    let post = '';
    for (let i = 0; i < 20 && (post === '' || post.includes('class="b crumbs"')); i++) {
      if (post) await page.waitForTimeout(250);
      post = await (await page.request.get(site('/blog/how-we-choose-wood/'))).text();
    }
    assert(!post.includes('class="b crumbs"'), 'turned off, the breadcrumbs are not shown on the site');

    // Shown to search engines again, the check before publishing names its long title.
    await page.getByRole('button', { name: 'Back to the page' }).click().catch(() => {});
    await page.locator('[data-back]').click();
    await page.locator('[data-nav="pages"]').click();
    await page.locator('button[data-open="about"]').click();
    await canvas.locator('main').waitFor();
    if (!(await page.locator('[data-seo]').evaluate((d) => d.open))) await page.locator('[data-seo] > summary').click();
    await page.locator('[data-seo-noindex]').uncheck();
    await page.getByRole('button', { name: 'Publish' }).click();
    await page.getByText('Published', { exact: true }).waitFor();
    await page.locator('[data-back]').click();
    await page.locator('[data-check-run]').click();
    await page.locator('[data-check-seo] [data-seo-problem="long"]').waitFor();
    assert((await page.locator('[data-check-seo]').innerText()).includes('/about/'), 'the check says which title search engines would cut');
    if (shots) await page.screenshot({ path: join(shots, 'seo-check.png') });
    assert(errors.length === 0, `no errors in the browser ${errors.join(' | ')}`);
  } catch (error) {
    if (shots) await browser.contexts()[0]?.pages()[0]?.screenshot({ path: join(shots, 'failure.png') }).catch(() => {});
    throw error;
  } finally {
    await browser.close();
    server.kill();
  }
  rmSync(dir, { recursive: true, force: true });
  console.log('\nSearch engines and sharing work.');
})().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
