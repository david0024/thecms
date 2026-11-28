/**
 * Dark mode in a real browser (ADR 0074): a site that follows the visitor's
 * device, the switch in the header and what it remembers, a browser without
 * scripts, and the owner's side: the preview, the three choices, a palette
 * made for them and the check of contrast. Checked by what the browser
 * painted and what the site stored, not by what the screen said.
 *
 *   node e2e/dark-mode.cjs [folder for screenshots]
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

// Plain's own background, and its dark one (themes/plain.json).
const LIGHT = 'rgb(255, 255, 255)';
const DARK = 'rgb(17, 19, 24)';

(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'uhlaka-e2e-'));
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
  const site = new URL('/', url).href;

  const browser = await coverage.launch(chromium, 'dark-mode');
  const errors = [];
  const visit = async (options = {}) => {
    // A page of its own context, opened through the browser so the coverage of the admin is counted;
    // a page without scripts cannot be followed, so it gets a plain context.
    const settings = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: shots ? 2 : 1, ...options };
    const page = options.javaScriptEnabled === false ? await (await browser.newContext(settings)).newPage() : await browser.newPage(settings);
    const context = page.context();
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    return { context, page };
  };
  const background = (page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  try {
    // A visitor whose computer is set to dark.
    {
      const { context, page } = await visit({ colorScheme: 'dark' });
      await page.goto(site);
      assert((await background(page)) === DARK, 'a new site follows the visitor: dark on a dark device, from the first paint');
      const button = page.locator('.scheme-switch');
      assert(await button.isVisible(), 'the switch is in the header');
      assert(await page.locator('.scheme-to-light').isVisible(), 'on a dark page it offers the light (a sun)');
      assert((await button.innerText()).trim() === 'Light colours', 'and says so to a screen reader');
      if (shots) await page.screenshot({ path: join(shots, 'site-dark.png') });
      await button.click();
      assert((await background(page)) === LIGHT, 'a click turns the page light at once');
      assert((await page.evaluate(() => localStorage.getItem('uhlaka-scheme'))) === 'light', 'the choice is kept in the visitor\'s own browser');
      await page.reload();
      assert((await background(page)) === LIGHT, 'and holds after a reload');
      await page.goto(new URL('/about/', site).href);
      assert((await background(page)) === LIGHT, 'and on the next page');
      assert((await page.evaluate(() => document.cookie)) === '', 'no cookie is set for it');
      await page.locator('.scheme-switch').click();
      assert((await background(page)) === DARK, 'turned back, the page follows the device again');
      assert((await page.evaluate(() => localStorage.getItem('uhlaka-scheme'))) === null, 'and the choice is forgotten');
      await context.close();
    }

    // A visitor on a light device, and one on a phone.
    {
      const { context, page } = await visit({ colorScheme: 'light' });
      await page.goto(site);
      assert((await background(page)) === LIGHT, 'light on a light device');
      assert(await page.locator('.scheme-to-dark').isVisible(), 'the switch offers the dark (a moon)');
      if (shots) await page.screenshot({ path: join(shots, 'site-light.png') });
      await context.close();
      const phone = await visit({ colorScheme: 'dark', viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });
      await phone.page.goto(site);
      const box = await phone.page.locator('.scheme-switch').boundingBox();
      const head = await phone.page.locator('.site-header').boundingBox();
      assert(box && head && box.y >= head.y && box.y + box.height <= head.y + head.height, 'on a phone the switch stays in the header\'s row, outside the folded menu');
      if (shots) await phone.page.screenshot({ path: join(shots, 'site-dark-phone.png') });
      await phone.context.close();
    }

    // Without scripts: no switch, and the device still decides.
    {
      const { context, page } = await visit({ colorScheme: 'dark', javaScriptEnabled: false });
      await page.goto(site);
      assert((await background(page)) === DARK, 'without scripts the colours still follow the device');
      assert(!(await page.locator('.scheme-switch').isVisible()), 'and the switch, which needs one, is not shown');
      await context.close();
    }

    // The owner.
    const { context, page } = await visit({ colorScheme: 'light', viewport: { width: 1440, height: 900 } });
    const canvas = page.frameLocator('iframe');
    await page.goto(url);
    await page.locator('[data-open=""]').first().click();
    await canvas.locator('h1').waitFor();
    await page.locator('[data-preview-scheme="dark"]').click();
    await page.waitForFunction(() => document.querySelector('iframe')?.contentDocument?.documentElement.dataset.scheme === 'dark');
    const canvasBackground = () => page.evaluate(() => getComputedStyle(document.querySelector('iframe').contentDocument.body).backgroundColor);
    assert((await canvasBackground()) === DARK, 'the editor shows the page dark on a light computer');
    await page.locator('[data-preview-scheme="light"]').click();
    await page.waitForFunction(() => document.querySelector('iframe')?.contentDocument?.documentElement.dataset.scheme === 'light');
    assert((await canvasBackground()) === LIGHT, 'and light again');

    await page.locator('[data-design-mode]').click();
    const section = page.locator('[data-theme-schemes]');
    await section.locator('summary').click();
    assert(await page.locator('[data-theme-shows="visitor"]').isChecked(), 'the theme builder says the site follows the visitor');
    assert(await section.locator('[data-contrast="ok"]').isVisible(), 'and that every text reads well, in both schemes');

    // A colour that cannot be read is named.
    const muted = section.locator('[data-other-token="muted"]');
    await muted.fill('#22252b');
    await section.locator('[data-contrast] li').first().waitFor();
    assert((await section.locator('[data-contrast] li').first().innerText()).startsWith('muted on background, Dark: 1.'), 'a dark colour too close to its background is named, with its contrast');
    await muted.fill('#a2a9b6');
    await section.locator('[data-contrast="ok"]').waitFor();
    // A value that is not a colour is not taken, and the field says so.
    await muted.fill('grey;}');
    assert(await section.locator('[data-other-token="muted"][aria-invalid="true"]').isVisible(), 'a dark colour that is not a colour is refused where it is typed');
    await muted.fill('#a2a9b6');

    // Dark only, then back to the visitor.
    await page.locator('[data-theme-shows="dark"]').check();
    await page.locator('[data-preview-scheme="dark"][aria-pressed="false"]').waitFor();
    await page.locator('[data-theme-shows="dark"]:checked').waitFor();
    assert(true, '"Dark only" can be chosen once the theme has dark colours');
    await page.locator('[data-theme-shows="visitor"]').check();

    // A colour of the owner's own gets a dark value too, and leaves both when it is removed.
    await page.locator('[data-new-token-name="color"]').fill('accent');
    await page.locator('[data-new-token-value="color"]').fill('#cc3300');
    await page.locator('[data-add-token="color"]').click();
    await section.locator('[data-other-token="accent"]').fill('#ff8866');
    assert((await section.locator('[data-other-token="accent"]').inputValue()) === '#ff8866', 'a colour of the owner\'s own has its dark value');
    await page.getByRole('button', { name: 'Remove accent' }).click();
    await section.locator('[data-other-token="accent"]').waitFor({ state: 'detached' });
    assert(true, 'removed, it leaves the dark colours too');

    // Without a second palette, only the theme's own scheme; then one made for the owner.
    await section.locator('[data-theme-remove-other]').click();
    await section.locator('[data-theme-propose]').waitFor();
    assert(await page.locator('[data-theme-shows="visitor"]').isDisabled(), 'a theme with only light colours cannot follow the visitor');
    assert(!(await page.locator('[data-preview-scheme="dark"]').count()), 'and has no dark to preview');
    await section.locator('[data-theme-propose]').click();
    await section.locator('[data-other-token="background"]').waitFor();
    assert((await section.locator('[data-other-token="background"]').inputValue()) !== '#ffffff', 'the dark colours are made from the light ones');
    assert(await section.locator('[data-contrast="ok"]').isVisible(), 'and read well');
    if (shots) {
      await page.locator('[data-preview-scheme="dark"]').click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(shots, 'builder-dark.png') });
    }

    // "Light only", published: no switch and no script, light on a dark device.
    // The builder sends the theme a moment after the change: publish only once the server has it.
    const stored = page.waitForResponse((r) => r.url().endsWith('/api/theme') && r.request().method() === 'PUT' && r.request().postData().includes('"name":"Plain"') && !r.request().postData().includes('"shows"'));
    await page.locator('[data-theme-shows="light"]').check();
    await stored;
    await page.locator('[data-publish-theme]').click();
    await page.locator('[data-publish-theme]').waitFor({ state: 'detached' });
    await context.close();
    const later = await visit({ colorScheme: 'dark' });
    // A publication reaches the site within a second or two: ask again until it has.
    for (let i = 0; i < 20; i++) {
      await later.page.goto(site);
      if ((await background(later.page)) === LIGHT) break;
      await later.page.waitForTimeout(500);
    }
    assert((await background(later.page)) === LIGHT, '"Light only": light on a dark device');
    assert((await later.page.locator('script[src]').count()) === 0 && (await later.page.locator('.scheme-switch').count()) === 0, 'with no switch and no script');
    await later.context.close();

    assert(errors.length === 0, `no errors in the console${errors.length ? `: ${errors.join('; ')}` : ''}`);
  } finally {
    await browser.close();
    server.kill();
    rmSync(dir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
