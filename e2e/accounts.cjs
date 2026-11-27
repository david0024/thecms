/**
 * Accounts, in a real browser (ADR 0022): the editor served for others, its
 * first owner made from the link it prints, an editor invited by the owner,
 * what each of them sees, signing out and in again, and the owner's screen of
 * people.
 *
 *   node e2e/accounts.cjs [folder for screenshots]
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
const PORT = 4397;
const PUBLIC = `http://127.0.0.1:${PORT}`;
const PASSWORD = 'a long enough password';

(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'uhlaka-e2e-accounts-'));
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

  const browser = await coverage.launch(chromium, 'accounts');
  try {
    const errors = [];
    const open = async () => {
      // Each page is a browser of its own: its own cookies, as two people on two computers.
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
      page.on('pageerror', (e) => errors.push(String(e)));
      return page;
    };
    const owner = await open();

    // Without an account, the admin asks to sign in.
    await owner.goto(`${PUBLIC}/admin/`);
    await owner.locator('[data-sign-in]').waitFor();
    assert(true, 'a served admin asks to sign in');

    // The first owner, from the link the server printed.
    await owner.goto(setup);
    const form = owner.locator('[data-link="setup"]');
    await form.waitFor();
    if (shots) await owner.screenshot({ path: join(shots, 'accounts-setup.png') });
    // The first page names the site (ADR 0048 d4); its language stays English here, as the steps below read it.
    await form.locator('[data-site-name]').fill('Atelierul Anei');
    assert((await form.locator('[data-language] option').count()) >= 2, 'the first page offers the languages the program has');
    await form.locator('[data-name]').fill('Ana');
    await form.locator('[data-email]').fill('ana@example.com');
    await form.locator('[data-password]').fill(PASSWORD);
    await form.getByRole('button').click();
    await owner.locator('[data-nav="people"]').waitFor();
    assert(!owner.url().includes('#link='), 'the setup link makes the owner, and leaves the address');
    assert(await owner.locator('[data-nav="settings"]').isVisible(), 'the owner sees the settings');

    // A used link says so, and offers to sign in.
    const late = await open();
    await late.goto(setup);
    await late.locator('[data-sign-in]').getByText('this link has been used or has run out').waitFor();
    assert(true, 'the setup link works once');

    // The owner invites an editor, and gets the link to send.
    await owner.locator('[data-nav="people"]').click();
    await owner.locator('[data-invite-email]').fill('ion@example.com');
    await owner.locator('[data-invite] button[type="submit"]').click();
    const invite = await owner.locator('[data-link-text]').inputValue();
    assert(invite.startsWith(`${PUBLIC}/admin/#link=`), 'inviting someone gives a link to send them');
    await owner.locator('[data-made-link] button').click();
    await owner.locator('[data-made-link] button', { hasText: 'Copied' }).waitFor();
    assert((await owner.evaluate(() => navigator.clipboard.readText())) === invite, 'the link is copied to send');
    // An address that already has an account is said to have one.
    await owner.locator('[data-invite-email]').fill('ana@example.com');
    await owner.locator('[data-invite] button[type="submit"]').click();
    await owner.getByRole('alert').getByText('someone with this address already has an account').waitFor();
    assert((await owner.locator('[data-invite-email]').inputValue()) === 'ana@example.com', 'a refused invitation keeps what was typed');
    await owner.locator('[data-user="ion@example.com"]').getByText('invited, not signed in yet').waitFor();
    if (shots) await owner.screenshot({ path: join(shots, 'accounts-people.png') });

    // The editor takes up the invitation, and sees the content, not the site's settings.
    const editor = await open();
    await editor.goto(invite);
    const welcome = editor.locator('[data-link="invite"]');
    await welcome.getByText('ion@example.com').waitFor();
    await welcome.locator('[data-name]').fill('Ion');
    await welcome.locator('[data-password]').fill(PASSWORD);
    await welcome.getByRole('button').click();
    await editor.locator('[data-nav="pages"]').waitFor();
    for (const hidden of ['messages', 'settings', 'theme', 'types', 'import', 'people'])
      assert((await editor.locator(`[data-nav="${hidden}"]`).count()) === 0, `an editor does not see ${hidden}`);
    await editor.locator('[data-open]').first().click();
    await editor.locator('.builder:not([hidden])').waitFor();
    assert((await editor.locator('[data-site-mode], [data-theme-mode], [data-theme]').count()) === 0, 'an editor has no site or theme buttons in the builder');
    await editor.frameLocator('iframe').locator('h1').first().waitFor();
    assert(true, 'an editor opens a page in the builder');

    // Signing out, a wrong password, then the right one.
    await owner.locator('[data-sign-out]').click();
    const signIn = owner.locator('[data-sign-in]');
    await signIn.waitFor();
    await signIn.locator('[data-email]').fill('ana@example.com');
    await signIn.locator('[data-password]').fill('not the password');
    await signIn.getByRole('button').click();
    await signIn.getByText('that address and password do not match').waitFor();
    assert(true, 'a wrong password is refused');
    await signIn.locator('[data-password]').fill(PASSWORD);
    await signIn.getByRole('button').click();
    await owner.locator('[data-nav="people"]').click();
    const ion = owner.locator('[data-user="ion@example.com"]');
    await ion.getByText('ion@example.com').waitFor();
    assert(true, 'the owner signs in again, and Ion is there under his name');

    // A new link for Ion, a role, and removing him.
    await ion.locator('[data-new-link]').click();
    await owner.locator('[data-made-link]').getByText('ion@example.com').waitFor();
    await ion.locator('[data-role]').selectOption('owner');
    await owner.waitForFunction(() => document.querySelector('[data-user="ion@example.com"] [data-role]')?.value === 'owner');
    await owner.locator('[data-user="ana@example.com"] [data-role]').isDisabled();
    await ion.locator('[data-remove]').click();
    await ion.locator('[data-remove-sure]').click();
    await ion.waitFor({ state: 'detached' });
    assert(true, 'the owner makes a new link, changes a role and removes someone');

    assert(errors.length === 0, `no errors in the browser ${errors.join(' | ')}`);
  } catch (error) {
    if (shots) await browser.contexts()[0]?.pages()[0]?.screenshot({ path: join(shots, 'failure.png') }).catch(() => {});
    throw error;
  } finally {
    await browser.close();
    server.kill();
  }
  rmSync(dir, { recursive: true, force: true });
  console.log('\nAccounts work.');
})().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
