/**
 * The contact form (ADR 0019), in a real browser: an exported static page
 * posts to the form service, the visitor comes back to the page and sees it
 * was sent, and the owner reads the message in the admin and deletes it.
 *
 *   node e2e/forms.cjs [folder for screenshots]
 */
const { chromium } = require('playwright');
const coverage = require('./coverage.cjs');
const { spawn, execFileSync } = require('node:child_process');
const { createServer } = require('node:http');
const { mkdtempSync, readFileSync, rmSync, existsSync, statSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, extname } = require('node:path');

const root = join(__dirname, '..');
const cli = (...args) => execFileSync('bun', ['src/site/cli.ts', ...args], { cwd: root, encoding: 'utf8' });
const assert = (condition, message) => {
  if (!condition) throw new Error(`FAILED: ${message}`);
  console.log(`ok  ${message}`);
};
const SITE_PORT = 4397;
const FORMS_PORT = 4398;
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.xml': 'application/xml' };

const started = (child, pattern) =>
  new Promise((resolve, reject) => {
    let out = '';
    child.stdout.on('data', (chunk) => {
      out += chunk;
      const found = out.match(pattern);
      if (found) resolve(found[0]);
    });
    child.stderr.on('data', (chunk) => process.stderr.write(chunk));
    child.on('exit', () => reject(new Error(`stopped before it started: ${out}`)));
  });

(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'thecms-e2e-forms-'));
  const db = join(dir, 'site.db');
  const out = join(dir, 'out');
  const shots = process.argv[2];
  cli('init', db);
  // The owner's settings, and a contact form on the contact page, published.
  execFileSync(
    'bun',
    [
      '-e',
      `import { Store } from './src/site/store.ts';
       const store = await Store.open(${JSON.stringify(db)});
       await store.setSite({ ...(await store.site()), url: 'http://127.0.0.1:${SITE_PORT}', forms: 'http://127.0.0.1:${FORMS_PORT}' });
       const page = await store.draft('contact');
       await store.publish((await store.savePage({ ...page, blocks: [...page.blocks, { type: 'form', content: { title: 'Write to us', consent: 'Keep what I write to answer me.', button: 'Send', sent: 'Thank you, it was sent.', failed: 'It could not be sent.' } }] })).slug);
       await store.close();`,
    ],
    { cwd: root },
  );
  cli('export', db, out);

  const site = createServer((request, response) => {
    let file = join(out, decodeURIComponent(new URL(request.url, 'http://x').pathname));
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!existsSync(file)) return response.writeHead(404).end();
    response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
  }).listen(SITE_PORT, '127.0.0.1');
  const forms = spawn('bun', ['src/site/cli.ts', 'forms', db, String(FORMS_PORT)], { cwd: root });
  await started(forms, /Receiving forms/);

  const browser = await coverage.launch(chromium, 'forms');
  let editor;
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${SITE_PORT}/contact/`);
    const form = page.locator('form.form');
    assert((await page.locator('script').count()) === 0, 'the page with the form has no script');
    assert(!(await page.locator('.form-sent').isVisible()), 'before sending, the words that say it was sent are hidden');
    await form.getByLabel('Name').fill('Ana Pop');
    await form.getByLabel('Email').fill('ana@example.org');
    await form.getByLabel('Message').fill('Could you make a table for twelve?');
    await form.getByRole('button', { name: 'Send' }).click();
    // Required consent: the browser stops the form before it leaves the page.
    assert(page.url().endsWith('/contact/'), 'without the consent ticked, nothing is sent');
    await form.getByLabel('Keep what I write to answer me.').check();
    await form.getByRole('button', { name: 'Send' }).click();
    await page.waitForURL(/#f-.+-sent$/);
    assert(await page.locator('.form-sent').isVisible(), 'after sending, the visitor is back on the page and is told it was sent');
    assert(!(await page.locator('.form-failed').isVisible()), 'and not that it failed');
    if (shots) await page.screenshot({ path: join(shots, 'form-sent.png'), fullPage: true });

    editor = spawn('bun', ['src/site/cli.ts', 'edit', db, '4399'], { cwd: root });
    const url = await started(editor, /http:\/\/127\.0\.0\.1:\d+\/admin\/#token=\w+/);
    await page.goto(url);
    await page.locator('[data-nav="messages"]').click();
    const message = page.locator('[data-list="messages"] [data-message]');
    await message.first().waitFor();
    const text = await message.first().innerText();
    assert(text.includes('Ana Pop') && text.includes('table for twelve'), 'the owner reads the message in the admin');
    assert(text.includes('ana@example.org'), 'with the address to answer');
    if (shots) await page.screenshot({ path: join(shots, 'admin-messages.png'), fullPage: true });
    await message.first().locator('[data-message-delete]').click();
    await page.getByText('No messages yet.').waitFor();
    assert(true, 'and deletes it');
    assert(errors.length === 0, `no errors in the browser ${errors.join(' | ')}`);
  } catch (error) {
    if (shots) await browser.contexts()[0]?.pages()[0]?.screenshot({ path: join(shots, 'failure.png') }).catch(() => {});
    throw error;
  } finally {
    await browser.close();
    forms.kill();
    editor?.kill();
    site.close();
  }
  rmSync(dir, { recursive: true, force: true });
  console.log('\nThe contact form works end to end.');
})().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
