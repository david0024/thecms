/**
 * What the site writes for search engines by itself, in a real browser
 * (ADR 0057): the description shown in grey, a picture's words from its file
 * name, links search engines do not follow, the codes that prove the site is
 * the owner's, and lines for robots.txt that the check before publishing
 * names when they shut the site.
 *
 *   node e2e/seo-more.cjs [folder for screenshots]
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
const PORT = 4398;

(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'thecms-e2e-seo-more-'));
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

  const browser = await coverage.launch(chromium, 'seo-more');
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const canvas = page.frameLocator('iframe');
    const saved = () => page.locator('.status[data-state="saved"]').waitFor();
    const stored = async () => {
      await saved();
      return page.evaluate(async (t) => (await (await fetch('/api/page?slug=about', { headers: { 'x-thecms-token': t } })).json()).page.blocks, token);
    };
    await page.goto(url);

    // An empty description shows, in grey, the words the site will use.
    await page.locator('button[data-open="about"]').click();
    await canvas.locator('main').waitFor();
    const grey = await page.locator('[data-description]').getAttribute('placeholder');
    assert(grey.length > 20 && grey.length <= 160, `the description the site writes is shown in grey (${grey})`);

    // A link in the text that search engines do not follow.
    await page.locator('[data-add="text"]').click();
    const text = canvas.locator('.b-text .prose', { hasText: 'Write here.' });
    await text.locator('p').click();
    await page.keyboard.press('End');
    await page.keyboard.type(' Buy our oil at the shop');
    await page.keyboard.press('Shift+ControlOrMeta+ArrowLeft');
    await canvas.locator('.cms-format button[data-format="link"]').click();
    await canvas.locator('.cms-format input[type="text"]').fill('https://shop.example');
    await canvas.locator('.cms-format [data-link-nofollow]').check();
    await canvas.locator('.cms-format input[type="text"]').press('Enter');
    await text.locator('a[rel="nofollow"]').waitFor();
    const spans = (await stored()).filter((b) => b.type === 'text').pop().content.body[0].children;
    assert(spans.some((s) => s.href === 'https://shop.example' && s.nofollow === true), 'the link keeps that search engines do not follow it');
    await text.locator('a').click();
    await canvas.locator('.cms-format button[data-format="link"]').click();
    assert(await canvas.locator('.cms-format [data-link-nofollow]').isChecked(), 'opened again, the link shows its box ticked');
    await page.keyboard.press('Escape');

    // A button that search engines do not follow.
    await page.locator('[data-add="buttons"]').click();
    await canvas.locator('.b-buttons .button').first().waitFor();
    await page.getByLabel('Where it goes (for example /contact/)').first().fill('https://partner.example');
    await page.locator('[data-link-nofollow]').first().check();
    const buttons = (await stored()).find((b) => b.type === 'buttons').content.items[0].action;
    assert(buttons.nofollow === true && buttons.href === 'https://partner.example', 'a button keeps it too');

    // A picture's words come from its file's name.
    await page.locator('[data-add="image"]').click();
    await canvas.locator('.cms-empty[data-empty="image"]').waitFor();
    const photo = join(dir, 'oak-table_2.png');
    writeFileSync(
      photo,
      Buffer.from(await page.evaluate(() => {
        const c = document.createElement('canvas');
        c.width = 40;
        c.height = 30;
        c.getContext('2d').fillRect(0, 0, 40, 30);
        return c.toDataURL('image/png').split(',')[1];
      }), 'base64'),
    );
    await page.locator('[data-media-file]').setInputFiles(photo);
    await canvas.locator('.b-image img').waitFor({ state: 'attached' });
    await page.waitForFunction(() => document.querySelector('[data-image-alt]')?.value === 'Oak table');
    assert(true, 'an uploaded picture is offered the words of its file name');
    await saved();
    if (shots) await page.screenshot({ path: join(shots, 'seo-more-editor.png') });
    await page.getByRole('button', { name: 'Publish' }).click();
    await page.getByText('Published', { exact: true }).waitFor();
    const about = await (await page.request.get(site('/about/'))).text();
    assert(about.includes('<a href="https://shop.example" rel="nofollow">'), 'published, the text link says rel="nofollow"');
    assert(/<a class="button" href="https:\/\/partner.example" rel="nofollow">/.test(about), 'and so does the button');
    assert(about.includes('alt="Oak table"'), 'and the picture has its words');

    // The codes that prove the site is the owner's, and a line for robots.txt.
    await page.locator('[data-back]').click();
    await page.locator('[data-nav="settings"]').click();
    const google = page.locator('[data-site-verify-google]');
    await google.fill('<meta name="google-site-verification" content="abc123XYZ" />');
    await google.press('Tab');
    await page.waitForFunction(() => document.querySelector('[data-site-verify-google]')?.value === 'abc123XYZ');
    assert(true, 'the code is taken from the whole tag Google gives');
    await page.locator('[data-site-verify-bing]').fill('BING42');
    await page.locator('[data-site-verify-bing]').press('Tab');
    await page.locator('[data-site-robots]').fill('Disallow: /\nnot a rule');
    await page.locator('[data-site-robots]').press('Tab');
    await page.waitForFunction(() => document.querySelector('[data-site-robots]')?.value === 'Disallow: /');
    assert(true, 'only rules of robots.txt are kept');
    if (shots) await page.screenshot({ path: join(shots, 'seo-more-settings.png') });
    let home = '';
    for (let i = 0; i < 20 && !home.includes('msvalidate.01'); i++) {
      if (home) await page.waitForTimeout(250);
      home = await (await page.request.get(site('/'))).text();
    }
    assert(home.includes('<meta name="google-site-verification" content="abc123XYZ">') && home.includes('<meta name="msvalidate.01" content="BING42">'), 'the home page carries both codes');
    const robots = await (await page.request.get(site('/robots.txt'))).text();
    assert(robots.includes('Disallow: /\n'), `robots.txt has the owner's line (${JSON.stringify(robots)})`);
    await page.locator('[data-back]').click().catch(() => {});
    await page.locator('[data-check-run]').click();
    await page.locator('[data-check-seo] [data-seo-problem="blocked"]').waitFor();
    assert(true, 'the check says the lines shut the whole site to search engines');
    if (shots) await page.screenshot({ path: join(shots, 'seo-more-check.png') });
    assert(errors.length === 0, `no errors in the browser ${errors.join(' | ')}`);
  } catch (error) {
    if (shots) await browser.contexts()[0]?.pages()[0]?.screenshot({ path: join(shots, 'failure.png') }).catch(() => {});
    throw error;
  } finally {
    await browser.close();
    server.kill();
  }
  rmSync(dir, { recursive: true, force: true });
  console.log('\nWhat the site writes for search engines works.');
})().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
