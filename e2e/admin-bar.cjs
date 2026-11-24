/**
 * The admin bar over the site, in a real browser (ADR 0075): the owner sees
 * it on the site's pages, and from it edits the page or starts a new one; a
 * visitor sees the page without it. Screenshots of a computer and a phone, in
 * light and dark.
 *
 *   node e2e/admin-bar.cjs [folder for screenshots]
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
const PUBLIC = `http://127.0.0.1:${PORT}`;
const PASSWORD = 'a long enough password';

(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'uhlaka-e2e-admin-bar-'));
  const db = join(dir, 'site.db');
  const shots = process.argv[2];
  cli('init', db);

  const server = spawn('bun', ['src/site/cli.ts', 'serve', db, `--public=${PUBLIC}`, `--port=${PORT}`], { cwd: root });
  const setup = await new Promise((resolve, reject) => {
    let out = '';
    server.stdout.on('data', (chunk) => {
      out += chunk;
      const found = out.match(/http:\/\/127\.0\.0\.1:\d+\/admin\/#link=[\w-]+/);
      if (found) resolve(found[0]);
    });
    server.stderr.on('data', (chunk) => process.stderr.write(chunk));
    server.on('exit', () => reject(new Error('the editor stopped')));
  });

  const browser = await coverage.launch(chromium, 'admin-bar');
  try {
    const errors = [];
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const owner = await context.newPage();
    owner.on('pageerror', (e) => errors.push(String(e)));

    // The owner, from the link the server printed.
    await owner.goto(setup);
    const form = owner.locator('[data-link="setup"]');
    await form.waitFor();
    await form.locator('[data-site-name]').fill('Atelierul Anei');
    await form.locator('[data-name]').fill('Ana');
    await form.locator('[data-email]').fill('ana@example.com');
    await form.locator('[data-password]').fill(PASSWORD);
    await form.getByRole('button').click();
    await owner.locator('[data-nav="people"]').waitFor();

    // On the site, the bar is the first thing on the page, at its very top.
    await owner.goto(`${PUBLIC}/about/`);
    const bar = owner.locator('#uhlaka-bar');
    await bar.waitFor();
    const box = await bar.boundingBox();
    assert(box && box.y === 0 && box.width >= 1270, 'the bar runs across the top of the page');
    assert((await bar.getByText('Ana').count()) === 1, 'it names who is signed in');
    assert((await owner.locator('script:not([src="/assets/scheme.js"])').count()) === 0, 'it brings no script');
    const colour = await bar.evaluate((el) => getComputedStyle(el).backgroundColor);
    assert(colour === 'rgb(21, 26, 51)', 'it keeps its own colours, whatever the theme');
    if (shots) await owner.screenshot({ path: join(shots, 'admin-bar.png') });

    // Edit page: the builder, on this page.
    await bar.locator('[data-bar="edit"]').click();
    await owner.locator('.doc', { hasText: 'About' }).waitFor();
    assert(owner.url().includes('at=edit/page/about'), '"Edit page" opens this page in the builder');

    // New page: the list of pages, with the title of the new one asked at once.
    await owner.goto(`${PUBLIC}/`);
    await owner.locator('#uhlaka-bar [data-bar="add"]').click();
    const title = owner.locator('[data-list="page"] header input[type="text"]');
    await title.waitFor();
    assert(await title.evaluate((el) => el === document.activeElement), '"New page" opens the pages with the title asked');
    await owner.waitForFunction(() => location.hash.includes('at=pages'));
    assert(true, 'and leaves an address that does not ask again');

    // A phone, and dark colours: the bar stays the same, and fits.
    const phone = await browser.newContext({ viewport: { width: 375, height: 740 }, colorScheme: 'dark', storageState: await context.storageState() });
    const small = await phone.newPage();
    small.on('pageerror', (e) => errors.push(String(e)));
    await small.goto(`${PUBLIC}/about/`);
    await small.locator('#uhlaka-bar').waitFor();
    assert(await small.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'on a phone the page does not scroll sideways');
    if (shots) await small.screenshot({ path: join(shots, 'admin-bar-phone-dark.png') });
    await phone.close();

    // Turned off in "Me", the site is seen as a visitor sees it; turned on again, the bar is back.
    await owner.goto(`${PUBLIC}/admin/#at=me`);
    await owner.locator('[data-profile-bar]').uncheck();
    await owner.locator('[data-profile] button[type="submit"]').click();
    await owner.locator('[data-profile-saved]').waitFor();
    await owner.goto(`${PUBLIC}/about/`);
    await owner.locator('main').waitFor();
    assert((await owner.locator('#uhlaka-bar').count()) === 0, 'turned off in "Me", the bar is gone');
    await owner.goto(`${PUBLIC}/admin/#at=me`);
    await owner.locator('[data-profile-bar]').check();
    await owner.locator('[data-profile] button[type="submit"]').click();
    await owner.locator('[data-profile-saved]').waitFor();

    // A change not published is said beside "Edit page".
    await owner.goto(`${PUBLIC}/admin/#at=edit/page/about`);
    await owner.locator('.doc', { hasText: 'About' }).waitFor();
    // The page's title, changed in the panel and saved, not published.
    await owner.getByLabel('Title', { exact: true }).fill('About us');
    await owner.locator('.status:not([data-state="saved"])').first().waitFor({ timeout: 5000 }).catch(() => {});
    await owner.locator('.status[data-state="saved"]').waitFor();
    await owner.goto(`${PUBLIC}/about/`);
    await bar.waitFor();
    assert((await owner.locator('#uhlaka-bar [data-bar-changed]').count()) === 1, 'a change not published is said in the bar');
    if (shots) await owner.screenshot({ path: join(shots, 'admin-bar-changed.png') });

    // Sign out: the same page, as a visitor, and the admin asks to sign in again.
    await owner.locator('#uhlaka-bar [data-bar="sign-out"] button').click();
    await owner.waitForURL(`${PUBLIC}/about/`);
    await owner.locator('main').waitFor();
    assert((await owner.locator('#uhlaka-bar').count()) === 0, '"Sign out" leaves the person on the page, as a visitor');
    await owner.goto(`${PUBLIC}/admin/`);
    await owner.locator('[data-sign-in]').waitFor();
    assert(true, 'and the admin asks to sign in again');

    // A visitor sees the same page without it.
    const visitor = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await visitor.goto(`${PUBLIC}/about/`);
    await visitor.locator('main').waitFor();
    assert((await visitor.locator('#uhlaka-bar').count()) === 0, 'a visitor has no bar');
    if (shots) await visitor.screenshot({ path: join(shots, 'admin-bar-visitor.png') });

    assert(errors.length === 0, `no errors in the browser ${errors.join(' | ')}`);
  } catch (error) {
    if (shots) await browser.contexts()[0]?.pages()[0]?.screenshot({ path: join(shots, 'failure.png') }).catch(() => {});
    throw error;
  } finally {
    await browser.close();
    server.kill();
  }
  rmSync(dir, { recursive: true, force: true });
  console.log('\nThe admin bar works.');
})().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
