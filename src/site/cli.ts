#!/usr/bin/env bun
/**
 * thecms: the command line of the prototype.
 *
 *   thecms init <site.db>                 a new site with sample pages
 *   thecms edit <site.db> [port]          open the visual editor in a browser
 *   thecms theme <site.db> <theme.json>   set and publish the site's theme
 *   thecms export <site.db> <folder>      write the published site as static files
 *   thecms import <site.db> <export.xml>  bring in a WordPress site (add --no-images to skip copying images)
 */
import { existsSync } from 'node:fs';
import { DEMO_PAGES, DEMO_POSTS, DEMO_SITE } from './demo.ts';
import { fetchImage, runImport } from '../import/run.ts';
import { planImport } from '../import/wxr.ts';
import { exportSite } from './export.ts';
import { startEditor } from './server.ts';
import { Store } from './store.ts';

const PLAIN = new URL('../../themes/plain.json', import.meta.url);

async function main(args: string[]): Promise<void> {
  const flags = args.filter((a) => a.startsWith('--'));
  const [command, dbPath, extra] = args.filter((a) => !a.startsWith('--'));
  if (command === 'init' && dbPath) {
    if (existsSync(dbPath)) throw new Error(`${dbPath} already exists`);
    const store = new Store(dbPath);
    store.setSite(DEMO_SITE);
    store.setTheme(await Bun.file(PLAIN).json());
    store.publishTheme();
    for (const page of DEMO_PAGES) store.publish(store.savePage(page).slug);
    for (const post of DEMO_POSTS) store.publishPost(store.savePost(post).slug);
    store.close();
    console.log(`Created ${dbPath} with ${DEMO_PAGES.length} pages and ${DEMO_POSTS.length} blog posts.`);
    return;
  }
  if (command === 'edit' && dbPath) {
    if (!existsSync(dbPath)) throw new Error(`${dbPath} does not exist`);
    const editor = await startEditor(new Store(dbPath), extra ? { port: Number(extra) } : {});
    console.log(`Editing ${dbPath}. Open this address (it carries the key to the editor):\n\n  ${editor.url}\n\nPress Ctrl+C to stop.`);
    return;
  }
  if (command === 'import' && dbPath && extra) {
    if (!existsSync(extra)) throw new Error(`${extra} does not exist`);
    // Read and understood before anything is written: a file that is not an export creates nothing.
    const plan = planImport(await Bun.file(extra).text(), new Date().toISOString().slice(0, 10));
    const fresh = !existsSync(dbPath);
    const store = new Store(dbPath);
    try {
      if (fresh) {
        store.setTheme(await Bun.file(PLAIN).json());
        store.publishTheme();
      }
      const copy = !flags.includes('--no-images');
      if (copy && plan.images.length) console.log(`Copying ${plan.images.length} images from the old site...`);
      const report = await runImport(store, plan, {
        fetchImage: copy ? fetchImage : null,
        fresh,
        onImage: (done, total) => {
          if (done % 25 === 0 && done < total) console.log(`  ${done} of ${total}`);
        },
      });
      console.log(
        `Imported ${report.pages} pages and ${report.posts} posts into ${dbPath} (${report.drafts} of them as drafts), with ${report.images} images.` +
          `${report.menu ? ' The menu came over too.' : ''}${report.redirects ? ` ${report.redirects} old addresses now lead to their new ones.` : ''}`,
      );
      if (report.notes.length) console.log(`\nWhat to know:\n${report.notes.map((n) => `  - ${n}`).join('\n')}`);
      console.log(`\nNext: thecms edit ${dbPath}`);
    } finally {
      store.close();
    }
    return;
  }
  if ((command === 'theme' || command === 'export') && dbPath && extra) {
    if (!existsSync(dbPath)) throw new Error(`${dbPath} does not exist`);
    const store = new Store(dbPath);
    try {
      if (command === 'theme') {
        store.setTheme(await Bun.file(extra).json());
        console.log(`Theme is now "${store.publishTheme().name}".`);
      } else {
        const files = await exportSite(store, extra);
        console.log(`Wrote ${files.length} files to ${extra}.`);
      }
    } finally {
      store.close();
    }
    return;
  }
  console.log('Usage:\n  thecms init <site.db>\n  thecms edit <site.db> [port]\n  thecms theme <site.db> <theme.json>\n  thecms export <site.db> <folder>\n  thecms import <site.db> <export.xml> [--no-images]');
  process.exitCode = command ? 1 : 0;
}

main(Bun.argv.slice(2)).catch((error: unknown) => {
  console.error(`thecms: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
