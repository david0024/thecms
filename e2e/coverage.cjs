/**
 * What the browser ran in an end-to-end test, kept for tools/coverage.ts.
 *
 * With THECMS_COVERAGE set to a folder, every page the test opens records the
 * JavaScript of the admin and of the editor's canvas that it ran, and closing
 * the browser writes it there. Without it, this changes nothing.
 */
const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const dir = process.env.THECMS_COVERAGE;
const ADMIN_SCRIPT = /\/admin\/(app|frame)\.js$/;

exports.launch = async (chromium, name) => {
  const browser = await chromium.launch();
  if (!dir) return browser;
  mkdirSync(dir, { recursive: true });
  const pages = [];
  const newPage = browser.newPage.bind(browser);
  browser.newPage = async (...args) => {
    const page = await newPage(...args);
    await page.coverage.startJSCoverage({ resetOnNavigation: false, reportAnonymousScripts: false });
    pages.push(page);
    return page;
  };
  const close = browser.close.bind(browser);
  browser.close = async () => {
    for (const [i, page] of pages.entries()) {
      if (page.isClosed()) continue;
      const ran = (await page.coverage.stopJSCoverage()).filter((entry) => ADMIN_SCRIPT.test(new URL(entry.url).pathname));
      writeFileSync(join(dir, `browser-${name}-${i}.json`), JSON.stringify(ran));
    }
    return close();
  };
  return browser;
};
