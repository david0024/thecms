/**
 * Relations between entries and the further kinds of field (ADR 0052), in a
 * real browser: a type with a link to another, a number, yes or no and a
 * choice; an entry linked by picking a title; both sides drawn; the entry
 * linked to says where it is used, and deleting it takes it out.
 *
 *   node e2e/relations.cjs [folder for screenshots]
 */
const { chromium } = require('playwright');
const coverage = require('./coverage.cjs');
const { spawn, execFileSync } = require('node:child_process');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const root = join(__dirname, '..');
const cli = (...args) => execFileSync('bun', ['src/site/cli.ts', ...args], { cwd: root, encoding: 'utf8' });
const assert = (condition, message) => {
  if (!condition) throw new Error(`FAILED: ${message}`);
  console.log(`ok  ${message}`);
};
const PORT = 4393;

(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'thecms-e2e-relations-'));
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

  const browser = await coverage.launch(chromium, 'relations');
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const canvas = page.frameLocator('iframe');
    const saved = () => page.locator('.status[data-state="saved"]').waitFor();
    await page.goto(url);

    // Two types: clients, and projects that link to them.
    await page.locator('[data-nav="types"]').click();
    await page.locator('[data-new-type]').click();
    await page.locator('[data-type-name]').fill('Clients');
    await page.locator('[data-type-singular]').fill('Client');
    await page.locator('[data-type-save]').click();
    await page.locator('[data-type="clients"]').waitFor();

    await page.locator('[data-new-type]').click();
    await page.locator('[data-type-name]').fill('Projects');
    await page.locator('[data-type-singular]').fill('Project');
    const addField = async (label, kind) => {
      await page.locator('[data-type-add-field]').click();
      const row = page.locator('[data-type-field]').last();
      await row.locator('input').first().fill(label);
      await row.locator('[data-type-field-kind]').selectOption(kind);
      return row;
    };
    const client = await addField('Client', 'entries');
    assert((await client.locator('[data-type-field-to]').inputValue()) !== '', 'a link field starts with a type to link to');
    await client.locator('[data-type-field-to]').selectOption('clients');
    await addField('Area', 'number');
    await addField('Available', 'yesno');
    const state = await addField('State', 'choice');
    await state.locator('[data-type-field-choices]').fill('New\nSold');
    const partners = await addField('Partners', 'entries');
    await partners.locator('[data-type-field-to]').selectOption('clients');
    await partners.locator('[data-type-field-many]').check();
    for (const [label, kind] of [['Notes', 'longtext'], ['Finished', 'date'], ['Their site', 'link'], ['Sheet', 'file'], ['Plan', 'image']]) await addField(label, kind);
    if (shots) await page.screenshot({ path: join(shots, 'relations-type.png') });
    await page.locator('[data-type-save]').click();
    await page.locator('[data-type="projects"]').waitFor();
    assert(true, 'a type is made with a link to another type, a number, yes or no and a choice');

    // Two clients, published.
    for (const name of ['Acme', 'Zeta']) {
      await page.locator('[data-nav="clients"]').click();
      await page.locator('[data-new="clients"]').click();
      await page.getByPlaceholder('Page title').fill(name);
      await page.getByRole('button', { name: 'Create' }).click();
      await canvas.locator('article.post h1').waitFor();
      await page.getByRole('button', { name: 'Publish' }).click();
      await page.getByText('Published', { exact: true }).waitFor();
      await page.locator('[data-back]').click();
    }

    // A project that links to it, picked by its title.
    await page.locator('[data-nav="projects"]').click();
    await page.locator('[data-new="projects"]').click();
    await page.getByPlaceholder('Page title').fill('Kitchen');
    await page.getByRole('button', { name: 'Create' }).click();
    await canvas.locator('article.post h1').waitFor();
    const field = page.locator('[data-entry-field="client"]');
    await field.locator('[data-linked-add]').click();
    await field.locator('[data-linked-find]').fill('nothing like it');
    assert((await field.locator('.hint').innerText()).includes('No title'), 'a search that finds nothing says so');
    await field.locator('[data-linked-find]').fill('acm');
    await field.locator('[data-linked-pick="acme"]').click();
    await field.locator('[data-linked="acme"]').waitFor();
    await canvas.locator('.entry-field[data-field="client"] .entry-links a[href="/clients/acme/"]').waitFor();
    assert(true, 'a client is picked by its title and shown on the project at once');
    // Several partners, put in order by hand.
    const many = page.locator('[data-entry-field="partners"]');
    for (const slug of ['acme', 'zeta']) {
      await many.locator('[data-linked-add]').click();
      await many.locator(`[data-linked-pick="${slug}"]`).click();
    }
    await many.locator('[data-linked="zeta"]').getByRole('button', { name: 'Move up' }).click();
    await canvas.locator('.entry-field[data-field="partners"] li:first-child a[href="/clients/zeta/"]').waitFor();
    await many.locator('[data-linked="zeta"]').getByRole('button', { name: 'Move down' }).click();
    await canvas.locator('.entry-field[data-field="partners"] li:first-child a[href="/clients/acme/"]').waitFor();
    await many.locator('[data-linked="zeta"]').getByRole('button', { name: 'Remove' }).click();
    await canvas.locator('.entry-field[data-field="partners"] a[href="/clients/zeta/"]').waitFor({ state: 'detached' });
    await many.locator('[data-linked-add]').click();
    await many.getByRole('button', { name: 'Cancel' }).click();
    assert((await many.locator('[data-linked]').count()) === 1, 'several entries are added, moved up or down and taken out');
    await page.locator('[data-entry-field="area"] input').fill('12,5');
    await page.keyboard.press('Tab');
    await page.locator('[data-entry-field="available"] select').selectOption('yes');
    await page.locator('[data-entry-field="state"] select').selectOption('Sold');
    await canvas.locator('.entry-field[data-field="state"] dd', { hasText: 'Sold' }).waitFor();
    await canvas.locator('.entry-field[data-field="available"] dd', { hasText: 'Yes' }).waitFor();
    await canvas.locator('.entry-field[data-field="area"] dd', { hasText: '12.5' }).waitFor();
    assert(true, 'a number, yes or no and a choice are drawn as their kinds');
    await saved();
    if (shots) await page.screenshot({ path: join(shots, 'relations-entry.png') });
    await page.getByRole('button', { name: 'Publish' }).click();
    await page.getByText('Published', { exact: true }).waitFor();
    await page.locator('[data-back]').click();

    // The client shows the projects that name it, and says where it is used before it is deleted.
    await page.locator('[data-nav="clients"]').click();
    await page.locator('[data-open="acme"]').click();
    await canvas.locator('[data-related="projects/client"] a[href="/projects/kitchen/"]').first().waitFor();
    assert((await canvas.locator('[data-related="projects/client"] h2').innerText()) === 'Projects · Client', 'the client shows, by itself, the projects that link to it, by the field they link through');
    assert((await page.locator('[data-used-by]').innerText()).includes('Kitchen'), 'its settings say which entries link to it');
    // A list of entries in the client's own blocks: only the projects linked to it.
    await page.locator('[data-add="entries"]').click();
    await page.locator('[data-field-source]').selectOption('projects');
    await page.locator('[data-field-check="related"]').check();
    await canvas.locator('.b-entries h3 a[href="/projects/kitchen/"]').waitFor();
    assert((await canvas.locator('.b-entries h3 a').count()) === 1, 'a list block can show only the entries linked to the one shown');
    await saved();
    if (shots) await page.screenshot({ path: join(shots, 'relations-client.png') });

    const out = join(dir, 'out');
    cli('export', db, out);
    assert(readFileSync(join(out, 'clients/acme/index.html'), 'utf8').includes('href="/projects/kitchen/"'), 'published, the client leads to its project');
    assert(readFileSync(join(out, 'projects/kitchen/index.html'), 'utf8').includes('href="/clients/acme/"'), 'and the project to its client');

    await page.locator('[data-back]').click();
    await page.locator('[data-open="acme"]').click();
    await canvas.locator('article.post h1').waitFor();
    await page.getByRole('button', { name: 'Delete this entry' }).click();
    await page.locator('[data-list="clients"]').waitFor();
    await page.locator('[data-nav="projects"]').click();
    await page.locator('[data-open="kitchen"]').click();
    await canvas.locator('article.post h1').waitFor();
    assert((await page.locator('[data-entry-field="client"] [data-linked]').count()) === 0, 'a deleted client is taken out of the project that linked to it');
    assert((await canvas.locator('.entry-field[data-field="client"]').count()) === 0, 'and the project no longer shows it');
    assert(errors.length === 0, `no errors in the browser ${errors.join(' | ')}`);
  } catch (error) {
    if (shots) await browser.contexts()[0]?.pages()[0]?.screenshot({ path: join(shots, 'failure.png') }).catch(() => {});
    throw error;
  } finally {
    await browser.close();
    server.kill();
  }
  rmSync(dir, { recursive: true, force: true });
  console.log('\nRelations between entries work.');
})().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
