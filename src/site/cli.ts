#!/usr/bin/env bun
/**
 * thecms: the command line of the prototype.
 *
 *   thecms init <site.db>                 a new site with sample pages
 *   thecms edit <site.db> [port]          open the visual editor in a browser
 *   thecms theme <site.db> <theme.json>   set and publish the site's theme
 *   thecms export <site.db> <folder>      write the published site as static files
 *   thecms import <site.db> <export.xml>  bring in a WordPress site (add --no-images to skip copying images)
 *   thecms forms <site.db> [port]         receive what visitors send through the site's forms (ADR 0019)
 *   thecms serve <site.db> --public=https://cms.example.com [--port=4321] [--host=127.0.0.1]
 *                                         the editor for others to reach, with accounts (ADR 0022)
 *   thecms reset-link <site.db> <email> --public=https://cms.example.com
 *                                         a one-time link to choose a new password, for an owner locked out
 */
import { existsSync } from 'node:fs';
import { DEMO_PAGES, DEMO_POSTS, DEMO_SITE } from './demo.ts';
import { fetchImage, runImport } from '../import/run.ts';
import { planImport } from '../import/wxr.ts';
import { exportSite } from './export.ts';
import { startForms } from './forms.ts';
import { smtpMailer } from './mail.ts';
import { cleanPublicAddress } from './accounts.ts';
import { startEditor } from './server.ts';
import { databaseKind, shownAddress, Store } from './store.ts';

const PLAIN = new URL('../../themes/plain.json', import.meta.url);

/** Runs one command. A command that starts a server gives it back, so a test can stop it. */
export async function main(args: string[]): Promise<{ stop: () => void } | undefined> {
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
    return editor;
  }
  if (command === 'import' && dbPath && extra) {
    if (!existsSync(extra)) throw new Error(`${extra} does not exist`);
    // Read and understood before anything is written: a file that is not an export creates nothing.
    const listed = (flag: string): string[] => flags.find((f) => f.startsWith(`${flag}=`))?.slice(flag.length + 1).split(',').map((name) => name.trim()).filter(Boolean) ?? [];
    const plan = planImport(await Bun.file(extra).text(), new Date().toISOString().slice(0, 10), { types: listed('--types'), categories: listed('--categories') });
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
  if (command === 'forms' && dbPath) {
    if (missing()) throw new Error(`${shown} does not exist`);
    // Where the owner is told of a message, and through which mail server: the same way a database is given, as an address.
    const mailer = smtpMailer(process.env.THECMS_SMTP);
    const to = process.env.THECMS_MAIL_TO ?? '';
    const store = await Store.open(dbPath);
    const forms = startForms(store, { port: extra ? Number(extra) : 4322, hostname: process.env.THECMS_FORMS_HOST ?? '127.0.0.1', mailer, to, from: process.env.THECMS_MAIL_FROM });
    console.log(
      `Receiving forms for ${shown} at ${forms.url}/send.
` +
        `${mailer && to ? `Each message is also sent to ${to}.` : 'Messages are kept and shown in the admin. Set THECMS_SMTP and THECMS_MAIL_TO to be told by email.'}
` +
        'Put the public address of this service in Site settings, then export the site again.',
    );
    return forms;
  }
  const option = (name: string): string => flags.find((f) => f.startsWith(`--${name}=`))?.slice(name.length + 3) ?? '';
  if (command === 'serve' && dbPath) {
    if (missing()) throw new Error(`${shown} does not exist`);
    if (!option('public')) throw new Error('give the address people will open, like --public=https://cms.example.com');
    const store = await Store.open(dbPath);
    const editor = await startEditor(store, { public: option('public'), port: option('port') ? Number(option('port')) : 4321, hostname: option('host') || '127.0.0.1' });
    console.log(
      `Serving the editor of ${shown} on port ${editor.port}, for ${editor.url}\n\n` +
        (editor.setupUrl
          ? `Nobody has an account yet. Open this link within the hour to make the owner's account; it works once. Started again, the editor prints a new one.\n\n  ${editor.setupUrl}\n`
          : 'Sign in there with your account.\n'),
    );
    return editor;
  }
  if (command === 'reset-link' && dbPath && extra) {
    if (missing()) throw new Error(`${shown} does not exist`);
    const address = cleanPublicAddress(option('public'));
    if (!address) throw new Error('give the address of the admin, like --public=https://cms.example.com');
    const store = await Store.open(dbPath);
    try {
      const user = (await store.users()).find((u) => u.email === extra.trim().toLowerCase());
      if (!user) throw new Error(`nobody has an account with ${extra}`);
      console.log(`Open this link within 3 days to choose a new password for ${user.email}; it works once:\n\n  ${address}/admin/#link=${await store.makeLink(user.active ? 'reset' : 'invite', user.id, 72)}`);
    } finally {
      await store.close();
    }
    return undefined;
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
  console.log('A site is a SQLite file (site.db) or a database address (postgres://... or mysql://...).\n\nUsage:\n  thecms init <site.db>\n  thecms edit <site.db> [port]\n  thecms theme <site.db> <theme.json>\n  thecms export <site.db> <folder>\n  thecms forms <site.db> [port]\n  thecms serve <site.db> --public=https://cms.example.com [--port=4321] [--host=127.0.0.1]\n  thecms reset-link <site.db> <email> --public=https://cms.example.com\n  thecms import <site.db> <export.xml> [--no-images] [--types=portfolio,team] [--categories=projects]');
  process.exitCode = command ? 1 : 0;
  return undefined;
}

if (import.meta.main) {
  main(Bun.argv.slice(2)).catch((error: unknown) => {
    console.error(`thecms: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
