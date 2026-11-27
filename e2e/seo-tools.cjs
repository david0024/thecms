/**
 * Tools for a large site, in a real browser (ADR 0077): the links a page could
 * add, every title and description in one table with the missing ones written
 * by an extension, and Search Console waiting for the owner's key.
 *
 *   node e2e/seo-tools.cjs [folder for screenshots]
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
const PORT = 4441;

(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'uhlaka-e2e-seo-tools-'));
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

  const browser = await coverage.launch(chromium, 'seo-tools');
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const canvas = page.frameLocator('iframe');
    const apiCall = (method, path, body) =>
      page.evaluate(
        async ([m, p, b, t]) => {
          const r = await fetch(p, { method: m, headers: { 'x-uhlaka-token': t, ...(b ? { 'content-type': 'application/json' } : {}) }, body: b ? JSON.stringify(b) : undefined });
          return { status: r.status, body: await r.json() };
        },
        [method, path, body, token],
      );
    await page.goto(url);

    // The about page names the contact page without linking to it.
    const about = (await apiCall('GET', '/api/page?kind=page&slug=about')).body.page;
    about.blocks = [{ id: 'b_contact', type: 'text', content: { body: [{ type: 'paragraph', children: [{ text: 'Write to us from the Contact page.' }] }] }, children: [] }];
    assert((await apiCall('PUT', '/api/page', { page: about })).status === 200, 'the about page names the contact page');
    await page.reload();
    await page.locator('button[data-open="about"]').click();
    await canvas.locator('main').waitFor();
    await page.locator('[data-seo] > summary').click();
    const suggestion = page.locator('[data-link-suggestion="/contact/"]');
    await suggestion.waitFor();
    assert((await page.locator('[data-link-suggestions] li').count()) === 1, 'the editor suggests a link to the contact page, and only it');
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.locator('[data-link-copy="/contact/"]').click();
    await page.waitForFunction(() => document.querySelector('[data-link-copy="/contact/"]')?.textContent?.includes('Copied'));
    assert(true, 'its address is copied, to link the words');
    if (shots) await page.screenshot({ path: join(shots, 'seo-tools-links.png') });

    // An extension that writes descriptions, for the table.
    const packed = execFileSync('bun', ['tools/pack-extension.ts', 'test/fixtures/extension', dir], { cwd: root, encoding: 'utf8' }).trim().split('  ')[1];
    await page.locator('[data-back]').click().catch(() => {});
    await page.locator('[data-nav="extensions"]').click();
    await page.locator('[data-extension-file]').setInputFiles(packed);
    await page.locator('[data-accept]').click();
    await page.locator('[data-extension="shout"]').waitFor();
    assert(true, 'an extension that writes descriptions is installed');

    // Every title and description in one table.
    await page.locator('[data-nav="seo"]').click();
    const row = page.locator('[data-seo-row="/contact"]');
    await row.waitFor();
    assert((await page.locator('[data-seo-row]').count()) >= 5, 'every page and entry is in the table');
    await row.locator('[data-seo-row-title]').fill('Write to the workshop');
    await row.locator('[data-seo-row-title]').press('Tab');
    await page.waitForFunction(async (t) => (await (await fetch('/api/seo', { headers: { 'x-uhlaka-token': t } })).json()).rows.some((r) => r.slug === 'contact' && r.seoTitle === 'Write to the workshop'), token);
    assert(true, 'a title for search engines is written in the table');
    const published = (await apiCall('GET', '/api/state')).body.pages.find((p) => p.slug === 'contact');
    assert(published.published && !published.changed, 'and the published page says it at once');
    await page.locator('[data-seo-missing]').check();
    assert((await page.locator('[data-seo-row="/contact"]').count()) === 1, 'a page without a description is still among those missing');

    // The missing descriptions, written by the extension for the whole site.
    await page.locator('[data-seo-fill="describe"]').click();
    await page.locator('[data-seo-writing]').waitFor();
    await page.locator('[data-seo-writing]').waitFor({ state: 'detached', timeout: 90_000 });
    const rows = (await apiCall('GET', '/api/seo')).body.rows;
    assert(rows.filter((r) => !r.noindex).every((r) => r.description), 'the extension writes every missing description');
    const contact = rows.find((r) => r.slug === 'contact');
    assert(contact.description === `All about ${contact.title}.`, `each one is its own (${contact.description})`);
    assert((await page.locator('[data-seo-fill="title"]').count()) === 0, 'an action that asks something first is not offered for the whole site');
    if (shots) await page.screenshot({ path: join(shots, 'seo-tools-table.png') });
    assert(errors.length === 0, `no errors in the browser ${errors.join(' | ')}`);

    // Search Console, beside the statistics, waits for the owner's key.
    await page.locator('[data-nav="stats"]').click();
    await page.locator('[data-search-console-key]').waitFor();
    await page.locator('[data-search-console-key]').fill('not a key');
    await page.locator('[data-search-console-connect]').click();
    await page.locator('[data-search-console] [role="alert"]', { hasText: 'service account' }).waitFor();
    assert(true, 'a key that is not one is said at once');

    // Connected, it shows what Google counted: here answered for Google, as the browser asks the site.
    const report = {
      connected: true,
      email: 'reader@project.iam.gserviceaccount.com',
      property: 'https://example.com/',
      report: { from: '2026-10-27', to: '2026-11-23', queries: [{ key: 'oak table', clicks: 12, impressions: 340, ctr: 0.0353, position: 4.3 }], pages: [{ key: 'https://example.com/contact/', clicks: 7, impressions: 90, ctr: 0.0778, position: 2.1 }] },
    };
    let asked = 0;
    await page.route('**/api/search-console**', (route) => {
      asked += 1;
      return route.fulfill({ json: route.request().method() === 'DELETE' ? { connected: false } : report });
    });
    await page.reload();
    await page.locator('[data-nav="stats"]').click();
    await page.locator('[data-search-console-report]').waitFor();
    const shown = await page.locator('[data-search-console]').innerText();
    assert(shown.includes('oak table') && shown.includes('/contact/') && shown.includes('3.5%') && shown.includes('reader@project'), 'what people searched for and the pages they found are shown');
    if (shots) await page.screenshot({ path: join(shots, 'seo-tools-console.png') });
    await page.locator('[data-search-console-refresh]').click();
    await page.waitForFunction((n) => n > 1, asked);
    await page.locator('[data-nav="seo"]').click();
    await page.locator('[data-seo-row="/contact"] [data-seo-google]', { hasText: '7' }).waitFor();
    assert(true, 'the table shows what Google counted for each page');
    await page.locator('[data-nav="stats"]').click();
    await page.locator('[data-search-console-disconnect]').click();
    await page.locator('[data-search-console-key]').waitFor();
    assert(true, 'and the owner disconnects it');
  } catch (error) {
    if (shots) await browser.contexts()[0]?.pages()[0]?.screenshot({ path: join(shots, 'failure.png') }).catch(() => {});
    throw error;
  } finally {
    await browser.close();
    server.kill();
  }
  rmSync(dir, { recursive: true, force: true });
  console.log('\nThe tools for a large site work.');
})().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
