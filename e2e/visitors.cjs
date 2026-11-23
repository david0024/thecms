/**
 * Visitor accounts in a real browser (ADR 0064, PR a): the mail server set in
 * Settings → E-mail and tested, the accounts turned on, a visitor signing up
 * from the site's own page, confirming the address from the message the
 * site's clock sent, and the owner seeing the account and inviting another;
 * member levels named and given, and a page kept for members (PR b).
 *
 *   node e2e/visitors.cjs [folder for screenshots]
 */
const { chromium } = require('playwright');
const coverage = require('./coverage.cjs');
const { spawn, execFileSync } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const net = require('node:net');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const root = join(__dirname, '..');
const cli = (...args) => execFileSync('bun', ['src/site/cli.ts', ...args], { cwd: root, encoding: 'utf8' });
const assert = (condition, message) => {
  if (!condition) throw new Error(`FAILED: ${message}`);
  console.log(`ok  ${message}`);
};
const PORT = 4401;
const SMTP = 2601;

/** A mail server on this machine that keeps what it is given. */
function mailServer(mails) {
  const server = net.createServer((socket) => {
    let data = false;
    let text = '';
    socket.on('error', () => {});
    socket.write('220 test\r\n');
    socket.on('data', (chunk) => {
      for (const line of chunk.toString().split('\r\n')) {
        if (data) {
          if (line === '.') {
            data = false;
            const [head, body = ''] = text.split('\r\n\r\n');
            mails.push({ head, text: Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf8') });
            text = '';
            socket.write('250 kept\r\n');
          } else text += `${line}\r\n`;
        } else if (/^EHLO/i.test(line)) socket.write('250 test\r\n');
        else if (/^(MAIL|RCPT)/i.test(line)) socket.write('250 ok\r\n');
        else if (/^DATA/i.test(line)) {
          data = true;
          socket.write('354 go\r\n');
        } else if (/^QUIT/i.test(line)) socket.end('221 bye\r\n');
      }
    });
  });
  server.listen(SMTP, '127.0.0.1');
  return server;
}

(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'uhlaka-e2e-visitors-'));
  const db = join(dir, 'site.db');
  const shots = process.argv[2];
  const mails = [];
  const smtp = mailServer(mails);
  cli('init', db);

  const server = spawn('bun', ['src/site/cli.ts', 'edit', db, String(PORT)], { cwd: root, env: { ...process.env, UHLAKA_SMTP: '', UHLAKA_MAIL_FROM: '' } });
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
  const waitForMail = async (count, what) => {
    // The site's clock sends what waits: within one of its ticks.
    for (let i = 0; i < 80 && mails.length < count; i++) await new Promise((r) => setTimeout(r, 500));
    assert(mails.length >= count, what);
    return mails[count - 1];
  };

  const browser = await coverage.launch(chromium, 'visitors');
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('dialog', (d) => d.accept());
    await page.goto(url);

    // Off, the site has no account pages.
    assert((await page.request.get(site('/_/account'))).status() === 404, 'while off, /_/account is not found');

    await page.locator('[data-nav="settings"]').click();
    await page.locator('[data-visitors-on]').waitFor();
    assert(!(await page.locator('[data-visitors-on]').isChecked()), 'Settings show the accounts off');

    // Settings → E-mail: a server on this machine, a sender, and a test.
    await page.locator('[data-mail-host]').fill('127.0.0.1');
    await page.locator('[data-mail-security]').selectOption('plain');
    await page.locator('[data-mail-port]').fill(String(SMTP));
    await page.locator('[data-mail-from]').fill('site@example.com');
    await page.locator('[data-mail-save]').click();
    await page.locator('[data-mail-ready="true"]').waitFor();
    assert(true, 'the mail server is saved, and the site can send mail');
    await page.locator('[data-mail-test-to]').fill('owner@example.com');
    await page.locator('[data-mail-test]').click();
    await waitForMail(1, 'the test message reaches the mail server');
    assert(mails[0].head.includes('To: owner@example.com'), 'to the address given');

    // The words of a message, changed and given back.
    await page.locator('[data-mail-template]').selectOption('welcome');
    await page.locator('[data-mail-subject]').fill('Hi {name}, welcome to {site}');
    await page.locator('[data-mail-template-save]').click();
    await page.getByText('Use the program').waitFor();
    assert(true, "the owner's words for a message are kept");

    // Turned on, open to anyone.
    await page.locator('[data-visitors-on]').check();
    await page.locator('[data-visitors-signup]').waitFor();
    await page.locator('[data-visitors-signup]').selectOption('open');
    await page.locator('[data-visitors-privacy]').fill('/about/');
    await page.locator('[data-visitors-privacy]').blur();
    await page.waitForTimeout(400);
    if (shots) await page.screenshot({ path: join(shots, 'visitors-settings.png') });

    // A visitor, in another browser, signs up on the site's own page.
    const visitor = await browser.newPage();
    await visitor.goto(site('/_/account/signup'));
    assert((await visitor.locator('main form').count()) === 1, 'the sign-up page is in the site frame');
    await visitor.locator('input[name="name"]').fill('Ana');
    await visitor.locator('input[name="email"]').fill('ana@example.com');
    await visitor.locator('input[name="password"]').fill('long enough pass');
    await visitor.locator('input[name="consent"]').check();
    await visitor.locator('main button[type="submit"]').click();
    await visitor.locator('[data-account-check-mail]').waitFor();
    if (shots) await visitor.screenshot({ path: join(shots, 'visitors-check-mail.png') });
    const confirm = await waitForMail(2, 'the confirmation is sent by the clock');
    const link = /https?:\/\/\S+\/_\/account\/link\?k=\S+/.exec(confirm.text)[0].replace(/^https?:\/\/[^/]+/, '');
    await visitor.goto(site(link));
    await visitor.locator('main button[type="submit"]').click();
    await visitor.getByText('Hello, Ana').waitFor();
    assert(true, 'the address is confirmed, and the visitor is signed in');
    if (shots) await visitor.screenshot({ path: join(shots, 'visitors-account.png') });
    const welcome = await waitForMail(3, 'a welcome follows');
    assert(welcome.head.includes('Subject: Hi Ana, welcome to'), "in the owner's words");

    // The owner sees the account, and invites another.
    await page.reload();
    await page.locator('[data-nav="settings"]').click();
    await page.locator('[data-visitor="ana@example.com"]').waitFor();
    assert(true, 'the owner sees the account');
    await page.locator('[data-invite-email]').fill('guest@example.com');
    await page.locator('[data-invite-send]').click();
    await page.locator('[data-visitor="guest@example.com"]').waitFor();
    await waitForMail(4, 'the invitation is sent');
    await page.locator('[data-visitor="guest@example.com"] [data-visitor-remove]').click();
    await page.locator('[data-visitor="guest@example.com"]').waitFor({ state: 'detached' });
    assert(true, 'and deletes an account');

    // An address that has an account is not invited again: the owner is told.
    await page.locator('[data-invite-email]').fill('ana@example.com');
    await page.locator('[data-invite-send]').click();
    await page.getByText('someone already has an account with that address').waitFor();
    assert(true, 'inviting an address that has an account is refused, and said');

    // A visitor's data, downloaded for them.
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-visitor="ana@example.com"] button').first().click()]);
    assert(download.suggestedFilename() === 'ana@example.com.json', "the owner downloads a visitor's data");

    // Member levels (ADR 0064 d3): named, chosen for new accounts, and given to Ana.
    await page.locator('[data-level-name]').fill('Premium');
    await page.locator('[data-level-add]').click();
    await page.locator('[data-level="premium"]').waitFor();
    await page.locator('[data-visitors-welcome]').selectOption('premium');
    await page.waitForResponse((r) => r.url().endsWith('/api/visitors') && r.request().method() === 'PUT');
    await page.locator('[data-visitor="ana@example.com"] [data-visitor-level="premium"]').check();
    await page.waitForResponse((r) => r.url().includes('/api/visitors/levels'));
    assert(await page.locator('[data-visitor="ana@example.com"] [data-visitor-level="premium"]').isChecked(), 'a level is named and given to a visitor');

    // "My account" in the menu, while the accounts are on.
    await page.locator('[data-menu-customise]').click();
    await page.locator('[data-menu-add="1"]').click();
    await page.locator('[data-menu-level="1"] > li').last().locator('[data-menu-target]').first().selectOption('account');
    assert(true, 'the menu may lead to "My account"');

    // Who sees it (ADR 0064 d4): the page "About" for members of Premium; Ana opens it, another visitor is asked to sign in.
    await page.reload();
    await page.locator('button[data-open="about"]').click();
    await page.locator('[data-audience="page"]').waitFor();
    await page.locator('[data-audience-who="members"]').check();
    await page.locator('[data-audience-closed]').waitFor();
    assert(await page.locator('[data-audience-level="premium"]').isChecked(), 'a page is kept for members of a level');
    // The runtime builds again within a second of a change.
    await page.waitForTimeout(1200);
    const opened = await visitor.goto(site('/about/'));
    assert(opened.status() === 200, 'a member of the level sees it');
    const stranger = await browser.newPage();
    const asked = await stranger.goto(site('/about/'));
    assert(asked.status() === 403 && (await stranger.locator('[data-members-sign-in]').count()) === 1, 'anyone else is asked to sign in');
    if (shots) await stranger.screenshot({ path: join(shots, 'members-sign-in.png') });
    await stranger.close();
    await page.locator('[data-audience-level="premium"]').uncheck();
    await page.locator('[data-audience-who="signed"]:checked').waitFor();
    await page.locator('[data-audience-who="everyone"]').check();
    await page.locator('[data-audience-closed]').waitFor({ state: 'detached' });
    assert(true, 'and opened to everyone again');

    // A whole type, from its settings.
    await page.reload();
    await page.locator('[data-nav="types"]').click();
    await page.locator('[data-type] button.open').first().click();
    await page.locator('[data-audience="type"]').waitFor();
    await page.locator('[data-audience-who="signed"]').check();
    await page.locator('[data-audience-closed]').waitFor();
    await page.locator('[data-audience-who="everyone"]').check();
    await page.locator('[data-audience-closed]').waitFor({ state: 'detached' });
    assert(true, 'a whole type is kept for those signed in, and opened again');

    // A level taken away.
    await page.reload();
    await page.locator('[data-nav="settings"]').click();
    await page.locator('[data-level="premium"] [data-level-remove]').click();
    await page.locator('[data-level="premium"]').waitFor({ state: 'detached' });
    assert(true, 'a level is taken away');

    // Messages that could not be sent at their last try: listed, tried again, or forgotten.
    const failed = (id) =>
      `INSERT INTO mail_queue (id, to_address, subject, body, what, tries, next_at, failed_at, error, created_at) VALUES ('${id}', '${id}@example.com', 's', 'b', 'invite', 5, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 'refused', '2026-01-01T00:00:00.000Z')`;
    execFileSync('bun', ['-e', `const { Database } = require('bun:sqlite'); const db = new Database(process.argv[1]); db.run(process.argv[2]); db.run(process.argv[3]);`, db, failed('lost'), failed('again')]);
    await page.reload();
    await page.locator('[data-nav="settings"]').click();
    const rows = page.locator('[data-visitors-failed] li');
    await rows.first().waitFor();
    assert((await rows.count()) === 2, 'what could not be sent is listed');
    await rows.filter({ hasText: 'lost@example.com' }).getByRole('button').nth(1).click();
    await page.locator('[data-visitors-failed] li', { hasText: 'lost@example.com' }).waitFor({ state: 'detached' });
    await rows.filter({ hasText: 'again@example.com' }).getByRole('button').first().click();
    await page.locator('[data-visitors-failed]').waitFor({ state: 'detached' });
    await page.locator('[data-visitors-waiting]').waitFor();
    assert(true, 'one is forgotten, the other tried again');
    assert(errors.length === 0, `no errors in the browser ${errors.join(' | ')}`);
  } catch (error) {
    if (shots) await browser.contexts()[0]?.pages()[0]?.screenshot({ path: join(shots, 'failure.png') }).catch(() => {});
    throw error;
  } finally {
    await browser.close();
    server.kill();
    smtp.close();
  }
  rmSync(dir, { recursive: true, force: true });
  console.log('\nVisitor accounts work.');
})().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
