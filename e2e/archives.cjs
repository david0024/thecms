/**
 * Archives by author and by date, in a real browser (ADR 0056): the owner
 * gives herself a picture on "Me", publishes a post, and puts an archive block
 * on the home page; the site has her page, the post's month, and the block's
 * link to it.
 *
 *   node e2e/archives.cjs [folder for screenshots]
 */
const { chromium } = require('playwright');
const coverage = require('./coverage.cjs');
const { spawn, execFileSync } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { deflateSync } = require('node:zlib');

const root = join(__dirname, '..');
const cli = (...args) => execFileSync('bun', ['src/site/cli.ts', ...args], { cwd: root, encoding: 'utf8' });
const assert = (condition, message) => {
  if (!condition) throw new Error(`FAILED: ${message}`);
  console.log(`ok  ${message}`);
};
const PORT = 4421;
const PUBLIC = `http://127.0.0.1:${PORT}`;
const PASSWORD = 'a long enough password';

function png(width, height) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'ascii');
    data.copy(out, 8);
    out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x80)]);
  const pixels = deflateSync(Buffer.concat(Array.from({ length: height }, () => row)));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', pixels), chunk('IEND', Buffer.alloc(0))]);
}

(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'uhlaka-e2e-archives-'));
  const db = join(dir, 'site.db');
  const shots = process.argv[2];
  cli('init', db);
  execFileSync(
    'bun',
    [
      '-e',
      `const { Store } = await import('./src/site/store.ts');
       const store = await Store.open(process.argv[1]);
       await store.addUser({ email: 'olga@example.com', name: 'Olga Rusu', role: 'owner', password: '${PASSWORD}' });
       await store.close();`,
      db,
    ],
    { cwd: root },
  );

  const server = spawn('bun', ['src/site/cli.ts', 'serve', db, `--public=${PUBLIC}`, `--port=${PORT}`], { cwd: root });
  await new Promise((resolve, reject) => {
    let out = '';
    server.stdout.on('data', (chunk) => {
      out += chunk;
      if (out.includes('Sign in there')) resolve();
    });
    server.stderr.on('data', (chunk) => process.stderr.write(chunk));
    server.on('exit', () => reject(new Error('the editor stopped')));
  });

  const browser = await coverage.launch(chromium, 'archives');
  try {
    const errors = [];
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: shots ? 2 : 1 });
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${PUBLIC}/admin/`);
    const form = page.locator('[data-sign-in]');
    await form.locator('[data-email]').fill('olga@example.com');
    await form.locator('[data-password]').fill(PASSWORD);
    await form.getByRole('button').click();
    await page.locator('[data-nav="media"]').waitFor();

    // Her picture, uploaded on "Me": an image of the library, without an address elsewhere.
    await page.locator('[data-nav="me"]').click();
    const picture = page.locator('[data-profile-picture]');
    assert((await picture.locator('[data-image-src]').count()) === 0, 'a picture of someone is only one of the library');
    await picture.locator('[data-media-file]').setInputFiles({ name: 'olga.png', mimeType: 'image/png', buffer: png(48, 48) });
    await picture.locator('img.preview').waitFor();
    await page.locator('[data-profile-bio]').fill('Olga makes chairs.');
    await page.locator('[data-profile] button[type="submit"]').click();
    await page.locator('[data-profile-saved]').waitFor();
    if (shots) await page.screenshot({ path: join(shots, 'me-picture.png') });
    assert(true, 'she sets her picture and her words');

    // A post, published: its byline leads to her page.
    await page.locator('[data-nav="posts"]').click();
    await page.locator('[data-new="post"]').click();
    await page.getByPlaceholder(/title/i).fill('Oak chair');
    await page.locator('[data-list="post"] form button[type="submit"]').click();
    await page.locator('.builder:not([hidden])').waitFor();
    await page.frameLocator('iframe').locator('.post-author a[rel="author"]', { hasText: 'Olga Rusu' }).waitFor();
    await page.locator('.bar .primary').click();
    await page.locator('.bar .state', { hasText: 'Published' }).waitFor();
    assert(true, 'the canvas links her name to her page');

    // The archive block on the home page.
    await page.locator('[data-back]').click();
    await page.locator('[data-nav="pages"]').click();
    await page.locator('[data-open=""]').click();
    await page.locator('.builder:not([hidden])').waitFor();
    await page.locator('[data-add="archive"]').click();
    const month = new Date().toISOString().slice(0, 7);
    const monthPath = `/blog/${month.replace('-', '/')}/`;
    await page.frameLocator('iframe').locator(`.archive-list a[href="${monthPath}"]`).waitFor();
    if (shots) await page.screenshot({ path: join(shots, 'archive-block.png') });
    await page.getByRole('button', { name: 'Publish' }).click();
    await page.getByText('Published', { exact: true }).waitFor();
    assert(true, 'the archive block lists the month of the post');

    // On the site.
    const get = async (path) => {
      const response = await fetch(`${PUBLIC}${path}`);
      return { status: response.status, html: await response.text() };
    };
    const home = await get('/');
    assert(home.html.includes(`href="${monthPath}"`) && home.html.includes('(1)'), 'the home page links to the month, with how many posts');
    const listed = await get(monthPath);
    assert(listed.status === 200 && listed.html.includes('Oak chair') && listed.html.includes('content="noindex"'), 'the month lists the post, kept out of search engines');
    const mine = await get('/blog/author/olga-rusu/');
    assert(mine.status === 200 && mine.html.includes('class="author-picture"') && mine.html.includes('Olga makes chairs.') && mine.html.includes('Oak chair'), 'her page in the blog shows her picture, her words and her post');
    const everything = await get('/author/olga-rusu/');
    assert(everything.status === 200 && everything.html.includes('Oak chair'), 'her page across every type lists it too');

    // A new name: the old page leads to the new one.
    await page.locator('[data-back]').click();
    await page.locator('[data-nav="me"]').click();
    await page.locator('[data-profile-name]').fill('Olga Rusu-Pop');
    await page.locator('[data-profile] button[type="submit"]').click();
    await page.locator('[data-profile-saved]').waitFor();
    // A real 301, as the runtime answers an old address (ADR 0036).
    let moved = '';
    for (let i = 0; i < 20 && !moved.endsWith('/blog/author/olga-rusu-pop/'); i++) {
      await page.waitForTimeout(250);
      moved = (await fetch(`${PUBLIC}/blog/author/olga-rusu/`, { redirect: 'manual' })).headers.get('location') ?? '';
    }
    assert(moved.endsWith('/blog/author/olga-rusu-pop/'), 'her old page leads to her new one');
    assert((await get('/blog/author/olga-rusu-pop/')).html.includes('Oak chair'), 'her new page lists her post');

    assert(errors.length === 0, `no errors in the browser ${errors.join(' | ')}`);
  } catch (error) {
    if (shots) await browser.contexts()[0]?.pages()[0]?.screenshot({ path: join(shots, 'failure.png') }).catch(() => {});
    throw error;
  } finally {
    await browser.close();
    server.kill();
  }
  rmSync(dir, { recursive: true, force: true });
  console.log('\nArchives by author and date work.');
})().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
