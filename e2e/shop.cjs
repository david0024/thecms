/**
 * The shop in a real browser (ADR 0065, PR a): turned on in Settings → Shop,
 * which makes a type of products; a product written with a price, a sale
 * price, variants and stock, published, and its page offering "Add to cart";
 * another type marked as selling.
 *
 *   node e2e/shop.cjs [folder for screenshots]
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
const PORT = 4431;

(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'thecms-e2e-shop-'));
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

  const browser = await coverage.launch(chromium, 'shop');
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('dialog', (d) => d.accept());
    const canvas = page.frameLocator('iframe');
    const saved = () => page.locator('.status[data-state="saved"]').waitFor();
    await page.goto(url);

    // Off: only the switch.
    await page.locator('[data-nav="settings"]').click();
    await page.locator('[data-shop-on]').waitFor();
    assert(!(await page.locator('[data-shop-on]').isChecked()), 'Settings show the shop off');
    assert((await page.locator('[data-shop-vat]').count()) === 0, 'while off, nothing else is shown');

    // On: a type of products appears, VAT and its rates can be changed.
    await page.locator('[data-shop-on]').check();
    await page.locator('[data-nav="products"]').waitFor({ state: 'attached' });
    assert(true, 'turning the shop on makes a type "Products"');
    await page.locator('[data-shop-rates]').fill('21, 11, 5');
    const put = page.waitForResponse((r) => r.url().endsWith('/api/shop') && r.request().method() === 'PUT');
    await page.locator('[data-shop-rates]').blur();
    assert((await (await put).json()).settings.rates.join(',') === '21,11,5', 'the VAT rates are saved');
    if (shots) await page.screenshot({ path: join(shots, 'shop-settings.png') });

    // A product with a price, a sale price, a code, a rate and two sizes, each counted.
    await page.reload();
    await page.locator('[data-nav="products"]').click();
    await page.locator('[data-new="products"]').click();
    await page.getByPlaceholder('Page title').fill('Tee');
    await page.getByRole('button', { name: 'Create' }).click();
    await canvas.locator('article.post h1').waitFor();
    await page.locator('[data-product-price]').fill('100');
    await page.locator('[data-product-price]').blur();
    await page.locator('[data-product-sale]').fill('80,50');
    await page.locator('[data-product-sale]').blur();
    await page.locator('[data-product-sku]').fill('TEE');
    await page.locator('[data-product-sku]').blur();
    await page.locator('[data-product-vat]').selectOption('11');
    await page.locator('[data-product-add-option]').click();
    const option = page.locator('[data-product-option]').first();
    await option.locator('input').first().fill('Size');
    await option.locator('input').first().blur();
    await option.locator('input').nth(1).fill('S, M');
    await option.locator('input').nth(1).blur();
    await page.locator('[data-product-variant="M"]').waitFor();
    await page.locator('[data-product-variant="M"] input').first().fill('120');
    await page.locator('[data-product-variant="M"] input').first().blur();
    await page.locator('[data-product-variant="M"] input').nth(1).fill('110');
    await page.locator('[data-product-variant="M"] input').nth(1).blur();
    await page.locator('[data-product-variant="M"] input').nth(2).fill('TEE-M');
    await page.locator('[data-product-variant="M"] input').nth(2).blur();
    await page.locator('[data-product-counted]').check();
    await saved();
    await page.locator('[data-product-stock="S"]').fill('3');
    await page.locator('[data-product-stock="M"]').fill('0');
    await page.locator('[data-product-save-stock]').click();
    await page.getByText('✓', { exact: false }).waitFor();
    assert(true, 'the price, variants and stock are written');
    if (shots) await page.screenshot({ path: join(shots, 'shop-product.png') });
    // A second option, then taken away again.
    await page.locator('[data-product-add-option]').click();
    await page.locator('[data-product-option]').nth(1).getByRole('button').click();
    await page.getByRole('button', { name: 'Publish' }).click();
    await page.getByText('Published', { exact: true }).waitFor();
    await page.locator('[data-back]').click();

    const tee = await (await page.request.get(site('/products/tee/'))).text();
    assert(tee.includes('action="/_/cart"'), 'the product page offers "Add to cart"');
    assert(tee.includes('<option value="S">'), 'a size in stock can be chosen');
    assert(/<option value="M" disabled/.test(tee), 'a size out of stock cannot');

    // A product without variants, its stock counted.
    await page.locator('[data-nav="products"]').click();
    await page.locator('[data-new="products"]').click();
    await page.getByPlaceholder('Page title').fill('Mug');
    await page.getByRole('button', { name: 'Create' }).click();
    await canvas.locator('article.post h1').waitFor();
    await page.locator('[data-product-price]').fill('12');
    await page.locator('[data-product-price]').blur();
    await page.locator('[data-product-counted]').check();
    await saved();
    await page.locator('[data-product-stock=""]').fill('5');
    await page.locator('[data-product-save-stock]').click();
    await page.getByText('✓', { exact: false }).waitFor();
    await page.getByRole('button', { name: 'Publish' }).click();
    await page.getByText('Published', { exact: true }).waitFor();
    await page.locator('[data-back]').click();
    const mug = await (await page.request.get(site('/products/mug/'))).text();
    assert(mug.includes('In stock') || mug.includes('În stoc'), 'the mug is in stock');

    // Another type marked as selling.
    await page.locator('[data-nav="types"]').click();
    await page.locator('[data-new-type]').click();
    await page.locator('[data-type-name]').fill('Courses');
    await page.locator('[data-type-singular]').fill('Course');
    await page.locator('[data-type-sells]').check();
    assert((await page.locator('[data-type-schema]').count()) === 0, 'a type that sells is one of products');
    await page.locator('[data-type-save]').click();
    await page.locator('[data-nav="courses"]').waitFor();
    assert(true, 'another type sells');

    // Off again: the switch alone.
    await page.reload();
    await page.locator('[data-nav="settings"]').click();
    await page.locator('[data-shop-vat]').uncheck();
    await page.locator('[data-shop-rates]').waitFor({ state: 'detached' });
    await page.locator('[data-shop-on]').uncheck();
    await page.locator('[data-shop-vat]').waitFor({ state: 'detached' });
    assert(true, 'the shop is turned off again');
    assert(errors.length === 0, `no errors in the browser ${errors.join(' | ')}`);
  } catch (error) {
    if (shots) await browser.contexts()[0]?.pages()[0]?.screenshot({ path: join(shots, 'failure.png') }).catch(() => {});
    throw error;
  } finally {
    await browser.close();
    server.kill();
  }
  rmSync(dir, { recursive: true, force: true });
  console.log('\nThe shop works.');
})().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
