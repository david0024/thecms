/**
 * What the browser ran in an end-to-end test, kept for tools/coverage.ts.
 *
 * With UHLAKA_COVERAGE set to a folder, every page the test opens records the
 * JavaScript of the admin and of the editor's canvas that it ran, and closing
 * the browser writes it there. Without it, this changes nothing.
 *
 * The counts are taken from V8 every quarter of a second, before the test
 * reloads, leaves or closes a page, and when the browser closes. Each take
 * starts them again: what a page ran is kept even when it is left, reloaded
 * or opened again, which a single take at the end would lose.
 */
const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const dir = process.env.UHLAKA_COVERAGE;
const ADMIN_SCRIPT = /\/admin\/(app|frame)\.js$/;
const isAdmin = (url) => {
  try {
    return ADMIN_SCRIPT.test(new URL(url).pathname);
  } catch {
    return false;
  }
};

async function track(page) {
  const session = await page.context().newCDPSession(page);
  const sources = new Map();
  const runs = [];
  session.on('Debugger.scriptParsed', (event) => {
    if (!isAdmin(event.url) || sources.has(event.url)) return;
    sources.set(event.url, null);
    session
      .send('Debugger.getScriptSource', { scriptId: event.scriptId })
      .then(({ scriptSource }) => sources.set(event.url, scriptSource))
      .catch(() => sources.delete(event.url));
  });
  await session.send('Profiler.enable');
  await session.send('Debugger.enable');
  await session.send('Profiler.startPreciseCoverage', { callCount: true, detailed: true });
  let taking = Promise.resolve();
  // A take that fails (the page is between two documents) is skipped, and the next one still runs:
  // a failure kept in the chain would stop every take after it, and lose what the page ran from then on.
  const take = () =>
    (taking = taking
      .then(async () => {
        const { result } = await session.send('Profiler.takePreciseCoverage');
        for (const script of result) if (isAdmin(script.url)) runs.push({ url: script.url, functions: script.functions });
      })
      .catch(() => {}));
  const timer = setInterval(take, 250);
  // A page that is reloaded, sent elsewhere or closed loses what it ran since the last take,
  // so one is taken first: otherwise whether a step's lines count depends on how fast it ran.
  for (const name of ['reload', 'goto', 'goBack', 'close']) {
    const own = page[name].bind(page);
    page[name] = async (...args) => {
      if (!page.isClosed()) await take();
      return own(...args);
    };
  }
  return async () => {
    clearInterval(timer);
    if (!page.isClosed()) await take();
    // One run of each script carries its text, the same for every run of it.
    const withSource = new Set();
    return runs.map((run) => {
      const source = sources.get(run.url);
      if (!source || withSource.has(run.url)) return run;
      withSource.add(run.url);
      return { ...run, source };
    });
  };
}

exports.launch = async (chromium, name) => {
  const browser = await chromium.launch();
  if (!dir) return browser;
  mkdirSync(dir, { recursive: true });
  const stops = [];
  const newPage = browser.newPage.bind(browser);
  browser.newPage = async (...args) => {
    const page = await newPage(...args);
    stops.push(await track(page));
    return page;
  };
  const close = browser.close.bind(browser);
  browser.close = async () => {
    for (const [i, stop] of stops.entries()) writeFileSync(join(dir, `browser-${name}-${i}.json`), JSON.stringify(await stop()));
    return close();
  };
  return browser;
};
