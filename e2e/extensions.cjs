/**
 * An extension in a real browser (ADR 0026): installed from its file after the
 * owner has read what it asks for, its screen kept, what it offers on a block
 * and on a page run in the builder, then removed with what it kept.
 *
 *   node e2e/extensions.cjs [folder for screenshots]
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
const PORT = 4397;

(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'uhlaka-e2e-extensions-'));
  const db = join(dir, 'site.db');
  const shots = process.argv[2];
  cli('init', db);
  const packed = execFileSync('bun', ['tools/pack-extension.ts', 'test/fixtures/extension', dir], { cwd: root, encoding: 'utf8' }).trim().split('  ')[1];

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

  const browser = await coverage.launch(chromium, 'extensions');
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const canvas = page.frameLocator('iframe');
    await page.goto(url);

    // Installed only after the owner has read what it asks for.
    await page.locator('[data-nav="extensions"]').click();
    await page.locator('[data-no-extensions]').waitFor();
    await page.locator('[data-extension-file]').setInputFiles(packed);
    const asks = await page.locator('[data-asks]').innerText();
    assert(asks.includes('api.shout.example') && asks.includes('Settings: Key') && asks.includes('“Louder” on a block') && asks.includes("see the site's pictures, for: Look"), 'before it is installed, the owner reads what it asks for, the pictures it would see among it');
    if (shots) await page.screenshot({ path: join(shots, 'extension-offer.png') });
    await page.locator('[data-accept]').click();
    await page.locator('[data-extension="shout"]').waitFor();
    assert((await page.locator('[data-offer]').count()) === 0, 'accepted, it is installed and listed');

    // Off, it has no screen; on again, its screen keeps its settings, and a secret is never shown again.
    await page.locator('[data-extension-on]').uncheck();
    await page.locator('[data-extension-view]').first().waitFor({ state: 'detached' });
    await page.locator('[data-extension-on]').check();
    await page.locator('[data-extension-view="shout.settings"]').click();
    await page.locator('[data-extension-add]').click();
    await page.locator('[data-extension-save]').click();
    await page.getByText('Name is needed').waitFor();
    await page.locator('[data-field="name"]').fill('Main');
    await page.locator('[data-field="key"]').fill('sk-very-secret');
    await page.locator('[data-field="style"]').selectOption('stars');
    await page.locator('[data-field="loud"]').uncheck();
    await page.locator('[data-extension-save]').click();
    await page.locator('[data-row]').waitFor();
    const row = await page.locator('[data-row]').innerText();
    assert(row.includes('Main') && row.includes('••••••') && !row.includes('sk-very-secret'), 'its screen keeps a row; the secret is never shown again');
    await page.locator('[data-extension-edit]').click();
    assert((await page.locator('[data-field="key"]').inputValue()) === '', 'changing a row does not show the secret either');
    await page.locator('[data-field="name"]').fill('Main settings');
    await page.locator('[data-extension-save]').click();
    await page.getByText('Main settings').waitFor();
    assert((await page.locator('[data-row] .badge[data-tone="warning"]').innerText()) === 'stars', 'a field the screen shows as a badge has the tone it gives its value');

    // Its screen's buttons run its actions. A button shows only on a row that meets its condition.
    assert((await page.locator('[data-view-button^="rotate/"]').count()) === 0, 'a row that is not loud has no "New key"');
    await page.locator('[data-extension-edit]').click();
    await page.locator('[data-field="loud"]').check();
    await page.locator('[data-extension-save]').click();
    await page.locator('[data-view-button^="rotate/"]').click();
    await page.getByText('Make a new key?').waitFor();
    await page.locator('[data-ask="note"]').fill('lost');
    await page.locator('[data-view-sure]').click();
    const rowId = await page.locator('[data-row]').getAttribute('data-row');
    await page.locator('[data-reveal]', { hasText: `sk-${rowId}-4` }).waitFor();
    if (shots) await page.screenshot({ path: join(shots, 'extension-reveal.png') });
    assert(true, 'it asks what the action asks, then for a yes, and shows once what the answer reveals');

    // A button opens another screen; an action's answer can too.
    await page.locator('[data-view-button="shout.log/"]').click();
    await page.locator('[data-view-id="shout.log"] [data-row]', { hasText: 'lost' }).waitFor();
    assert((await page.locator('[data-extension-add]').count()) === 0, 'the log is read, and has no form to add to it');
    await page.locator('[data-extension-delete]').click();
    await page.locator('[data-extension-delete-sure]').click();
    await page.locator('[data-view-id="shout.log"] [data-row]').waitFor({ state: 'detached' });
    assert(true, 'a row goes only after a second yes');
    await page.locator('[data-nav="extensions"]').click();
    await page.locator('[data-extension-view="shout.settings"]').click();
    await page.locator('[data-view-button="open/"]').click();
    await page.locator('[data-view-id="shout.log"]').waitFor();
    assert(true, 'an action that answers with a view opens it');

    // Tabs: one view at a time; a form over an action asks its questions and runs it.
    await page.locator('[data-nav="extensions"]').click();
    await page.locator('[data-extension-view="shout.more"]').click();
    await page.locator('[data-view-id="shout.log"]').waitFor();
    await page.locator('[data-view-tab="1"]').click();
    await page.locator('[data-view-form="rotate"] [data-ask="note"]').fill('again');
    await page.locator('[data-view-submit]').click();
    await page.locator('[data-reveal]', { hasText: 'sk-none-5' }).waitFor();
    await page.locator('[data-view-tab="0"]').click();
    await page.locator('[data-view-id="shout.log"] [data-row]', { hasText: 'again' }).waitFor();
    if (shots) await page.screenshot({ path: join(shots, 'extension-tabs.png') });
    assert(true, "tabs show one view at a time, and an action's form runs it");

    // In the builder: on the block being edited, and on the page, each answer is a change like any other.
    await page.locator('[data-nav="pages"]').click();
    await page.locator('button[data-open=""]').click();
    await page.locator('.builder:not([hidden])').waitFor();
    const before = await canvas.locator('h1').innerText();
    await canvas.locator('h1').click();
    await page.locator('[data-extension-action="shout/louder"]').click();
    await canvas.locator('h1', { hasText: `*${before}*` }).waitFor();
    assert(true, 'what it offers on a block changes that block on the page');
    if (shots) await page.screenshot({ path: join(shots, 'extension-block.png') });
    await page.locator('button[title="Undo"]').click();
    await canvas.locator('h1', { hasText: new RegExp(`^${before.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }).waitFor();
    assert(true, 'and is undone like any change');
    await page.locator('[data-back]').click();
    await page.locator('button[data-open="about"]').click();
    await page.locator('[data-extension-tools="page"]').waitFor();
    await page.locator('[data-extension-action="shout/title"]').click();
    await page.locator('[data-ask="language"]').selectOption('en');
    await page.locator('[data-run]').click();
    await page.locator('.doc', { hasText: '*About* (en)' }).waitFor();
    if (shots) await page.screenshot({ path: join(shots, 'extension-page.png') });
    assert(true, 'what it offers on a page asks its question, then changes the page');

    // What was published before is kept, and brought back as a change.
    await page.locator('.bar button.primary').click();
    await page.waitForFunction(() => document.querySelector('.bar button.primary')?.disabled);
    await page.locator('[data-versions-show]').click();
    await page.locator('[data-version]').first().waitFor();
    assert((await page.locator('[data-version]').first().innerText()).includes('*About* (en)'), 'the publication is listed, newest first');
    await page.locator('[data-version]').last().locator('[data-version-restore]').click();
    await page.locator('.doc', { hasText: /^About$/ }).waitFor();
    if (shots) await page.screenshot({ path: join(shots, 'versions.png') });
    assert(true, 'an older one comes back into the editor, as a change to publish or undo');

    // With a second language, an action for each language fills in every translation of the page (ADR 0034).
    await page.locator('[data-back]').click();
    await page.locator('[data-nav="settings"]').click();
    await page.locator('[data-language-new]').fill('ro');
    const siteSaved = page.waitForResponse((r) => r.url().endsWith('/api/site') && r.request().method() === 'PUT');
    await page.locator('[data-language-add]').click();
    await siteSaved;
    await page.locator('[data-back]').click();
    await page.locator('button[data-open="about"]').click();
    await page.getByRole('button', { name: 'Back to the page' }).click();
    await page.locator('[data-extension-action="shout/stamp"][data-each-language]').click();
    await page.locator('[data-each-said]').waitFor();
    if (shots) await page.screenshot({ path: join(shots, 'extension-each-language.png') });
    await page.locator('[data-back]').click();
    await page.locator('button[data-open="ro/about"]').click();
    await page.locator('.doc', { hasText: '[ro] About' }).waitFor();
    assert((await page.locator('[data-extension-action="shout/stamp"][data-each-language]').count()) === 0, 'it made the translation; on a translation it is an action like any other');
    await page.locator('[data-extension-action="shout/stamp"]').click();
    await page.locator('.doc', { hasText: '[ro] [ro] About' }).waitFor();
    assert(true, 'run there, it changes that translation as a change to look at');

    // A block an extension adds to the site's pages (ADR 0062 d6): offered in the list by its own name, drawn on the page.
    const news = join(dir, 'news.uhlaka-extension');
    writeFileSync(
      news,
      JSON.stringify({
        format: 'uhlaka.extension/3',
        manifest: {
          name: 'news',
          displayName: 'Newsletter',
          version: '1.0.0',
          collections: [{ name: 'events', label: 'Events', fields: [{ key: 'title', label: 'Title', kind: 'text', required: true }, { key: 'starts', label: 'Starts', kind: 'datetime' }] }],
          actions: [{ name: 'signup', label: 'Sign up' }, { name: 'numbers', label: 'Numbers' }],
          routes: [{ path: 'signup', action: 'signup', methods: ['POST'] }],
          views: [
            { spec: 'uhlaka.view/1', id: 'news.report', title: 'Report', type: 'report', action: 'numbers' },
            { spec: 'uhlaka.view/1', id: 'news.calendar', title: 'Calendar', type: 'calendar', collection: 'events', date: 'starts', name: 'title' },
          ],
          blocks: [{ name: 'signup', label: 'Newsletter sign-up', fields: [{ key: 'email', label: 'E-mail', kind: 'email', required: true }, { key: 'agree', label: 'I want it', kind: 'consent' }], submit: 'Sign up', route: 'signup' }],
        },
        code: `export const actions = {
          signup: async () => null,
          numbers: async (input) => ({ totals: [{ label: 'Visitors', value: input.range === '7' ? 7 : 1 }], chart: { labels: ['Mon', 'Tue'], series: [{ label: 'Visitors', values: [1, 2] }] }, lists: [{ title: 'Pages', rows: [{ label: '/', value: 3 }] }] }),
        };`,
      }),
    );
    await page.locator('[data-back]').click();
    await page.locator('[data-nav="extensions"]').click();
    await page.locator('[data-extension-file]').setInputFiles(news);
    assert((await page.locator('[data-asks]').innerText()).includes("add blocks to the site's pages: Newsletter sign-up"), 'before it is installed, the owner reads the blocks it adds');
    await page.locator('[data-accept]').click();
    await page.locator('[data-extension="news"]').waitFor();
    await page.locator('[data-nav="pages"]').click();
    await page.locator('button[data-open="about"]').click();
    await page.locator('[data-add-extension="news/signup"]').click();
    await canvas.locator('form[data-extension-block="news/signup"] input[name="email"]').waitFor();
    assert((await page.locator('[data-field-extension]').inputValue()) === 'news/signup', 'its block is in the list by its own name, drawn on the page, and named in the block\'s settings');
    if (shots) await page.screenshot({ path: join(shots, 'extension-public-block.png') });
    await page.locator('button[title="Undo"]').click();
    await canvas.locator('form[data-extension-block]').waitFor({ state: 'detached' });

    // Its screens (ADR 0062 d7): a report from what an action answers, for the time chosen; a calendar of its rows by month.
    await page.locator('[data-back]').click();
    await page.locator('[data-nav="extensions"]').click();
    await page.locator('[data-extension-view="news.report"]').click();
    await page.locator('[data-report-total="0"]', { hasText: '1' }).waitFor();
    await page.locator('[data-report-range="7"]').click();
    await page.locator('[data-report-total="0"]', { hasText: '7' }).waitFor();
    assert((await page.locator('[data-report-chart] rect').count()) === 2 && (await page.locator('[data-report-list="0"]').innerText()).includes('/'), 'a report shows its numbers, chart and lists for the time chosen');
    if (shots) await page.screenshot({ path: join(shots, 'extension-report.png') });
    await page.locator('[data-nav="extensions"]').click();
    await page.locator('[data-extension-view="news.calendar"]').click();
    const today = new Date().toISOString().slice(0, 10);
    await page.locator(`[data-calendar-add="${today}"]`).click();
    assert((await page.locator('[data-field="starts"]').inputValue()) === `${today}T09:00`, 'a row added on a day starts on that day');
    await page.locator('[data-field="title"]').fill('Workshop');
    await page.locator('[data-extension-save]').click();
    await page.locator(`[data-day="${today}"] [data-calendar-row]`, { hasText: '09:00 Workshop' }).waitFor();
    await page.locator('[data-calendar-later]').click();
    await page.locator('[data-calendar-row]').waitFor({ state: 'detached' });
    await page.locator('[data-calendar-earlier]').click();
    await page.locator('[data-calendar-row]').click();
    assert((await page.locator('[data-field="title"]').inputValue()) === 'Workshop', 'a calendar shows its rows on their days, by month, and opens them');
    if (shots) await page.screenshot({ path: join(shots, 'extension-calendar.png') });
    await page.locator('[data-nav="pages"]').click();
    await page.locator('button[data-open="about"]').click();

    // Removed, with what it kept.
    await page.locator('[data-back]').click();
    await page.locator('[data-nav="extensions"]').click();
    for (const name of ['news', 'shout']) {
      await page.locator(`[data-extension="${name}"] [data-extension-remove]`).click();
      await page.locator('[data-extension-remove-sure]').click();
      await page.locator(`[data-extension="${name}"]`).waitFor({ state: 'detached' });
    }
    await page.locator('[data-no-extensions]').waitFor();
    assert(true, 'removed, it is gone with what it kept');
    assert(errors.length === 0, `no errors in the browser ${errors.join(' | ')}`);
  } catch (error) {
    if (shots) await browser.contexts()[0]?.pages()[0]?.screenshot({ path: join(shots, 'failure.png') }).catch(() => {});
    throw error;
  } finally {
    await browser.close();
    server.kill();
  }
  rmSync(dir, { recursive: true, force: true });
  console.log('\nExtensions work.');
})().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
