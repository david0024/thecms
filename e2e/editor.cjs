/**
 * The editor, driven in a real browser from the first click to the exported
 * file: add a block, type on the page, style it with a token and with a free
 * value, change the theme, build on it in the theme builder, format text,
 * upload an image, drag blocks, publish, export. Each step is checked by what it
 * left behind (the stored document, the exported HTML), not by what the
 * screen said.
 *
 *   node e2e/editor.cjs [folder for screenshots]
 */
const { chromium } = require('playwright');
const { spawn, execFileSync } = require('node:child_process');
const { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const root = join(__dirname, '..');
const cli = (...args) => execFileSync('bun', ['src/site/cli.ts', ...args], { cwd: root, encoding: 'utf8' });
const assert = (condition, message) => {
  if (!condition) throw new Error(`FAILED: ${message}`);
  console.log(`ok  ${message}`);
};

(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'thecms-e2e-'));
  const db = join(dir, 'site.db');
  const shots = process.argv[2];
  cli('init', db);

  const server = spawn('bun', ['src/site/cli.ts', 'edit', db, '4398'], { cwd: root });
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

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: shots ? 2 : 1 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.goto(url);
    const canvas = page.frameLocator('iframe');
    // The admin opens on the list of pages; choosing one opens the builder.
    await page.locator('[data-list="page"] [data-open=""]').waitFor();
    assert((await page.locator('[data-list="page"] tbody tr').count()) >= 2, 'the admin opens on the list of pages');
    assert(!(await page.locator('iframe').isVisible()), 'the builder is not shown until a page is chosen');
    await page.locator('[data-open=""]').click();
    await canvas.locator('h1').waitFor();
    assert((await canvas.locator('h1').innerText()).includes('Solid wood'), 'the canvas shows the real home page');
    const saved = () => page.locator('.status[data-state="saved"]').waitFor();

    // Type directly on the page.
    await canvas.locator('h1').click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('Furniture that lasts <b>longer</b>');
    await saved();
    if (shots) await page.screenshot({ path: join(shots, 'editor-typing.png') });

    // Add a block after the selected one and write in it.
    await page.locator('[data-add="text"]').click();
    const prose = canvas.locator('.b-text .prose');
    await prose.waitFor();
    await prose.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('Every piece is drawn first.');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Then it is built.');
    await saved();
    assert((await canvas.locator('section.b').nth(1).getAttribute('class')).includes('b-text'), 'the new block sits right after the selected one');

    // Move it down, then style it: one token, one free value, one refused value.
    await canvas.locator('.cms-bar button[data-action="down"]').click();
    await canvas.locator('section.b').nth(2).locator('.prose').waitFor();
    await page.getByRole('tab', { name: 'Style' }).click();
    await page.locator('select[data-style="background"]').selectOption('token:surface');
    await page.locator('select[data-style="paddingBlock"]').selectOption('$custom');
    await page.locator('input[data-custom="paddingBlock"]').fill('7rem');
    await page.locator('select[data-style="color"]').selectOption('$custom');
    await page.locator('input[data-custom="color"]').fill('red;}body{display:none');
    assert(await page.getByText('Not a valid value').isVisible(), 'a value that is not a colour is refused where it is typed');
    await saved();
    await page.waitForTimeout(400);
    if (shots) await page.screenshot({ path: join(shots, 'editor-plain.png') });

    // Change the theme; the page is drawn again with the same content.
    await page.locator('select[data-theme]').selectOption('Studio');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('iframe').contentDocument.body).backgroundColor === 'rgb(18, 17, 15)');
    assert(true, 'changing the theme repaints the canvas');
    const padding = await canvas.locator('section.b-text').evaluate((el) => getComputedStyle(el).paddingTop);
    assert(padding === '112px', `the free value stayed through the theme change (${padding})`);
    const background = await canvas.locator('section.b-text').evaluate((el) => getComputedStyle(el).backgroundColor);
    assert(background === 'rgb(29, 27, 24)', `the token followed the new theme (${background})`);
    if (shots) await page.screenshot({ path: join(shots, 'editor-studio.png') });

    // The theme builder: change a colour and see it on the page at once.
    await page.locator('[data-theme-mode]').click();
    const primary = page.locator('input[data-token="color.primary"]');
    await primary.fill('#ff0066');
    const buttonColour = () => canvas.locator('a.button').first().evaluate((el) => getComputedStyle(el).backgroundColor);
    await page.waitForFunction(() => getComputedStyle(document.querySelector('iframe').contentDocument.querySelector('a.button')).backgroundColor === 'rgb(255, 0, 102)');
    assert(true, 'a colour changed in the theme builder repaints the page');
    if (shots) await page.screenshot({ path: join(shots, 'theme-colours.png') });
    await primary.fill('red;}body{display:none');
    await page.waitForTimeout(600);
    assert((await buttonColour()) === 'rgb(255, 0, 102)', 'a theme value that is not a colour is not applied; the theme keeps what it had');
    await primary.fill('#ff0066');

    // A token of the author's own, used as a block type's default.
    await page.locator('[data-new-token-name="color"]').fill('brand');
    await page.locator('[data-new-token-value="color"]').fill('#00aa88');
    await page.locator('[data-add-token="color"]').click();
    await page.getByText('Blocks', { exact: true }).click();
    await page.locator('select[data-theme-block]').selectOption('services');
    await page.locator('[data-theme-style="default"] select[data-style="background"]').selectOption('token:brand');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('iframe').contentDocument.querySelector('.b-services')).backgroundColor === 'rgb(0, 170, 136)');
    assert(true, 'a new token can style every block of a type');
    await page.getByRole('button', { name: 'Remove brand' }).click();
    await page.getByRole('alert').waitFor();
    assert(await page.locator('input[data-token="color.brand"]').isVisible(), 'a token still in use cannot be removed, and the builder says why');
    await page.locator('[data-new-variant]').fill('quiet');
    await page.getByRole('button', { name: 'Add variant' }).click();
    await page.locator('[data-theme-style="quiet"]').waitFor();

    // The header and footer are laid out by the theme: the same markup, another stylesheet.
    const headerHtml = () => canvas.locator('.site-header').evaluate((el) => el.innerHTML);
    const before = await headerHtml();
    await page.getByText('Header and footer', { exact: true }).click();
    await page.locator('select[data-layout="header"]').selectOption('centered');
    await page.locator('[data-layout-style="header"] select[data-style="background"]').selectOption('token:brand');
    await page.waitForFunction(() => {
      const header = document.querySelector('iframe').contentDocument.querySelector('.site-header');
      return getComputedStyle(header.querySelector('.site-in')).flexDirection === 'column' && getComputedStyle(header).backgroundColor === 'rgb(0, 170, 136)';
    });
    assert((await headerHtml()) === before, 'the theme rearranges and recolours the header without changing its markup');
    if (shots) await page.screenshot({ path: join(shots, 'theme-header.png') });

    // A theme is a file: download it, and refuse a file that is not a theme.
    await page.getByText('Save or load a theme file').click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download this theme' }).click()]);
    const themeFile = join(dir, 'downloaded.theme.json');
    await download.saveAs(themeFile);
    const downloaded = JSON.parse(readFileSync(themeFile, 'utf8'));
    assert(downloaded.tokens.color.brand === '#00aa88' && downloaded.blocks.services.variants.quiet && downloaded.layout.header.arrangement === 'centered', 'the downloaded theme file holds what was built');
    const bad = join(dir, 'bad.theme.json');
    writeFileSync(bad, JSON.stringify({ ...downloaded, tokens: { ...downloaded.tokens, color: { ...downloaded.tokens.color, primary: 'url(https://evil.example)' } } }));
    await page.locator('[data-theme-file]').setInputFiles(bad);
    await page.getByText('This file is not a valid theme.').waitFor();
    assert((await buttonColour()) === 'rgb(255, 0, 102)', 'a theme file with a bad value is refused whole');
    if (shots) await page.screenshot({ path: join(shots, 'theme-builder.png') });

    // Nothing of this has reached visitors yet: the theme has a draft too.
    await page.waitForTimeout(500);
    const early = join(dir, 'early');
    cli('export', db, early);
    assert(readFileSync(join(early, 'assets/site.css'), 'utf8').includes('--t-color-primary:#2563eb'), 'until the theme is published, the export keeps the published theme');
    await page.locator('[data-publish-theme]').click();
    await page.locator('[data-publish-theme]').waitFor({ state: 'detached' });
    await page.locator('[data-theme-mode]').click();

    // Undo brings the padding back off, redo puts it on again.
    await page.locator('aside.left h2').first().click();
    await page.keyboard.press('ControlOrMeta+z');
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await saved();

    // A new page.
    await page.locator('[data-back]').click();
    await page.getByRole('button', { name: '+ New page' }).click();
    await page.getByPlaceholder('Page title').fill('Prețuri și comenzi');
    await page.getByRole('button', { name: 'Create' }).click();
    await canvas.locator('.cms-empty').waitFor();
    await page.locator('[data-add="hero"]').click();
    await canvas.locator('h1').waitFor();
    await saved();

    // What the server holds for this page: the document, not the screen.
    const token = url.split('#token=')[1];
    const stored = async () => {
      await saved();
      return page.evaluate(async (t) => (await (await fetch('/api/page?slug=preturi-si-comenzi', { headers: { 'x-thecms-token': t } })).json()).page.blocks, token);
    };
    const format = (name) => canvas.locator(`.cms-format button[data-format="${name}"]`).click();

    // Format text with the bar: a heading, a list, bold, a link, and a link that is refused.
    await page.locator('[data-add="text"]').click();
    const text = canvas.locator('.b-text .prose');
    await text.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('Our prices');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Oak table');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Walnut shelf');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Ask us for an offer');
    await text.locator('p').first().click();
    await format('h2');
    await text.locator('h2').waitFor();
    await text.locator('p').first().click();
    await page.keyboard.press('Home');
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Shift+End');
    await format('ul');
    await text.locator('ul li').nth(1).waitFor();
    await text.locator('p').last().click();
    await page.keyboard.press('End');
    await page.keyboard.press('Shift+ControlOrMeta+ArrowLeft');
    await format('link');
    await canvas.locator('.cms-format input').fill('/contact/');
    await page.keyboard.press('Enter');
    await text.locator('a[href="/contact/"]').waitFor();
    await page.keyboard.press('Home');
    await page.keyboard.press('Shift+ControlOrMeta+ArrowRight');
    await format('bold');
    await format('link');
    await canvas.locator('.cms-format input').fill('javascript:alert(1)');
    await page.keyboard.press('Enter');
    const body = (await stored()).find((b) => b.type === 'text').content.body;
    assert(body[0].type === 'heading' && body[0].level === 2 && body[0].children[0].text === 'Our prices', 'the bar turns a line into a heading');
    assert(body[1].type === 'list' && body[1].items.length === 2 && body[1].items[1][0].text === 'Walnut shelf', 'two selected lines become a list of two');
    const last = body[2].children;
    assert(last.some((s) => s.href === '/contact/' && s.text.trim() === 'offer'), 'the selected word carries the link');
    assert(last[0].marks?.includes('bold') && last[0].text.trim() === 'Ask' && !last[0].href, 'bold is kept, and a javascript: link is not');
    assert((await text.locator('a').count()) === 1, 'the page shows the document: the refused link is not drawn either');
    if (shots) await page.screenshot({ path: join(shots, 'editor-format.png') });

    // Upload an image. A photo is made lighter on the way; a file that is not an image is refused.
    await page.locator('[data-add="image"]').click();
    await canvas.locator('.cms-empty[data-empty="image"]').waitFor();
    const photo = join(dir, 'photo.jpg');
    const jpeg = await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 3000;
      c.height = 300;
      const g = c.getContext('2d');
      g.fillStyle = '#c96';
      g.fillRect(0, 0, 3000, 300);
      return c.toDataURL('image/jpeg').split(',')[1];
    });
    writeFileSync(photo, Buffer.from(jpeg, 'base64'));
    await page.locator('[data-media-file]').setInputFiles(photo);
    const img = canvas.locator('.b-image img');
    await img.waitFor({ state: 'attached' });
    await img.evaluate((el) => el.scrollIntoView());
    await page.locator('[data-image-alt]').fill('A plank of oak');
    const image = (await stored()).find((b) => b.type === 'image').content.image;
    assert(/^\/media\/[a-f0-9]{32}\.webp$/.test(image.src) && image.alt === 'A plank of oak', `the photo is stored with the site, as WebP (${image.src})`);
    await page.waitForFunction(() => document.querySelector('iframe').contentDocument.querySelector('.b-image img')?.naturalWidth === 2400);
    assert(true, 'a photo wider than a page needs is made 2400 pixels wide before it is uploaded');
    const fake = join(dir, 'fake.png');
    writeFileSync(fake, '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>');
    await page.locator('[data-media-file]').setInputFiles(fake);
    await page.locator('[data-image-field] [role="alert"]').waitFor();
    assert((await stored()).find((b) => b.type === 'image').content.image.src === image.src, 'a file that only claims to be an image is refused, and the picture stays');
    await page.locator('[data-media-library]').click();
    await page.locator(`[data-media="${image.src.slice(7)}"]`).waitFor();
    await page.getByRole('button', { name: /^Delete this image/ }).click();
    await page.getByText('this image is used on: Prețuri și comenzi').waitFor();
    assert(true, 'an image a page shows cannot be deleted, and the editor names the page');
    // Those two refusals are the only failed requests so far; the browser logs each one.
    assert(errors.length === 2 && errors.every((e) => e.includes('400')), `nothing else has failed up to here ${errors.join(' | ')}`);
    errors.length = 0;
    if (shots) await page.screenshot({ path: join(shots, 'editor-image.png') });

    // Drag: a new block from the list onto the page, a block into a group, and out again.
    const order = async () => (await stored()).map((b) => (b.children ? `${b.type}(${b.children.map((c) => c.type).join(',')})` : b.type)).join(' ');
    await page.locator('[data-add="group"]').click();
    await canvas.locator('.b-group .cms-empty').waitFor();
    assert((await order()) === 'hero text image group()', `before dragging: ${await order()}`);
    await page.locator('[data-add="contact"]').dragTo(canvas.locator('.b-hero'), { targetPosition: { x: 200, y: 8 } });
    await canvas.locator('.b-contact').waitFor();
    assert((await order()) === 'contact hero text image group()', `a block dragged from the list lands where it is dropped: ${await order()}`);
    await canvas.locator('.b-image img').click();
    await canvas.locator('.b-image .cms-grip').dragTo(canvas.locator('.b-group .cms-empty'));
    await canvas.locator('.b-group .b-image').waitFor();
    assert((await order()) === 'contact hero text group(image)', `a block dragged onto a group goes inside it: ${await order()}`);
    if (shots) await page.screenshot({ path: join(shots, 'editor-drag.png') });
    await canvas.locator('.b-text .prose').click();
    await canvas.locator('.b-text .cms-grip').dragTo(canvas.locator('.b-group .b-image'), { targetPosition: { x: 200, y: 6 } });
    await canvas.locator('.b-group .b-text').waitFor();
    assert((await order()) === 'contact hero group(text,image)', `and to a place among the blocks already there: ${await order()}`);
    await canvas.locator('.b-group .b-image img').click();
    await canvas.locator('.b-image .cms-grip').dragTo(canvas.locator('.b-group'), { targetPosition: { x: 200, y: 5 } });
    await page.waitForFunction(() => !document.querySelector('iframe').contentDocument.querySelector('.b-group .b-image'));
    assert((await order()) === 'contact hero image group(text)', `a block dragged to the edge of a group lands beside it, outside: ${await order()}`);
    await page.locator('aside.left h2').first().click();
    await page.keyboard.press('ControlOrMeta+z');
    assert((await order()) === 'contact hero group(text,image)', 'one undo takes one drag back');

    // What the header and footer say is the site's: click the footer, change it, give the site a logo.
    await canvas.locator('.site-footer').click();
    await page.locator('[data-site-footer]').fill('© Atelier Nord, since 2014');
    await page.locator('aside.right input[type="url"]').first().fill('https://example.com/');
    await page.keyboard.press('Tab');
    await page.locator('[data-site-footer-links]').getByRole('button', { name: 'Add' }).click();
    const added = page.locator('[data-site-footer-links] .item').last();
    await added.locator('input').first().fill('Prices');
    await added.locator('input').last().fill('/preturi-si-comenzi/');
    await canvas.locator('.site-footer nav a', { hasText: 'Prices' }).waitFor();
    assert((await canvas.locator('.site-footer p').innerText()) === '© Atelier Nord, since 2014', 'the footer shows what was typed in the site settings');
    const mark = join(dir, 'logo.png');
    const png = await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 200;
      c.height = 50;
      const g = c.getContext('2d');
      g.fillStyle = '#f2b84b';
      g.fillRect(0, 0, 200, 50);
      return c.toDataURL('image/png').split(',')[1];
    });
    writeFileSync(mark, Buffer.from(png, 'base64'));
    await page.locator('[data-media-file]').setInputFiles(mark);
    await canvas.locator('.site-header img.site-logo').waitFor();
    assert((await canvas.locator('.site-logo').getAttribute('alt')) === 'Atelier Nord', 'the logo takes the place of the name, and is read out as the name');
    if (shots) await page.screenshot({ path: join(shots, 'site-settings.png') });

    // The menu builder: take the menu over, add an item that opens a wide panel of two columns, move it up.
    await page.locator('[data-menu-customise]').click();
    const top = page.locator('[data-menu-level="1"] > li');
    const made = await top.count();
    assert(made >= 4, `taking the menu over starts from the one the site had (${made} items)`);
    await page.locator('[data-menu-add="1"]').click();
    const workshop = top.nth(made);
    await workshop.locator('[data-menu-label]').first().fill('Workshop');
    await workshop.locator('[data-menu-sub]').click();
    const first = workshop.locator('[data-menu-level="2"] > li').first();
    await first.locator('[data-menu-label]').first().fill('Tables');
    await first.locator('[data-menu-target]').first().selectOption('page:about');
    await first.locator('[data-menu-sub]').click();
    const oak = first.locator('[data-menu-level="3"] > li').first();
    await oak.locator('[data-menu-label]').fill('Oak');
    await oak.locator('[data-menu-target]').selectOption('url');
    await oak.locator('[data-menu-href]').fill('/contact/#oak');
    await workshop.locator('[data-menu-add="2"]').click();
    const second = workshop.locator('[data-menu-level="2"] > li').nth(1);
    await second.locator('[data-menu-target]').first().selectOption('page:contact');
    await workshop.getByRole('button', { name: 'Move up' }).first().click();
    const wide = canvas.locator('.menu > li.mega');
    await wide.locator('summary', { hasText: 'Workshop' }).waitFor();
    assert((await canvas.locator('.menu > li').nth(made - 1).getAttribute('class')) === 'mega', 'the new item sits where it was moved to');
    await wide.locator('summary').click();
    await wide.locator('.col a', { hasText: 'Oak' }).waitFor();
    const columns = await wide.locator('.col-title').allInnerTexts();
    assert(columns.join('|') === 'Tables|Contact', `sub-items with links of their own become columns; one without a label takes its page's title (${columns.join('|')})`);
    if (shots) await page.screenshot({ path: join(shots, 'menu-builder.png') });
    await page.locator('[data-site-mode]').click();
    await page.getByRole('button', { name: 'Publish' }).click();
    await page.getByText('Published', { exact: true }).waitFor();

    // A blog post: the same editor, with a date, categories and a summary.
    await page.locator('[data-back]').click();
    await page.locator('[data-nav="posts"]').click();
    assert((await page.locator('[data-list="post"] tbody tr').count()) === 2, 'the posts have a section of their own');
    await page.locator('[data-new="post"]').click();
    await page.getByPlaceholder('Page title').fill('Winter opening hours');
    await page.getByRole('button', { name: 'Create' }).click();
    await canvas.locator('article.post h1').waitFor();
    assert((await canvas.locator('article.post h1').innerText()) === 'Winter opening hours', 'a new post opens in the same editor, drawn as a post');
    assert((await canvas.locator('.site-header nav a', { hasText: 'Blog' }).count()) === 1, 'the blog is in the menu');
    await page.locator('[data-add="text"]').click();
    await canvas.locator('article.post .prose').click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('From December we are open on Saturdays too.');
    await page.locator('aside.left h2').first().click();
    await canvas.locator('article.post h1').click();
    await page.locator('[data-post-date]').fill('2026-12-01');
    await page.locator('[data-post-categories]').fill('News, Workshop');
    await page.keyboard.press('Tab');
    await page.locator('[data-post-excerpt]').fill('Saturdays too, from December.');
    await canvas.locator('.post-meta a', { hasText: 'Workshop' }).waitFor();
    await saved();
    if (shots) await page.screenshot({ path: join(shots, 'editor-post.png') });
    await page.getByRole('button', { name: 'Publish' }).click();
    await page.getByText('Published', { exact: true }).waitFor();

    // Back to the home page and publish it too.
    await page.locator('[data-back]').click();
    assert((await page.locator('[data-list="post"] tr', { hasText: 'Winter opening hours' }).innerText()).includes('Published'), 'leaving the builder goes back to the list the post came from');
    // A content type of the owner's own: made from a name, with a field, and edited like a post.
    await page.locator('[data-nav="types"]').click();
    await page.locator('[data-new-type]').click();
    await page.locator('[data-type-name]').fill('Projects');
    await page.locator('[data-type-singular]').fill('Project');
    await page.locator('[data-type-add-field]').click();
    await page.locator('[data-type-field] input').fill('Client');
    await page.locator('[data-type-save]').click();
    await page.locator('[data-type="projects"]').waitFor();
    assert((await page.locator('[data-type="projects"]').innerText()).includes('/projects/'), 'a content type is made from a name and gets an address');
    await page.locator('[data-new-type]').click();
    await page.locator('[data-type-name]').fill('About');
    await page.locator('[data-type-save]').click();
    assert((await page.locator('[data-list="types"] [role="alert"]').innerText()).includes('a page already lives at'), 'a type may not take the address of a page');
    assert(errors.length === 1, `the refusal is the only error in the console (${errors.join(' | ')})`);
    errors.length = 0;
    await page.getByRole('button', { name: 'Cancel' }).click();
    if (shots) await page.screenshot({ path: join(shots, 'admin-types.png') });
    await page.locator('[data-nav="projects"]').click();
    await page.locator('[data-new="projects"]').click();
    await page.getByPlaceholder('Page title').fill('A kitchen in oak');
    await page.getByRole('button', { name: 'Create' }).click();
    await canvas.locator('article.post h1').waitFor();
    assert((await canvas.locator('.post-meta').count()) === 0, 'an entry of a type without dates shows none');
    await page.locator('[data-entry-field="client"] input').fill('The Popescu family');
    await page.keyboard.press('Tab');
    await canvas.locator('.entry-field[data-field="client"] dd', { hasText: 'The Popescu family' }).waitFor();
    await saved();
    if (shots) await page.screenshot({ path: join(shots, 'editor-entry.png') });
    await page.getByRole('button', { name: 'Publish' }).click();
    await page.getByText('Published', { exact: true }).waitFor();
    await page.locator('[data-back]').click();
    assert((await page.locator('[data-list="projects"] tr', { hasText: 'A kitchen in oak' }).innerText()).includes('/projects/a-kitchen-in-oak/'), 'the type has a section of its own, listing its entries');
    await page.locator('[data-nav="media"]').click();
    await page.locator('[data-list="media"] [data-media-item]').first().waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll('[data-list="media"] img')].every((img) => img.naturalWidth > 0));
    assert((await page.locator('[data-list="media"] [data-media-item]').count()) === 2, 'the media section shows every image the site holds');
    await page.locator('[data-list="media"] [data-media-item]', { hasText: 'logo.png' }).getByRole('button').click();
    assert((await page.locator('[data-list="media"] [role="alert"]').innerText()).includes('used on'), 'an image still in use is not deleted from there either');
    assert(errors.length === 1, `the refusal is the only error in the console (${errors.join(' | ')})`);
    errors.length = 0;
    if (shots) await page.screenshot({ path: join(shots, 'admin-media.png') });
    await page.locator('[data-nav="pages"]').click();
    assert((await page.locator('[data-list="page"] tr', { hasText: 'Prețuri și comenzi' }).innerText()).includes('/preturi-si-comenzi/'), 'a list shows each page with its address and state');
    if (shots) await page.screenshot({ path: join(shots, 'admin-pages.png') });
    await page.locator('[data-open=""]').click();
    await canvas.locator('.b-text').waitFor();
    await page.getByRole('button', { name: 'Publish' }).click();
    await page.getByText('Published', { exact: true }).waitFor();
    assert(errors.length === 0, `no errors in the browser console ${errors.join(' | ')}`);
  } catch (error) {
    // What the screen showed when a step failed, for whoever reads the log.
    if (shots) await browser.contexts()[0]?.pages()[0]?.screenshot({ path: join(shots, 'failure.png') }).catch(() => {});
    throw error;
  } finally {
    await browser.close();
    server.kill();
  }

  // What matters: the files a visitor would get.
  const out = join(dir, 'out');
  cli('export', db, out);
  const home = readFileSync(join(out, 'index.html'), 'utf8');
  assert(home.includes('<h1>Furniture that lasts &lt;b>longer&lt;/b></h1>'), 'the typed title is in the export, as text');
  assert(home.includes('<p>Every piece is drawn first.</p><p>Then it is built.</p>'), 'the typed paragraphs are in the export');
  assert(/\{background-color:var\(--t-color-surface\);padding-block:7rem\}/.test(home), 'the block carries its token and its free value, and nothing else');
  assert(!/display:none|red;/.test(home), 'the refused value never reached the page');
  assert(!/data-edit|contenteditable|cms-|<script/.test(home), 'nothing of the editor is in the export');
  const css = readFileSync(join(out, 'assets/site.css'), 'utf8');
  assert(css.includes('--t-color-background:#12110f'), 'the export uses the theme chosen in the editor');
  assert(css.includes('--t-color-primary:#ff0066') && css.includes('.b-services{background-color:var(--t-color-brand)}'), 'the export carries the theme as it was built');
  assert(!/evil|body\{display:none/.test(css), 'no refused theme value reached the stylesheet');
  const project = readFileSync(join(out, 'projects/a-kitchen-in-oak/index.html'), 'utf8');
  assert(project.includes('<dt>Client</dt>') && project.includes('The Popescu family'), 'an entry of the new type is exported at its own address, with its field');
  assert(readFileSync(join(out, 'projects/index.html'), 'utf8').includes('href="/projects/a-kitchen-in-oak/"'), 'the type has a list on the site');
  const prices = readFileSync(join(out, 'preturi-si-comenzi/index.html'), 'utf8');
  assert(prices.includes('<h1>A headline that says what you do</h1>'), 'the new page is exported at its own address');
  assert(prices.includes('<h2>Our prices</h2><ul><li>Oak table</li><li>Walnut shelf</li></ul>'), 'the heading and the list are in the export');
  assert(/<strong>Ask ?<\/strong>/.test(prices) && /<a href="\/contact\/">offer<\/a>/.test(prices) && !prices.includes('javascript:'), 'so are the bold word and the link, and not the refused one');
  const picture = prices.match(/<img src="\/(media\/[a-f0-9]{32}\.webp)" alt="A plank of oak"/);
  assert(picture && readFileSync(join(out, picture[1])).subarray(8, 12).toString() === 'WEBP', 'the uploaded image is exported beside the page that shows it');
  const logo = home.match(/<img class="site-logo" src="\/(media\/[a-f0-9]{32}\.png)" alt="Atelier Nord"/);
  assert(logo && readdirSync(join(out, 'media')).length === 2, 'the logo is exported too, and no image that nothing shows');
  assert(home.includes('<p>© Atelier Nord, since 2014</p>') && home.includes('<a href="/preturi-si-comenzi/">Prices</a>'), 'the footer text and link are on every exported page');
  assert(/\.site-header\{--l-direction:column;[^}]*background-color:var\(--t-color-brand\)\}/.test(css), 'the header arrangement and colour are in the stylesheet, not in the pages');

  // The blog: the post, the list, its categories, the feed.
  const post = readFileSync(join(out, 'blog/winter-opening-hours/index.html'), 'utf8');
  assert(post.includes('<time datetime="2026-12-01">December 1, 2026</time>') && post.includes('<p>From December we are open on Saturdays too.</p>'), 'the post is exported at its own address, with its date and its text');
  assert(post.includes('<meta property="og:type" content="article">') && post.includes('<meta name="description" content="Saturdays too, from December.">'), 'a post tells search engines it is an article, with its summary');
  const blog = readFileSync(join(out, 'blog/index.html'), 'utf8');
  const titles = [...blog.matchAll(/<h2><a href="\/blog\/([a-z-]+)\/">/g)].map((m) => m[1]);
  assert(titles.join(' ') === 'winter-opening-hours a-table-for-twelve how-we-choose-wood', `the blog lists the posts newest first (${titles.join(' ')})`);
  assert(blog.includes('<p>Saturdays too, from December.</p>') && home.includes('<a href="/blog/">Blog</a>'), 'the list shows the summary, and the menu leads to the blog');
  const category = readFileSync(join(out, 'blog/category/workshop/index.html'), 'utf8');
  assert(category.includes('winter-opening-hours') && category.includes('how-we-choose-wood') && !category.includes('a-table-for-twelve'), 'a category page lists the posts of that category only');
  const feed = readFileSync(join(out, 'blog/feed.xml'), 'utf8');
  assert(feed.includes('<link href="https://example.com/blog/winter-opening-hours/"/>') && feed.includes('<updated>2026-12-01T00:00:00Z</updated>'), 'the feed carries the post with its full address');
  assert(readFileSync(join(out, 'sitemap.xml'), 'utf8').includes('<loc>https://example.com/blog/category/news/</loc>'), 'the sitemap lists the blog too');

  // The exported menu, in a browser with scripts switched off: wide, then as narrow as a phone.
  assert(home.includes('<summary>Workshop</summary>') && home.includes('<a href="/contact/#oak">Oak</a>') && !home.includes('<script'), 'the menu is in every page as plain markup');
  const types = { html: 'text/html; charset=utf-8', css: 'text/css', xml: 'application/xml', png: 'image/png', webp: 'image/webp', txt: 'text/plain' };
  const files = require('node:http').createServer((request, response) => {
    const path = join(out, decodeURIComponent(new URL(request.url, 'http://x').pathname).replace(/\/$/, '/index.html'));
    try {
      response.writeHead(200, { 'content-type': types[path.split('.').pop()] ?? 'application/octet-stream' }).end(readFileSync(path));
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve) => files.listen(4399, '127.0.0.1', resolve));
  const visitor = await chromium.launch();
  try {
    const context = await visitor.newContext({ javaScriptEnabled: false, viewport: { width: 1280, height: 800 }, deviceScaleFactor: shots ? 2 : 1 });
    const site = await context.newPage();
    await site.goto('http://127.0.0.1:4399/');
    const panel = site.locator('.menu > li.mega .sub');
    assert(!(await panel.isVisible()) && !(await site.locator('.menu-button').isVisible()), 'on a wide screen the menu is laid out, its panel closed, and there is no menu button');
    await site.locator('summary', { hasText: 'Workshop' }).click();
    assert(await panel.locator('a', { hasText: 'Oak' }).isVisible(), 'a click opens the panel, without script');
    const widths = await site.evaluate(() => [document.querySelector('.mega .sub').getBoundingClientRect().width, document.querySelector('.site-in').getBoundingClientRect().width]);
    assert(Math.abs(widths[0] - widths[1]) < 2, `the wide panel spans the header (${widths.join(' / ')})`);
    if (shots) await site.screenshot({ path: join(shots, 'menu-wide.png') });
    await site.mouse.click(640, 700);
    assert(!(await panel.isVisible()), 'a click anywhere else closes it');
    await site.setViewportSize({ width: 390, height: 800 });
    assert(!(await site.locator('.menu').isVisible()) && (await site.locator('.menu-button').isVisible()), 'on a phone the menu is folded behind a button');
    await site.locator('.menu-button').click();
    await site.locator('summary', { hasText: 'Workshop' }).click();
    assert(await panel.locator('a', { hasText: 'Oak' }).isVisible(), 'the button unfolds it, and an item opens in place');
    const wider = await site.evaluate(() => [...document.querySelectorAll('body *')].filter((el) => el.getBoundingClientRect().right > innerWidth + 1).map((el) => `${el.tagName.toLowerCase()}.${el.className}`).slice(0, 5));
    assert(wider.length === 0 && (await site.evaluate(() => document.documentElement.scrollWidth)) <= 390, `nothing is wider than the phone ${wider.join(' ')}`);
    if (shots) await site.screenshot({ path: join(shots, 'menu-phone.png') });
    await site.locator('.sub a', { hasText: 'Oak' }).click();
    assert(site.url().endsWith('/contact/#oak'), 'and its links lead where they say');
  } finally {
    await visitor.close();
    files.close();
  }
  rmSync(dir, { recursive: true, force: true });
  console.log('\nThe editor works end to end.');
})().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
