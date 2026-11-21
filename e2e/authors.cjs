/**
 * Authors and contributors, in a real browser (ADR 0055): an author who
 * writes and publishes her own post and sees nothing of the site's pages; a
 * contributor who sends his for review; the owner who reads it, sends it back,
 * then publishes it; the name and the few words each person sets, on the site.
 *
 *   node e2e/authors.cjs [folder for screenshots]
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
const PORT = 4411;
const PUBLIC = `http://127.0.0.1:${PORT}`;
const PASSWORD = 'a long enough password';

(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'thecms-e2e-authors-'));
  const db = join(dir, 'site.db');
  const shots = process.argv[2];
  cli('init', db);
  // Three people with an account, as the owner would have invited them.
  execFileSync(
    'bun',
    [
      '-e',
      `const { Store } = await import('./src/site/store.ts');
       const store = await Store.open(process.argv[1]);
       for (const [email, name, role] of [['olga@example.com', 'Olga', 'owner'], ['ana@example.com', 'Ana Pop', 'author'], ['mihai@example.com', 'Mihai', 'contributor']])
         await store.addUser({ email, name, role, password: '${PASSWORD}' });
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

  const browser = await coverage.launch(chromium, 'authors');
  try {
    const errors = [];
    /** Each person in a browser of their own, signed in. */
    const signIn = async (email) => {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.goto(`${PUBLIC}/admin/`);
      const form = page.locator('[data-sign-in]');
      await form.locator('[data-email]').fill(email);
      await form.locator('[data-password]').fill(PASSWORD);
      await form.getByRole('button').click();
      await page.locator('[data-nav="media"]').waitFor();
      return page;
    };
    const write = async (page, title) => {
      await page.locator('[data-new="post"]').click();
      await page.getByPlaceholder(/title/i).fill(title);
      await page.locator('[data-list="post"] form button[type="submit"]').click();
      await page.locator('.builder:not([hidden])').waitFor();
      await page.frameLocator('iframe').locator('h1', { hasText: title }).waitFor();
    };

    // The author starts at the posts, and sees nothing of the pages, the sections or the statistics.
    const ana = await signIn('ana@example.com');
    await ana.locator('[data-list="post"]').waitFor();
    for (const hidden of ['pages', 'sections', 'stats', 'review', 'settings', 'people'])
      assert((await ana.locator(`[data-nav="${hidden}"]`).count()) === 0, `an author does not see ${hidden}`);
    assert((await ana.locator('[data-list="post"] [data-open]').count()) === 0, "an author's list shows her own posts only");

    // She writes a few words about herself.
    await ana.locator('[data-nav="me"]').click();
    assert((await ana.locator('[data-profile-name]').inputValue()) === 'Ana Pop', 'Me shows her name');
    await ana.locator('[data-profile-bio]').fill('Ana restores old doors.');
    await ana.locator('[data-profile] button[type="submit"]').click();
    await ana.locator('[data-profile-saved]').waitFor();
    assert(true, 'she sets the words about her');

    // She writes and publishes a post; the canvas shows her name under its title.
    await ana.locator('[data-nav="posts"]').click();
    await write(ana, 'Oak door');
    await ana.frameLocator('iframe').locator('.post-author', { hasText: 'by Ana Pop' }).waitFor();
    assert(true, 'the canvas names her as its author');
    assert((await ana.locator('[data-entry-author]').count()) === 0, 'an author cannot give her post away');
    await ana.locator('.bar .primary').click();
    await ana.locator('.bar .state', { hasText: 'Published' }).waitFor();
    assert(true, 'an author publishes her own post');
    if (shots) await ana.screenshot({ path: join(shots, 'author-editor.png') });

    // The contributor writes a post and sends it for review.
    const mihai = await signIn('mihai@example.com');
    await write(mihai, 'Bean soup');
    assert((await mihai.locator('.bar [data-ask-review]').count()) === 1, 'a contributor has "Send for review" instead of "Publish"');
    await mihai.locator('[data-ask-review]').click();
    await mihai.locator('[data-review-state="waiting"]').waitFor();
    assert(await mihai.locator('[data-ask-review]').isDisabled(), 'sent, it waits for review');

    // The owner sees it under "To review", reads it, and sends it back with a note.
    const olga = await signIn('olga@example.com');
    await olga.locator('[data-nav="review"]', { hasText: '(1)' }).waitFor();
    await olga.locator('[data-nav="review"]').click();
    const waiting = olga.locator('[data-review="bean-soup"]');
    await waiting.getByText('by Mihai').waitFor();
    if (shots) await olga.screenshot({ path: join(shots, 'review-list.png') });
    await waiting.getByRole('button').click();
    await olga.locator('.builder:not([hidden])').waitFor();
    await olga.locator('[data-review-note]').fill('Less salt, and a picture.');
    await olga.locator('[data-review-back]').click();
    await olga.locator('[data-review-state="returned"]').waitFor();
    assert(true, 'the owner sends it back with a note');

    // The contributor reads the note, changes it, and sends it again.
    await mihai.reload();
    await mihai.locator('[data-list="post"] [data-status-of="bean-soup"]', { hasText: 'Sent back' }).waitFor();
    await mihai.locator('[data-open="bean-soup"]').click();
    await mihai.locator('[data-review-returned]', { hasText: 'Less salt, and a picture.' }).waitFor();
    assert(true, 'the contributor reads why it came back');
    await mihai.locator('[data-ask-review]').click();
    await mihai.locator('[data-review-state="waiting"]').waitFor();

    // The owner publishes it; then it is no longer the contributor's to change.
    await olga.reload();
    await olga.locator('[data-nav="review"]').click();
    await olga.locator('[data-review="bean-soup"] button').click();
    await olga.locator('.builder:not([hidden])').waitFor();
    await olga.locator('.bar .primary').click();
    await olga.locator('.bar .state', { hasText: 'Published' }).waitFor();
    await olga.locator('[data-back]').click();
    await olga.locator('[data-nav="review"]').click();
    await olga.locator('[data-review-none]').waitFor();
    assert(true, 'published, nothing waits for review');
    await mihai.reload();
    await mihai.locator('[data-open="bean-soup"]').click();
    await mihai.locator('[data-review-published]').waitFor();
    assert(true, 'a published entry is no longer the contributor\'s');

    // The owner names the author of a post, and sees each one's author in the list.
    await olga.locator('[data-nav="posts"]').click();
    await olga.locator('[data-author-of="oak-door"]', { hasText: 'Ana Pop' }).waitFor();
    await olga.locator('[data-author-of="bean-soup"]', { hasText: 'Mihai' }).waitFor();
    assert(true, 'the list says who wrote each post');
    await olga.locator('[data-open="bean-soup"]').click();
    await olga.locator('[data-entry-author]').selectOption({ label: 'Ana Pop' });
    await olga.frameLocator('iframe').locator('.post-author', { hasText: 'by Ana Pop' }).waitFor();
    assert(true, 'the owner gives a post to another author');

    // On the site: her name under the title, and her words at the end.
    const site = await (await fetch(`${PUBLIC}/blog/oak-door/`)).text();
    assert(site.includes('by Ana Pop') && site.includes('Ana restores old doors.'), 'the site names who wrote the post, and what she says of herself');

    // The owner's People: the four roles, and to whom a removed person's posts go.
    await olga.locator('[data-back]').click();
    await olga.locator('[data-nav="people"]').click();
    const options = await olga.locator('[data-invite-role] option').allTextContents();
    assert(['Owner', 'Editor', 'Author', 'Contributor'].every((r) => options.includes(r)), `the four roles: ${options.join(', ')}`);
    const row = olga.locator('[data-user="ana@example.com"]');
    await row.locator('[data-remove]').click();
    await row.locator('[data-heir]').selectOption({ label: 'Mihai' });
    if (shots) await olga.screenshot({ path: join(shots, 'people-roles.png') });
    await row.locator('[data-remove-sure]').click();
    await row.waitFor({ state: 'detached' });
    await olga.reload();
    await olga.locator('[data-nav="posts"]').click();
    await olga.locator('[data-author-of="oak-door"]', { hasText: 'Mihai' }).waitFor();
    assert(true, 'someone removed leaves their posts to whom the owner chose');

    assert(errors.length === 0, `no errors in the browser ${errors.join(' | ')}`);
  } catch (error) {
    if (shots) await browser.contexts()[0]?.pages()[0]?.screenshot({ path: join(shots, 'failure.png') }).catch(() => {});
    throw error;
  } finally {
    await browser.close();
    server.kill();
  }
  rmSync(dir, { recursive: true, force: true });
  console.log('\nAuthors and contributors work.');
})().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
