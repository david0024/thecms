/**
 * A complete export in a real browser (ADR 0057): the Export screen offers
 * the content in one file, all of it or some parts, and the site as files in
 * a ZIP with what a static host would not do; the site's data is read as
 * JSON and turned off in the settings; the content file is brought into
 * another site from its Import screen.
 *
 *   node e2e/export.cjs [folder for screenshots]
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

/** The editor on a site, and the address it printed. */
function edit(db, port) {
  const server = spawn('bun', ['src/site/cli.ts', 'edit', db, String(port)], { cwd: root, env: process.env });
  const url = new Promise((resolve, reject) => {
    let out = '';
    server.stdout.on('data', (chunk) => {
      out += chunk;
      const found = out.match(/http:\/\/127\.0\.0\.1:\d+\/admin\/#token=\w+/);
      if (found) resolve(found[0]);
    });
    server.stderr.on('data', (chunk) => process.stderr.write(chunk));
    server.on('exit', () => reject(new Error('the editor stopped')));
  });
  return { server, url };
}

(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'thecms-e2e-export-'));
  const shots = process.argv[2];
  cli('init', join(dir, 'a.db'));
  cli('init', join(dir, 'b.db'));
  const first = edit(join(dir, 'a.db'), 4431);
  const second = edit(join(dir, 'b.db'), 4433);
  const browser = await coverage.launch(chromium, 'export');
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(await first.url);

    // What a beginner reads: the site's data is there, and what a static host would lose.
    const about = await page.request.get('http://127.0.0.1:4431/about/index.json');
    assert(about.ok() && (await about.json()).title === 'About', 'a page is read as JSON at its address');
    // A page behind a password is something a static host cannot do.
    const token = (await first.url).split('#token=')[1];
    const locked = await page.request.post('http://127.0.0.1:4431/api/locks', { headers: { 'x-thecms-token': token }, data: { slug: 'contact', password: 'open sesame' } });
    assert(locked.ok(), 'a page is put behind a password');
    let hidden = 200;
    for (let i = 0; i < 20 && hidden === 200; i++) {
      if (i) await page.waitForTimeout(250);
      hidden = (await page.request.get('http://127.0.0.1:4431/contact/index.json')).status();
    }
    assert(hidden === 404, 'and its data is not served');
    await page.locator('[data-nav="export"]').click();
    const screen = page.locator('[data-list="export"]');
    await screen.locator('[data-export-data="on"]').waitFor();
    await screen.locator('[data-export-lose] [data-server-only="locked"]').waitFor();
    assert(true, 'the Export screen says a page behind a password would not work on a static host');
    assert((await screen.locator('[data-export-part]').count()) === 5, 'the parts are offered: pages, posts, sections, forms, the design');
    if (shots) await page.screenshot({ path: join(shots, 'export.png'), fullPage: true });

    // Some parts, then all of them.
    await screen.locator('[data-export-part="design"]').uncheck();
    assert(!(await screen.locator('[data-export-all]').isChecked()), 'a part left out leaves "The whole site" unticked');
    let [download] = await Promise.all([page.waitForEvent('download'), screen.locator('[data-export-content]').click()]);
    await download.saveAs(join(dir, 'some.thecms.json'));
    const some = JSON.parse(readFileSync(join(dir, 'some.thecms.json'), 'utf8'));
    assert(!some.parts.includes('design') && some.parts.includes('pages'), 'the content file holds the parts chosen');
    await screen.locator('[data-export-all]').check();
    await screen.locator('[data-export-all]').uncheck();
    assert(await screen.locator('[data-export-content]').isDisabled(), 'with nothing chosen there is nothing to download');
    await screen.locator('[data-export-part="pages"]').check();
    await screen.locator('[data-export-all]').check();
    [download] = await Promise.all([page.waitForEvent('download'), screen.locator('[data-export-content]').click()]);
    assert(download.suggestedFilename().endsWith('.thecms.json'), 'the content is downloaded as a .thecms.json file');
    const saved = join(dir, 'all.thecms.json');
    await download.saveAs(saved);
    assert(JSON.parse(readFileSync(saved, 'utf8')).parts.length === 5, 'the whole site holds every part');
    [download] = await Promise.all([page.waitForEvent('download'), screen.locator('[data-export-files]').click()]);
    await download.saveAs(join(dir, 'site.zip'));
    assert(readFileSync(join(dir, 'site.zip')).subarray(0, 2).toString() === 'PK', 'the site as files is downloaded as a ZIP');

    // With visitor accounts on, the visitors are offered apart: never with the whole site, only when ticked (ADR 0064 d6).
    assert((await screen.locator('[data-export-apart]').count()) === 0, 'a site that never had accounts offers no visitors');
    const on = await page.request.put('http://127.0.0.1:4431/api/visitors', { headers: { 'x-thecms-token': token }, data: { on: true, signup: 'invite' } });
    assert(on.ok(), 'visitor accounts are turned on');
    await page.locator('[data-nav="pages"]').click();
    await page.locator('[data-nav="export"]').click();
    const apart = screen.locator('[data-export-apart="visitors"]');
    await apart.waitFor();
    assert((await apart.isChecked()) === false && (await screen.locator('[data-export-all]').isChecked()), 'the visitors are offered unticked, apart from the whole site');
    assert((await screen.locator('[data-export-part]').count()) === 5, 'and are not one of its parts');
    if (shots) await page.screenshot({ path: join(shots, 'export-visitors.png'), fullPage: true });
    await apart.check();
    [download] = await Promise.all([page.waitForEvent('download'), screen.locator('[data-export-content]').click()]);
    await download.saveAs(join(dir, 'visitors.thecms.json'));
    const withVisitors = JSON.parse(readFileSync(join(dir, 'visitors.thecms.json'), 'utf8'));
    assert(withVisitors.parts.length === 6 && withVisitors.parts.includes('visitors') && Array.isArray(withVisitors.visitors), 'ticked, the whole site comes with the visitors');
    await apart.uncheck();

    // Turned off in the settings, the data is not there, and the screen says where to turn it on.
    await page.locator('[data-nav="settings"]').click();
    await page.locator('[data-site-data]').uncheck();
    await page.waitForResponse((r) => r.url().endsWith('/api/site') && r.request().method() !== 'GET');
    let status = 200;
    for (let i = 0; i < 20 && status === 200; i++) {
      if (i) await page.waitForTimeout(250);
      status = (await page.request.get('http://127.0.0.1:4431/about/index.json')).status();
    }
    assert(status === 404, 'turned off, the data is not served');
    await page.goto('about:blank');
    await page.goto(await first.url);
    await page.locator('[data-nav="export"]').click();
    await page.locator('[data-export-data="off"]').waitFor();
    assert(true, 'the Export screen says the data is turned off');

    // The other site takes the file in, with the old site's settings.
    await page.goto(await second.url);
    await page.locator('[data-nav="import"]').click();
    const imp = page.locator('[data-list="import"]');
    await page.locator('[data-import-file]').setInputFiles(saved);
    const preview = imp.locator('[data-import-preview]');
    await preview.waitFor();
    const counts = (await preview.locator('.counts').innerText()).replace(/\s+/g, ' ');
    assert(/3 pages/.test(counts) && /forms/.test(counts) && /sections/.test(counts), `the file is shown counted before anything is written (${counts})`);
    assert((await preview.locator('[data-import-images]').count()) === 0, 'there is nothing to copy from an old site');
    await preview.locator('[data-import-settings]').check();
    if (shots) await page.screenshot({ path: join(shots, 'export-import.png'), fullPage: true });
    await preview.locator('[data-import-run]').click();
    const done = imp.locator('[data-import-done]');
    await done.waitFor();
    assert((await done.innerText()).includes('Already in this site under the same address'), 'what the site had is left as it was, and said');
    assert(errors.length === 0, `no errors in the browser ${errors.join(' | ')}`);
  } catch (error) {
    if (shots) await browser.contexts()[0]?.pages()[0]?.screenshot({ path: join(shots, 'failure.png') }).catch(() => {});
    throw error;
  } finally {
    await browser.close();
    first.server.kill();
    second.server.kill();
  }
  rmSync(dir, { recursive: true, force: true });
  console.log('\nThe export works.');
})().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
