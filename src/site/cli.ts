#!/usr/bin/env bun
/**
 * thecms: the command line of the prototype.
 *
 *   thecms init <site.db>                 a new site with sample pages
 *   thecms edit <site.db> [port]          open the visual editor in a browser
 *   thecms theme <site.db> <theme.json>   change the site's theme
 *   thecms export <site.db> <folder>      write the published site as static files
 */
import { existsSync } from 'node:fs';
import { DEMO_PAGES, DEMO_SITE } from './demo.ts';
import { exportSite } from './export.ts';
import { startEditor } from './server.ts';
import { Store } from './store.ts';

const PLAIN = new URL('../../themes/plain.json', import.meta.url);

async function main(args: string[]): Promise<void> {
  const [command, dbPath, extra] = args;
  if (command === 'init' && dbPath) {
    if (existsSync(dbPath)) throw new Error(`${dbPath} already exists`);
    const store = new Store(dbPath);
    store.setSite(DEMO_SITE);
    store.setTheme(await Bun.file(PLAIN).json());
    for (const page of DEMO_PAGES) store.publish(store.savePage(page).slug);
    store.close();
    console.log(`Created ${dbPath} with ${DEMO_PAGES.length} pages.`);
    return;
  }
  if (command === 'edit' && dbPath) {
    if (!existsSync(dbPath)) throw new Error(`${dbPath} does not exist`);
    const editor = await startEditor(new Store(dbPath), extra ? { port: Number(extra) } : {});
    console.log(`Editing ${dbPath}. Open this address (it carries the key to the editor):\n\n  ${editor.url}\n\nPress Ctrl+C to stop.`);
    return;
  }
  if ((command === 'theme' || command === 'export') && dbPath && extra) {
    if (!existsSync(dbPath)) throw new Error(`${dbPath} does not exist`);
    const store = new Store(dbPath);
    try {
      if (command === 'theme') {
        console.log(`Theme is now "${store.setTheme(await Bun.file(extra).json()).name}".`);
      } else {
        const files = await exportSite(store, extra);
        console.log(`Wrote ${files.length} files to ${extra}.`);
      }
    } finally {
      store.close();
    }
    return;
  }
  console.log('Usage:\n  thecms init <site.db>\n  thecms edit <site.db> [port]\n  thecms theme <site.db> <theme.json>\n  thecms export <site.db> <folder>');
  process.exitCode = command ? 1 : 0;
}

main(Bun.argv.slice(2)).catch((error: unknown) => {
  console.error(`thecms: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
