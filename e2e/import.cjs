/**
 * A WordPress site brought in from the admin, in a real browser (ADR 0012):
 * choose the file, look at what would come, tick a kind of entry a plugin
 * added, run it, and read the exported files.
 *
 *   node e2e/import.cjs [folder for screenshots]
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

(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'thecms-e2e-import-'));
  const db = join(dir, 'site.db');
  const shots = process.argv[2];
  cli('init', db);

  const server = spawn('bun', ['src/site/cli.ts', 'edit', db, '4397'], { cwd: root });
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

  const browser = await coverage.launch(chromium, 'import');
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(url);
    await page.locator('[data-nav="import"]').click();
    const screen = page.locator('[data-list="import"]');

    // A file that is not an export: said in words, nothing offered.
    await page.locator('[data-import-file]').setInputFiles({ name: 'notes.xml', mimeType: 'text/xml', buffer: Buffer.from('<notes><note>hello</note></notes>') });
    await screen.locator('[role="alert"]').waitFor();
    assert((await screen.locator('[role="alert"]').innerText()).includes('not a WordPress export'), 'a file that is not a WordPress export is refused, in words');
    assert((await screen.locator('[data-import-preview]').count()) === 0, 'and nothing is offered for it');
    errors.length = 0;

    await page.locator('[data-import-file]').setInputFiles(join(root, 'test/fixtures/wordpress.xml'));
    const preview = screen.locator('[data-import-preview]');
    await preview.waitFor();
    const counts = (await preview.locator('.counts').innerText()).replace(/\s+/g, ' ');
    assert(counts.includes('4 pages') && counts.includes('2 posts') && counts.includes('2 images'), `the file is read and counted before anything is written (${counts})`);
    assert((await preview.locator('.notes li').count()) > 5, 'what would not come over is said before the import, not after');
    if (shots) await page.screenshot({ path: join(shots, 'admin-import.png'), fullPage: true });

    await preview.locator('[data-import-type="product"]').check();
    await preview.locator('.counts li', { hasText: 'Product' }).waitFor();
    assert(await preview.locator('[data-import-type="product"]').isChecked(), 'a kind of entry a plugin added can be ticked, and is counted');
    // A category kept as a section of its own: its posts leave the blog. Ticked, counted, then left as it was.
    await preview.locator('[data-import-category="news"]').check();
    await preview.locator('.counts li', { hasText: 'News' }).waitFor();
    assert((await preview.locator('.counts').innerText()).replace(/\s+/g, ' ').includes('1 posts'), 'a category can be made a section of its own, and its posts leave the blog');
    if (shots) await page.screenshot({ path: join(shots, 'admin-import-category.png'), fullPage: true });
    await preview.locator('[data-import-category="news"]').uncheck();
    await preview.locator('.counts li', { hasText: 'News' }).waitFor({ state: 'detached' });
    await preview.locator('[data-import-images]').uncheck();
    await preview.locator('[data-import-run]').click();
    const done = screen.locator('[data-import-done]');
    await done.waitFor();
    const summary = await done.locator('p').first().innerText();
    assert(summary.includes('2 posts') && summary.includes('1 entries of other types'), `the report is on the screen (${summary})`);
    if (shots) await page.screenshot({ path: join(shots, 'admin-import-done.png'), fullPage: true });

    // The admin knows about what came, without being opened again.
    await page.locator('[data-nav="product"]').click();
    await page.locator('[data-list="product"] tr', { hasText: 'Chair' }).waitFor();
    await page.locator('[data-nav="posts"]').click();
    await page.locator('[data-list="post"] tr', { hasText: 'Hello world' }).waitFor();
    assert(true, 'the imported posts and the new content type are in the admin at once');
    assert((await page.locator('.rail strong').innerText()) === 'Atelier Nord', 'the site kept its own name');

    // The report is still there on coming back, until another import is asked for.
    await page.locator('[data-nav="import"]').click();
    await done.waitFor();
    await done.getByRole('button').click();
    await screen.locator('[data-import-choose]').waitFor();
    await page.locator('[data-nav="pages"]').click();
    await page.locator('[data-nav="import"]').click();
    await screen.locator('[data-import-choose]').waitFor();
    assert((await done.count()) === 0, 'the report goes away when another import is asked for');
    assert(errors.length === 0, `no errors in the browser console ${errors.join(' | ')}`);
  } catch (error) {
    if (shots) await browser.contexts()[0]?.pages()[0]?.screenshot({ path: join(shots, 'failure.png') }).catch(() => {});
    throw error;
  } finally {
    await browser.close();
    server.kill();
  }

  const out = join(dir, 'out');
  cli('export', db, out);
  assert(readFileSync(join(out, 'blog/hello-world/index.html'), 'utf8').includes('First <strong>post</strong>'), 'an imported post is exported at its address');
  assert(readFileSync(join(out, 'product/chair/index.html'), 'utf8').includes('Chair'), 'so is an entry of the content type the import added');
  assert(readFileSync(join(out, '2024/01/hello-world/index.html'), 'utf8').includes('url=/blog/hello-world/'), 'and the old address leads to the new one');
  assert(readFileSync(join(out, 'index.html'), 'utf8').includes('Solid wood furniture, made to measure'), 'the home page the site already had is still its home page');
  rmSync(dir, { recursive: true, force: true });
  console.log('\nThe import works from the admin.');
})().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
