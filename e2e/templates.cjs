/**
 * A content type's own page (ADR 0015), in a real browser: design the page of
 * posts in the builder, publish it, type into a post inside it, export, and go
 * back to the default page.
 *
 *   node e2e/templates.cjs [folder for screenshots]
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
  const dir = mkdtempSync(join(tmpdir(), 'uhlaka-e2e-tpl-'));
  const db = join(dir, 'site.db');
  const shots = process.argv[2];
  cli('init', db);

  const server = spawn('bun', ['src/site/cli.ts', 'edit', db, '4396'], { cwd: root });
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

  const browser = await coverage.launch(chromium, 'templates');
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
    page.on('pageerror', (error) => errors.push(error.message));
    const canvas = page.frameLocator('iframe');
    const saved = () => page.locator('.status[data-state="saved"]').waitFor();
    await page.goto(url);

    // Design the page every post is shown in.
    await page.locator('[data-nav="types"]').click();
    await page.locator('[data-design="posts"]').click();
    await canvas.locator('.b-entry h1').first().waitFor();
    assert((await page.locator('.bar .doc').innerText()) === 'Post page', 'the page of posts opens in the builder');
    assert(await canvas.locator('.entry-body').innerText().then((t) => t.length > 20), 'it is drawn around the newest post, as an example');
    assert((await page.locator('[data-add="entry"]').count()) === 1, 'the part of the entry can be added here');
    await page.locator('[data-add="contact"]').click();
    await canvas.locator('.b-contact').waitFor();
    await saved();
    await canvas.locator('.b-entry .post-head h1').click();
    await page.locator('[data-field-part]').selectOption('title');
    await canvas.locator('.b-entry > .b-in > h1').waitFor();
    assert((await canvas.locator('.b-entry .post-meta').count()) === 0, 'a part can show the title alone');
    // The example inside is shown, not edited.
    await canvas.locator('.entry-body p').first().click();
    assert((await canvas.locator('.cms-selected.b-entry').count()) === 1, "clicking the example entry selects the part that holds it, not the entry's own blocks");
    assert((await canvas.locator('.entry-body [contenteditable]').count()) === 0, 'and nothing of the example can be typed into');
    await saved();
    if (shots) await page.screenshot({ path: join(shots, 'admin-design.png') });
    await page.getByRole('button', { name: 'Publish' }).click();
    await page.getByText('Published', { exact: true }).waitFor();
    await page.locator('[data-back]').click();
    assert((await page.locator('[data-list="types"] tr[data-type="posts"]').innerText()).includes('Own page'), 'the list of types says posts have a page of their own');

    // Typing into a post: the page around it is there, and only the post is edited.
    await page.locator('[data-nav="posts"]').click();
    await page.locator('[data-list="post"] tbody tr button').first().click();
    await canvas.locator('[data-frozen] .b-contact').waitFor();
    await canvas.locator('[data-frozen] .b-contact').click();
    assert((await canvas.locator('.cms-selected').count()) === 0, "the type's page around a post cannot be selected while the post is edited");
    await canvas.locator('[data-live] .b-text').first().click();
    assert((await canvas.locator('[data-live] .cms-selected').count()) === 1, "the post's own blocks can");
    assert((await canvas.locator('[data-frozen] [contenteditable]:not([data-live] *)').count()) === 0, 'nothing of the page around it can be typed into');
    await canvas.locator('[data-live] .b-text [data-edit-rich]').first().click();
    await page.keyboard.press('End');
    await page.keyboard.type(' Typed inside the page.');
    await saved();
    if (shots) await page.screenshot({ path: join(shots, 'editor-entry-in-page.png') });
    await page.getByRole('button', { name: 'Publish' }).click();
    await page.getByText('Published', { exact: true }).waitFor();
    await page.locator('[data-back]').click();
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
  const post = readFileSync(join(out, 'blog/a-table-for-twelve/index.html'), 'utf8');
  assert(post.includes('b-contact') && post.includes('<h1>A table for twelve</h1>'), 'the exported post is drawn in the page designed for posts');
  assert(!post.includes('post-meta') && !/data-frozen|data-live/.test(post), 'with only the parts the page asked for, and nothing of the editor');
  const typed = readdirSyncSafe(out).find((f) => readFileSync(join(out, f), 'utf8').includes('Typed inside the page.'));
  assert(typed, `what was typed into the post inside its page is in the export (${typed})`);
  rmSync(dir, { recursive: true, force: true });
  console.log("\nA type's own page works end to end.");
})().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});

function readdirSyncSafe(folder) {
  const { readdirSync, statSync } = require('node:fs');
  const out = [];
  const walk = (at) => {
    for (const name of readdirSync(join(folder, at))) {
      const rel = at ? `${at}/${name}` : name;
      if (statSync(join(folder, rel)).isDirectory()) walk(rel);
      else if (name.endsWith('.html')) out.push(rel);
    }
  };
  walk('');
  return out;
}
