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
import { databaseKind, shownAddress, Store } from './store.ts';

const PLAIN = new URL('../../themes/plain.json', import.meta.url);

async function main(args: string[]): Promise<void> {
  const flags = args.filter((a) => a.startsWith('--'));
  const [command, dbPath, extra] = args.filter((a) => !a.startsWith('--'));
  // A site is a SQLite file by default, or a database server's address (ADR 0013). Its password is never printed.
  const shown = dbPath ? shownAddress(dbPath) : '';
  const missing = (): boolean => !!dbPath && databaseKind(dbPath) === 'sqlite' && !existsSync(dbPath.replace(/^sqlite:\/\//i, ''));
  if (command === 'init' && dbPath) {
    if (databaseKind(dbPath) === 'sqlite' && !missing()) throw new Error(`${shown} already exists`);
    const store = await Store.open(dbPath);
    if (!(await store.isEmpty())) {
      await store.close();
      throw new Error(`${shown} already holds a site`);
    }
    await store.setSite(DEMO_SITE);
    await store.setTheme(await Bun.file(PLAIN).json());
    await store.publishTheme();
    for (const page of DEMO_PAGES) await store.publish((await store.savePage(page)).slug);
    for (const post of DEMO_POSTS) await store.publishPost((await store.savePost(post)).slug);
    await store.close();
    console.log(`Created ${shown} with ${DEMO_PAGES.length} pages and ${DEMO_POSTS.length} blog posts.`);
    return;
  }
  if (command === 'edit' && dbPath) {
    if (missing()) throw new Error(`${shown} does not exist`);
    const editor = await startEditor(await Store.open(dbPath), extra ? { port: Number(extra) } : {});
    console.log(`Editing ${shown}. Open this address (it carries the key to the editor):\n\n  ${editor.url}\n\nPress Ctrl+C to stop.`);
    return;
  }
  if (command === 'import' && dbPath && extra) {
    if (!existsSync(extra)) throw new Error(`${extra} does not exist`);
    // Read and understood before anything is written: a file that is not an export creates nothing.
    const types = flags.find((f) => f.startsWith('--types='))?.slice(8).split(',').map((name) => name.trim()).filter(Boolean) ?? [];
    const plan = planImport(await Bun.file(extra).text(), new Date().toISOString().slice(0, 10), { types });
    const store = await Store.open(dbPath);
    try {
      const fresh = await store.isEmpty();
      if (fresh) {
        await store.setTheme(await Bun.file(PLAIN).json());
        await store.publishTheme();
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
        `Imported ${report.pages} pages, ${report.posts} posts${report.entries ? ` and ${report.entries} entries of other types` : ''} into ${shown} (${report.drafts} of them as drafts), with ${report.images} images.` +
          `${report.menu ? ' The menu came over too.' : ''}${report.redirects ? ` ${report.redirects} old addresses now lead to their new ones.` : ''}`,
      );
      if (report.notes.length) console.log(`\nWhat to know:\n${report.notes.map((n) => `  - ${n}`).join('\n')}`);
      console.log(`\nNext: thecms edit ${shown}`);
    } finally {
      await store.close();
    }
    return;
  }
  if ((command === 'theme' || command === 'export') && dbPath && extra) {
    if (missing()) throw new Error(`${shown} does not exist`);
    const store = await Store.open(dbPath);
    try {
      if (command === 'theme') {
        await store.setTheme(await Bun.file(extra).json());
        console.log(`Theme is now "${(await store.publishTheme()).name}".`);
      } else {
        const files = await exportSite(store, extra);
        console.log(`Wrote ${files.length} files to ${extra}.`);
      }
    } finally {
      await store.close();
    }
    return;
  }
  console.log('A site is a SQLite file (site.db) or a database address (postgres://... or mysql://...).\n\nUsage:\n  thecms init <site.db>\n  thecms edit <site.db> [port]\n  thecms theme <site.db> <theme.json>\n  thecms export <site.db> <folder>\n  thecms import <site.db> <export.xml> [--no-images] [--types=portfolio,team]');
  process.exitCode = command ? 1 : 0;
}

main(Bun.argv.slice(2)).catch((error: unknown) => {
  console.error(`thecms: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
