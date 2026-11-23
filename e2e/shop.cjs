/**
 * The shop in a real browser (ADR 0065): turned on in Settings → Shop,
 * which makes a type of products; a product written with a price, a sale
 * price, variants and stock, published, and its page offering "Add to cart";
 * the ways to pay and deliver set; a visitor filling a cart and placing an
 * order; the owner handling it in Orders; another type marked as selling.
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

    // How buyers pay, and how orders are delivered.
    await page.locator('[data-nav="settings"]').click();
    await page.locator('[data-shop-no-way]').waitFor();
    assert(true, 'without a way to pay and deliver, Settings say orders are not taken');
    await page.locator('[data-shop-holder]').fill('Atelier SRL');
    await page.locator('[data-shop-iban]').fill('RO49 AAAA 1B31 0075 9384 0000');
    await page.locator('[data-shop-bank]').fill('Banca');
    let shopSaved = page.waitForResponse((r) => r.url().endsWith('/api/shop') && r.request().method() === 'PUT');
    await page.locator('[data-shop-transfer]').check();
    assert((await (await shopSaved).json()).settings.transfer.iban === 'RO49AAAA1B31007593840000', 'paying by transfer is turned on with the account');
    await page.locator('[data-shop-cod]').check();
    await page.locator('[data-shop-add-method]').click();
    await page.locator('[data-shop-method-name]').first().fill('Courier');
    await page.locator('[data-shop-method-price]').first().fill('20');
    await page.locator('[data-shop-method-free]').first().fill('200');
    shopSaved = page.waitForResponse((r) => r.url().endsWith('/api/shop') && r.request().method() === 'PUT');
    await page.locator('[data-shop-method-free]').first().blur();
    await shopSaved;
    await page.locator('[data-shop-add-method]').click();
    await page.locator('[data-shop-method-name]').nth(1).fill('Pick up');
    await page.locator('[data-shop-method-pickup]').nth(1).fill('Str. Lemnului 1');
    shopSaved = page.waitForResponse((r) => r.url().endsWith('/api/shop') && r.request().method() === 'PUT');
    await page.locator('[data-shop-method-pickup]').nth(1).blur();
    await shopSaved;
    await page.locator('[data-shop-add-method]').click();
    await page.locator('[data-shop-method]').nth(2).getByRole('button').click();
    await page.locator('[data-shop-terms]').fill('/terms/');
    await page.locator('[data-shop-terms]').blur();
    await page.locator('[data-shop-account]').check();
    await page.locator('[data-shop-account]').uncheck();
    await page.locator('[data-shop-notify]').fill('owner@example.com');
    shopSaved = page.waitForResponse((r) => r.url().endsWith('/api/shop') && r.request().method() === 'PUT' && (r.request().postData() ?? '').includes('notify'));
    await page.locator('[data-shop-notify]').blur();
    const ways = (await (await shopSaved).json()).settings;
    assert(ways.shipping.length === 2 && ways.cod && ways.terms === '/terms/' && ways.notify === 'owner@example.com', 'two ways to deliver, cash on delivery, the terms and who is told are saved');
    await page.locator('[data-shop-no-way]').waitFor({ state: 'detached' });
    await page.locator('[data-shop-editors]').check();
    if (shots) await page.screenshot({ path: join(shots, 'shop-ways.png') });

    // A visitor fills a cart and places an order: the pages have no script of their own.
    const buyer = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await buyer.goto(site('/products/mug/'));
    await buyer.locator('.buy input[name="quantity"]').fill('2');
    await buyer.locator('.buy button[type="submit"]').click();
    await buyer.locator('.cart-lines').waitFor();
    assert(buyer.url().includes('/_/cart'), 'Add to cart leads to the cart');
    await buyer.locator('input[name="q0"]').fill('3');
    await buyer.locator('#cart-shipping').selectOption('m1');
    await buyer.locator('form.cart button.button').click();
    await buyer.locator('[data-cart-total]').waitFor();
    assert((await buyer.locator('input[name="q0"]').inputValue()) === '3', 'a quantity is changed in the cart');
    if (shots) await buyer.screenshot({ path: join(shots, 'shop-cart.png'), fullPage: true });
    await buyer.locator('[data-cart-checkout]').click();
    await buyer.locator('form.checkout').waitFor();
    await buyer.locator('input[name="name"]').fill('Ana Pop');
    await buyer.locator('input[name="email"]').fill('ana@example.com');
    await buyer.locator('input[name="phone"]').fill('0722000000');
    await buyer.locator('input[name="street"]').fill('Str. Mare 2');
    await buyer.locator('input[name="town"]').fill('Cluj-Napoca');
    await buyer.locator('input[name="county"]').fill('Cluj');
    await buyer.locator('input[name="payment"][value="transfer"]').check();
    await buyer.locator('input[name="terms"]').check();
    if (shots) await buyer.screenshot({ path: join(shots, 'shop-checkout.png'), fullPage: true });
    await buyer.locator('form.checkout button[type="submit"]').click();
    await buyer.locator('[data-order-state="waiting"]').waitFor();
    assert(/\/_\/order\/[\w-]{43}/.test(buyer.url()), 'the order is placed, and shown at its own link');
    assert((await buyer.locator('[data-order-pay]').textContent()).includes('RO49AAAA1B31007593840000'), 'the order says the account to pay into');
    if (shots) await buyer.screenshot({ path: join(shots, 'shop-order.png'), fullPage: true });
    await buyer.close();

    // The owner handles it in Orders.
    await page.reload();
    await page.locator('[data-nav="orders"]').click();
    await page.locator('[data-order-open="1"]').waitFor();
    assert(true, 'the order is listed in Orders');
    const download = page.waitForEvent('download');
    await page.locator('[data-orders-csv]').click();
    assert((await download).suggestedFilename() === 'orders.csv', 'the orders are downloaded as CSV');
    await page.locator('[data-orders-filter]').selectOption('paid');
    await page.locator('[data-orders-none]').waitFor();
    await page.locator('[data-orders-filter]').selectOption('');
    await page.locator('[data-order-open="1"]').click();
    await page.locator('[data-order-number]').waitFor();
    await page.locator('select[data-order-state]').selectOption('sent');
    await page.locator('[data-order-tracking]').fill('AWB 123');
    await page.locator('[data-order-save]').click();
    await page.getByRole('status').waitFor();
    if (shots) await page.screenshot({ path: join(shots, 'shop-orders.png') });
    await page.locator('select[data-order-state]').selectOption('cancelled');
    await page.locator('[data-order-save]').click();
    await page.locator('p[data-order-state="cancelled"]').waitFor();
    assert(true, 'the order is sent with its tracking number, then cancelled');
    await page.locator('[data-orders-back]').click();
    await page.locator('[data-order-open="1"]').waitFor();
    const stock = await (await page.request.get(site('/products/mug/'))).text();
    assert(stock.includes('data-left'), 'cancelled, the mug is in stock again');

    // The order messages are offered in Settings → E-mail.
    await page.locator('[data-nav="settings"]').click();
    await page.locator('[data-mail-template]').waitFor();
    await page.locator('[data-mail-template]').selectOption('orderSent');
    await page.locator('[data-mail-order-hint]').waitFor();
    assert(true, 'the order messages are in Settings → E-mail');
    await page.reload();

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
