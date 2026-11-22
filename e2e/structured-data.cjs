/**
 * What the site says to search engines about the business and its entries,
 * in a real browser (ADR 0061): a local business with its address and hours,
 * and a type of products whose fields say what they are.
 *
 *   node e2e/structured-data.cjs [folder for screenshots]
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
const PORT = 4399;

(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'thecms-e2e-structured-'));
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

  const browser = await coverage.launch(chromium, 'structured-data');
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const canvas = page.frameLocator('iframe');
    const saved = () => page.locator('.status[data-state="saved"]').waitFor();
    const graph = (html) => {
      const json = /<script type="application\/ld\+json">([^<]*)<\/script>/.exec(html)?.[1];
      return json ? JSON.parse(json)['@graph'] : [];
    };
    const fetchUntil = async (path, done) => {
      let html = '';
      for (let i = 0; i < 40 && !done(html); i++) {
        if (html) await page.waitForTimeout(250);
        html = await (await page.request.get(site(path))).text();
      }
      return html;
    };
    await page.goto(url);

    // The business, its address and its hours, in Site settings.
    await page.locator('[data-nav="settings"]').click();
    // Search engines are told only with the site's address (ADR 0030).
    await page.getByLabel('Address (https://example.com)').fill('https://atelier.example');
    await page.getByLabel('Address (https://example.com)').press('Tab');
    await page.locator('[data-business] > summary').click();
    await page.locator('[data-business-kind]').selectOption('Bakery');
    for (const [key, value] of [['street', 'Str. Lungă 5'], ['city', 'Cluj'], ['country', 'ro'], ['phone', '+40 721 000 000'], ['currency', 'ron']]) {
      await page.locator(`[data-business-field="${key}"]`).fill(value);
      await page.locator(`[data-business-field="${key}"]`).press('Tab');
    }
    await page.locator('[data-business-day="0"]').fill('9 - 18');
    await page.locator('[data-business-day="0"]').press('Tab');
    await page.waitForFunction(() => document.querySelector('[data-business-day="0"]')?.value === '09:00-18:00');
    assert((await page.locator('[data-business-field="country"]').inputValue()) === 'RO', 'what is written is kept as search engines read it: hours, a country');
    if (shots) await page.screenshot({ path: join(shots, 'business.png') });
    const home = await fetchUntil('/', (html) => html.includes('"Bakery"'));
    const business = graph(home).find((d) => d['@type'] === 'Bakery');
    assert(business?.address?.addressLocality === 'Cluj' && business.openingHoursSpecification?.[0]?.opens === '09:00', 'the home page says the business is a bakery in Cluj, open Mondays from nine');

    // A type of products, its fields saying what they are.
    await page.getByRole('button', { name: 'Back to the page' }).click();
    await page.locator('[data-back]').click();
    await page.locator('[data-nav="types"]').click();
    await page.locator('[data-new-type]').click();
    await page.locator('[data-type-name]').fill('Products');
    await page.locator('[data-type-singular]').fill('Product');
    await page.locator('[data-type-schema]').selectOption('product');
    const addField = async (label, kind, means) => {
      await page.locator('[data-type-add-field]').click();
      const row = page.locator('[data-type-field]').last();
      await row.locator('input').first().fill(label);
      await row.locator('[data-type-field-kind]').selectOption(kind);
      if (means) await row.locator('[data-type-field-means]').selectOption(means);
      return row;
    };
    await addField('Price', 'number', 'price');
    await addField('In stock', 'yesno', 'inStock');
    const note = await addField('Note', 'longtext');
    assert((await note.locator('[data-type-field-means]').count()) === 0, 'a field that can mean nothing for a product is not asked what it means');
    await page.locator('[data-type-save]').click();
    await page.locator('[data-type="products"]').waitFor();

    // A product, published.
    await page.locator('[data-nav="products"]').click();
    await page.locator('[data-new="products"]').click();
    await page.getByPlaceholder('Page title').fill('Oak table');
    await page.getByRole('button', { name: 'Create' }).click();
    await canvas.locator('article.post h1').waitFor();
    await page.locator('[data-entry-field="price"] input').fill('3200');
    await page.keyboard.press('Tab');
    await page.locator('[data-entry-field="in_stock"] select').selectOption('yes');
    await saved();
    await page.getByRole('button', { name: 'Publish' }).click();
    await page.getByText('Published', { exact: true }).waitFor();
    const product = graph(await fetchUntil('/products/oak-table/', (html) => html.includes('"Product"'))).find((d) => d['@type'] === 'Product');
    assert(product?.offers?.price === 3200 && product.offers.priceCurrency === 'RON' && product.offers.availability === 'https://schema.org/InStock', 'the product says its price, in the currency of the site, and that it is in stock');
    assert(errors.length === 0, `no errors in the browser ${errors.join(' | ')}`);
  } catch (error) {
    if (shots) await browser.contexts()[0]?.pages()[0]?.screenshot({ path: join(shots, 'failure.png') }).catch(() => {});
    throw error;
  } finally {
    await browser.close();
    server.kill();
  }
  rmSync(dir, { recursive: true, force: true });
  console.log('\nThe business, events and products are said to search engines.');
})().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
