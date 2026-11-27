/**
 * Backups in a real browser (ADR 0051): one made at once, the settings and a
 * copy sent to an S3 storage (a small one in this script), a backup
 * downloaded, put back after asking, deleted, a file from elsewhere put back,
 * and a backup that fails said at the top of the admin.
 *
 *   node e2e/backups.cjs [folder for screenshots]
 */
const { chromium } = require('playwright');
const coverage = require('./coverage.cjs');
const { spawn, execFileSync } = require('node:child_process');
const { createServer } = require('node:http');
const { mkdtempSync, readdirSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const root = join(__dirname, '..');
const cli = (...args) => execFileSync('bun', ['src/site/cli.ts', ...args], { cwd: root, encoding: 'utf8' });
const assert = (condition, message) => {
  if (!condition) throw new Error(`FAILED: ${message}`);
  console.log(`ok  ${message}`);
};
const PORT = 4394;

/** The editor on the site, and the address it printed. */
function edit(db, env = {}) {
  const server = spawn('bun', ['src/site/cli.ts', 'edit', db, String(PORT)], { cwd: root, env: { ...process.env, ...env } });
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

/** An S3 storage that keeps what it is sent in memory: enough for Bun's client. */
function fakeS3() {
  const objects = new Map();
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://x');
    const key = decodeURIComponent(url.pathname.replace(/^\/bucket\//, ''));
    const chunks = [];
    request.on('data', (c) => chunks.push(c));
    request.on('end', () => {
      if (request.method === 'PUT') {
        objects.set(key, Buffer.concat(chunks));
        response.writeHead(200, { etag: '"x"' }).end();
      } else if (request.method === 'DELETE') {
        objects.delete(key);
        response.writeHead(204).end();
      } else {
        const prefix = url.searchParams.get('prefix') ?? '';
        const keys = [...objects.keys()].filter((k) => k.startsWith(prefix));
        response.writeHead(200, { 'content-type': 'application/xml' }).end(
          `<?xml version="1.0"?><ListBucketResult><Name>bucket</Name><Prefix>${prefix}</Prefix><KeyCount>${keys.length}</KeyCount><IsTruncated>false</IsTruncated>${keys.map((k) => `<Contents><Key>${k}</Key><Size>1</Size></Contents>`).join('')}</ListBucketResult>`,
        );
      }
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, objects, port: server.address().port })));
}

(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'uhlaka-e2e-backups-'));
  const db = join(dir, 'site.db');
  const shots = process.argv[2];
  cli('init', db);
  const s3 = await fakeS3();
  let editor = edit(db);
  const url = await editor.url;

  const browser = await coverage.launch(chromium, 'backups');
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(url);

    await page.locator('[data-nav="backups"]').click();
    await page.locator('[data-backup-now]').waitFor();
    await page.locator('[data-backup-now]').click();
    await page.locator('[data-backup-last="ok"]').waitFor();
    await page.locator('[data-backup]').first().waitFor();
    assert(readdirSync(join(dir, 'backups')).some((n) => n.endsWith('.uhlaka-backup')), 'a backup is made at once, in "backups" beside the site');

    // When, how many, and a copy sent to S3: tested, saved, and sent with the next one.
    await page.locator('[data-backup-every]').selectOption('week');
    await page.locator('[data-backup-hour]').selectOption('5');
    await page.locator('[data-backup-keep]').fill('3');
    await page.locator('[data-backup-s3]').check();
    await page.locator('[data-s3="endpoint"]').fill('http://127.0.0.1:1');
    await page.locator('[data-s3="bucket"]').fill('bucket');
    await page.locator('[data-s3="accessKeyId"]').fill('key');
    await page.locator('[data-s3="secretAccessKey"]').fill('secret');
    await page.locator('[data-backup-test]').click();
    await page.locator('[data-backup-tested].bad').waitFor();
    assert(true, 'a storage that does not answer is said so by "Test"');
    await page.locator('[data-s3="endpoint"]').fill(`http://127.0.0.1:${s3.port}`);
    await page.locator('[data-backup-test]').click();
    await page.locator('[data-backup-tested].good').waitFor();
    await page.locator('[data-backup-save]').click();
    await page.locator('[data-backup-note]').waitFor();
    await page.evaluate(() => history.replaceState(null, "", location.href.replace(/[#&]at=[^&#]*/, ""))); // opened again at its first screen, not the one it was on
    await page.reload();
    await page.locator('[data-nav="backups"]').click();
    await page.locator('[data-backup-keep]').waitFor();
    assert((await page.locator('[data-backup-every]').inputValue()) === 'week' && (await page.locator('[data-backup-keep]').inputValue()) === '3', 'the settings are kept');
    assert((await page.locator('[data-s3="secretAccessKey"]').inputValue()) === '***', 'the secret is never shown back');
    await page.locator('[data-backup-now]').click();
    await page.getByText('A copy was sent to the S3 storage.').waitFor();
    assert([...s3.objects.keys()].some((k) => k.startsWith('uhlaka/manual-')), 'the copy reaches the storage');
    assert((await page.locator('[data-backup-kind]').first().textContent()).includes('Kept until you delete it'), '"Back up now" is made by hand, and kept until deleted');
    if (shots) await page.screenshot({ path: join(shots, 'backups.png'), fullPage: true });

    // Downloaded.
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-backup-download]').first().click()]);
    const saved = join(dir, 'downloaded.uhlaka-backup');
    await download.saveAs(saved);
    assert(download.suggestedFilename().endsWith('.uhlaka-backup'), 'a backup is downloaded as its file');

    // Put back: asked once, cancelled, then done; the admin opens again.
    await page.locator('[data-backup-restore]').last().click();
    await page.locator('[data-backup-confirm]').waitFor();
    if (shots) await page.screenshot({ path: join(shots, 'backups-confirm.png') });
    await page.locator('[data-backup-cancel]').click();
    await page.locator('[data-backup-confirm]').waitFor({ state: 'detached' });
    await page.locator('[data-backup-restore]').last().click();
    const reloaded = page.waitForEvent('load');
    await page.locator('[data-backup-yes]').click();
    await page.locator('[data-backup-note]').waitFor();
    await reloaded;
    await page.locator('[data-nav="backups"]').click();
    await page.locator('[data-backup^="before-restore-"]').waitFor();
    assert(true, 'putting one back is asked first, and a backup of what was there is made before it');

    // Deleted.
    const count = await page.locator('[data-backup]').count();
    await page.locator('[data-backup-remove]').last().click();
    await page.waitForFunction((n) => document.querySelectorAll('[data-backup]').length === n - 1, count);
    assert(true, 'a backup is deleted');

    // A file from elsewhere: chosen, cancelled, chosen again, put back.
    await page.locator('[data-backup-file]').setInputFiles(saved);
    await page.locator('[data-backup-upload-confirm]').waitFor();
    await page.locator('[data-backup-upload-cancel]').click();
    await page.locator('[data-backup-upload-confirm]').waitFor({ state: 'detached' });
    await page.locator('[data-backup-file]').setInputFiles(saved);
    const again = page.waitForEvent('load');
    await page.locator('[data-backup-upload]').click();
    await again;
    await page.locator('[data-nav="backups"]').click();
    await page.locator('[data-backup^="uploaded-"]').waitFor();
    assert(true, 'a backup from another server is uploaded and put back');

    // Not a backup: refused, said.
    const junk = join(dir, 'junk.uhlaka-backup');
    writeFileSync(junk, 'not a backup');
    await page.locator('[data-backup-file]').setInputFiles(junk);
    await page.locator('[data-backup-upload]').click();
    await page.locator('[data-backup-problem]', { hasText: 'not a Uhlaka backup' }).waitFor();
    assert(true, 'a file that is not a backup is refused');
    // Turned off, and the copy outside the server too.
    await page.locator('[data-backup-on]').uncheck();
    await page.locator('[data-backup-s3]').uncheck();
    await page.locator('[data-backup-save]').click();
    await page.locator('[data-backup-note]').waitFor();
    assert(errors.length === 0, `no errors in the browser ${errors.join(' | ')}`);

    // A folder backups cannot be written to: the failure is said, and at the top of the admin.
    editor.server.kill();
    const blocked = join(dir, 'blocked');
    writeFileSync(blocked, '');
    editor = edit(db, { UHLAKA_BACKUPS: blocked });
    await page.goto('about:blank');
    await page.goto(await editor.url);
    await page.locator('[data-nav="backups"]').click();
    await page.locator('[data-backup-now]').click();
    await page.locator('[data-backup-last="failed"]').waitFor();
    await page.evaluate(() => history.replaceState(null, "", location.href.replace(/[#&]at=[^&#]*/, ""))); // opened again at its first screen, not the one it was on
    await page.reload();
    await page.locator('[data-backup-failed]').waitFor();
    assert(true, 'a backup that failed is said on its screen and at the top of the admin');
    await page.locator('[data-nav="backups"]').click();
    await page.locator('[data-backup-download]').waitFor({ state: 'detached' });
    assert(errors.length === 0, `no errors in the browser ${errors.join(' | ')}`);
  } catch (error) {
    if (shots) await browser.contexts()[0]?.pages()[0]?.screenshot({ path: join(shots, 'failure.png') }).catch(() => {});
    throw error;
  } finally {
    await browser.close();
    editor.server.kill();
    s3.server.close();
  }
  rmSync(dir, { recursive: true, force: true });
  console.log('\nBackups work.');
})().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
