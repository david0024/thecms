#!/usr/bin/env bun
/**
 * thecms: the command line. Installed, it is one executable (tools/build.ts).
 *
 *   thecms                                the site here (site.db, made if new) in the editor; with
 *                                         --public=URL or THECMS_PUBLIC, served with accounts
 *   thecms init <site.db> [--if-new]      a new site with sample pages
 *   thecms edit <site.db> [port]          open the visual editor in a browser
 *   thecms theme <site.db> <theme.json>   set and publish the site's theme
 *   thecms export <site.db> <folder>      write the published site as static files
 *   thecms import <site.db> <export.xml>  bring in a WordPress site (add --no-images to skip copying images)
 *   thecms forms <site.db> [port]         receive what visitors send through the site's forms (ADR 0019)
 *   thecms serve <site.db> --public=https://cms.example.com [--port=4321] [--host=127.0.0.1]
 *                                         the editor for others to reach, with accounts (ADR 0022)
 *   thecms reset-link <site.db> <email> --public=https://cms.example.com
 *                                         a one-time link to choose a new password, for an owner locked out
 *   thecms setup-link <site.db> --public=https://cms.example.com
 *                                         a new link for the first owner, while there is none
 *   thecms update [--check]               the newest release, in place of this program
 *   thecms version
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
import { DEFAULT_THEME } from './shipped.ts';
import { databaseKind, shownAddress, Store } from './store.ts';
import { update } from './update.ts';
import { VERSION } from './version.ts';
import { NAME } from '../core/index.ts';

const USAGE = `A site is a SQLite file (site.db) or a database address (postgres://... or mysql://...).

Usage:
  ${NAME}                      the site in this folder (site.db, made if new) in the editor
  ${NAME} --public=https://cms.example.com [--port=4321] [--host=127.0.0.1]
                              the same, served for others, with accounts
  ${NAME} init <site.db> [--if-new]
  ${NAME} edit <site.db> [port]
  ${NAME} serve <site.db> --public=https://cms.example.com [--port=4321] [--host=127.0.0.1]
  ${NAME} setup-link <site.db> --public=https://cms.example.com
  ${NAME} reset-link <site.db> <email> --public=https://cms.example.com
  ${NAME} theme <site.db> <theme.json>
  ${NAME} export <site.db> <folder>
  ${NAME} forms <site.db> [port]
  ${NAME} import <site.db> <export.xml> [--no-images] [--types=portfolio,team] [--categories=projects]
  ${NAME} update [--check]
  ${NAME} version

THECMS_SITE and THECMS_PUBLIC stand for the site and the public address when they are not given.`;

/** Fills a new site with the sample pages and posts. False when it already holds one: then nothing is written. */
async function fill(store: Store): Promise<boolean> {
  if (!(await store.isEmpty())) return false;
  await store.setSite(DEMO_SITE);
  await store.setTheme(DEFAULT_THEME);
  await store.publishTheme();
  for (const page of DEMO_PAGES) await store.publish((await store.savePage(page)).slug);
  for (const post of DEMO_POSTS) await store.publishPost((await store.savePost(post)).slug);
  return true;
}


/** Runs one command. A command that starts a server gives it back, so a test can stop it. */
export async function main(args: string[]): Promise<{ stop: () => void } | undefined> {
  const flags = args.filter((a) => a.startsWith('--'));
  const words = args.filter((a) => !a.startsWith('--'));
  const option = (name: string): string => flags.find((f) => f.startsWith(`--${name}=`))?.slice(name.length + 3) ?? '';
  if (flags.includes('--help') || words[0] === 'help') {
    console.log(USAGE);
    return undefined;
  }
  // Without a command: the site here, made if new, edited on this computer or served for others.
  if (!words.length) {
    const site = process.env.THECMS_SITE || 'site.db';
    const store = await Store.open(site);
    if (await fill(store)) console.log(`Created ${shownAddress(site)} with ${DEMO_PAGES.length} sample pages; change them, or remove them, in the editor.`);
    await store.close();
    const served = option('public') || process.env.THECMS_PUBLIC;
    return main(served ? ['serve', site, `--public=${served}`, ...flags.filter((f) => !f.startsWith('--public='))] : ['edit', site, ...(option('port') ? [option('port')] : [])]);
  }
  const [command, dbPath, extra] = words;
  // A site is a SQLite file by default, or a database server's address (ADR 0013). Its password is never printed.
  const shown = dbPath ? shownAddress(dbPath) : '';
  const missing = (): boolean => !!dbPath && databaseKind(dbPath) === 'sqlite' && !existsSync(dbPath.replace(/^sqlite:\/\//i, ''));
  if (command === 'init' && dbPath) {
    // --if-new: an installer runs it every time, and a site that is there is left as it is.
    const ifNew = flags.includes('--if-new');
    if (databaseKind(dbPath) === 'sqlite' && !missing() && !ifNew) throw new Error(`${shown} already exists`);
    const store = await Store.open(dbPath);
    const made = await fill(store);
    await store.close();
    if (made) console.log(`Created ${shown} with ${DEMO_PAGES.length} pages and ${DEMO_POSTS.length} blog posts.`);
    else if (ifNew) console.log(`${shown} already holds a site; it was left as it is.`);
    else throw new Error(`${shown} already holds a site`);
    return;
  }
  if (command === 'version') {
    console.log(`${NAME} ${VERSION}`);
    return;
  }
  if (command === 'update') {
    await update({ check: flags.includes('--check') });
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
        await store.setTheme(DEFAULT_THEME);
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
      console.log(`\nNext: ${NAME} edit ${shown}`);
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
  if (command === 'setup-link' && dbPath) {
    if (missing()) throw new Error(`${shown} does not exist`);
    const address = cleanPublicAddress(option('public'));
    if (!address) throw new Error('give the address of the admin, like --public=https://cms.example.com');
    const store = await Store.open(dbPath);
    try {
      if ((await store.users()).some((u) => u.role === 'owner' && u.active)) throw new Error(`${shown} has an owner; they invite others from People`);
      // A new link replaces the one the server printed when it started.
      console.log(`Open this link within the hour to make the owner's account; it works once:\n\n  ${address}/admin/#link=${await store.makeLink('setup', '', 1)}`);
    } finally {
      await store.close();
    }
    return undefined;
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
  console.log(USAGE);
  process.exitCode = 1;
  return undefined;
}

if (import.meta.main) {
  main(Bun.argv.slice(2)).catch((error: unknown) => {
    console.error(`${NAME}: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
