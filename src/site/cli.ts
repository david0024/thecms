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
 *   thecms run <site.db> [--port=4323] [--host=127.0.0.1]
 *                                         serve the published site, and what cannot be static under /_/ (ADR 0038)
 *   thecms serve <site.db> --public=https://cms.example.com [--port=4321] [--host=127.0.0.1]
 *                                         the editor for others to reach, with accounts (ADR 0022)
 *   thecms reset-link <site.db> <email> --public=https://cms.example.com
 *                                         a one-time link to choose a new password, for an owner locked out
 *   thecms setup-link <site.db> --public=https://cms.example.com
 *                                         a new link for the first owner, while there is none
 *   thecms extension <site.db> install <file> [--yes]
 *                                         what an extension asks for, and with --yes, installed (ADR 0026)
 *   thecms extension <site.db> list | on|off|remove <name>
 *   thecms check-database <address>       whether a database answers, for the installer (ADR 0048)
 *   thecms update [--check]               the newest release, in place of this program
 *   thecms version
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DEMO_PAGES, DEMO_POSTS, DEMO_SITE } from './demo.ts';
import { fetchImage, runImport } from '../import/run.ts';
import { planImport } from '../import/wxr.ts';
import { exportSite } from './export.ts';
import { startForms } from './forms.ts';
import { startRuntime } from './runtime.ts';
import { openShared } from './shared.ts';
import { smtpMailer } from './mail.ts';
import { cleanPublicAddress } from './accounts.ts';
import { startEditor } from './server.ts';
import { DEFAULT_THEME } from './shipped.ts';
import { databaseKind, shownAddress, Store } from './store.ts';
import { type ExtensionOffer, extensionHost } from './extensions.ts';
import { startRunner } from './extension-runner.ts';
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
  ${NAME} run <site.db> [--port=4323] [--host=127.0.0.1]
  ${NAME} import <site.db> <export.xml> [--no-images] [--types=portfolio,team] [--categories=projects]
  ${NAME} extension <site.db> list
  ${NAME} extension <site.db> install <file> [--yes]
  ${NAME} extension <site.db> on|off|remove <name>
  ${NAME} check-database <postgres://... | mysql://...>
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


/** What an extension asks for, said before it is installed. */
export function describeOffer(offer: ExtensionOffer): string {
  const { manifest, asks } = offer;
  const lines = [`${manifest.displayName} ${manifest.version}${manifest.publisher ? ` by ${manifest.publisher}` : ''}${offer.replaces ? ` (replaces ${offer.replaces})` : ''}`];
  if (manifest.description) lines.push(manifest.description);
  lines.push(`SHA-256 ${offer.sha256}`, 'It asks to:');
  if (asks.collections.length) lines.push(`  keep its own ${asks.collections.join(', ')}`);
  if (asks.secrets.length) lines.push(`  hold secrets: ${asks.secrets.join(', ')}`);
  lines.push(asks.egress.length ? `  call ${asks.egress.join(', ')}` : '  call nothing outside this program');
  for (const point of asks.points) lines.push(`  offer "${point.action}" on ${point.on === 'page' ? 'a page' : 'a block'} in the editor`);
  if (asks.routes.length) lines.push(`  answer visitors at ${asks.routes.join(', ')}`);
  for (const job of asks.jobs) lines.push(`  do "${job.action}" every ${job.everyMinutes === 1 ? 'minute' : `${job.everyMinutes} minutes`}`);
  if (asks.events.length) lines.push(`  be told when: ${asks.events.join(', ')}`);
  return lines.join('\n');
}

/** How the owner is told of a message or a comment: a mail server's address, as a database is given. */
const mail = () => ({ mailer: smtpMailer(process.env.THECMS_SMTP), to: process.env.THECMS_MAIL_TO ?? '', from: process.env.THECMS_MAIL_FROM });

/** Where the site's processes share what they keep (ADR 0044 d4): Valkey from THECMS_VALKEY_URL, and a folder beside a site that is a file. */
const kept = (dbPath: string) => ({
  valkey: process.env.THECMS_VALKEY_URL ?? '',
  cacheDir: databaseKind(dbPath) === 'sqlite' ? join(dirname(dbPath.replace(/^sqlite:\/\//i, '')), '.thecms-cache') : undefined,
});

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
  if (command === 'check-database' && dbPath) {
    // The installer asks this before it writes anything (ADR 0048 d2): the database answers, and the site's tables can be made in it.
    const store = await Store.open(dbPath).catch((error: unknown) => {
      throw new Error(`${shown} does not answer: ${error instanceof Error ? error.message : String(error)}`);
    });
    await store.close();
    console.log(`${shown} answers; the site can live there.`);
    return;
  }
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
  if (command === 'extension' && dbPath && extra) {
    if (missing()) throw new Error(`${shown} does not exist`);
    const store = await Store.open(dbPath);
    const host = extensionHost(store);
    try {
      const what = words[3] ?? '';
      if (extra === 'list') {
        const all = await store.extensions();
        console.log(all.length ? all.map((e) => `${e.manifest.name} ${e.manifest.version}${e.enabled ? '' : ' (off)'}`).join('\n') : 'No extensions are installed.');
      } else if (extra === 'install' && what) {
        const text = await Bun.file(what).text();
        const offer = await host.offer(text);
        console.log(describeOffer(offer));
        if (!flags.includes('--yes')) {
          console.log('Nothing was installed. Run this again with --yes to accept what it asks for.');
          return;
        }
        await host.install(text, offer.sha256);
        console.log(`Installed ${offer.manifest.displayName} ${offer.manifest.version}.`);
      } else if ((extra === 'remove' || extra === 'on' || extra === 'off') && what) {
        if (!(await store.extension(what))) throw new Error(`no extension "${what}" is installed`);
        if (extra === 'remove') await host.uninstall(what);
        else await host.enable(what, extra === 'on');
        console.log(extra === 'remove' ? `Removed ${what} and what it kept.` : `${what} is ${extra}.`);
      } else throw new Error(`unknown: extension ${extra}; see ${NAME} help`);
    } finally {
      host.close();
      await store.close();
    }
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
    const editor = await startEditor(await Store.open(dbPath), { ...mail(), ...kept(dbPath), ...(extra ? { port: Number(extra) } : {}) });
    console.log(
      `Editing ${shown}. Open this address (it carries the key to the editor):\n\n  ${editor.url}\n\n` +
        `The site, as visitors see it, is at http://127.0.0.1:${editor.port}/, with its forms, comments and search.\nPress Ctrl+C to stop.`,
    );
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
  if (command === 'run' && dbPath) {
    if (missing()) throw new Error(`${shown} does not exist`);
    const mailer = smtpMailer(process.env.THECMS_SMTP);
    const to = process.env.THECMS_MAIL_TO ?? '';
    const store = await Store.open(dbPath);
    const { valkey, cacheDir } = kept(dbPath);
    const shared = openShared(valkey || (await store.valkeyAddress()), { dir: cacheDir });
    const runtime = startRuntime(store, { port: option('port') ? Number(option('port')) : 4323, hostname: option('host') || '127.0.0.1', mailer, to, from: process.env.THECMS_MAIL_FROM, shared });
    const stop = runtime.stop;
    runtime.stop = () => {
      stop();
      shared.close();
    };
    console.log(
      `Serving the published site of ${shown} at ${runtime.url}, and its forms at ${runtime.url}/_/send.\n` +
        `${mailer && to ? `Each message is also sent to ${to}.` : 'Messages are kept and shown in the admin. Set THECMS_SMTP and THECMS_MAIL_TO to be told by email.'}\n` +
        'A publication shows within a second. The editor serves the site this way too; this command serves it without the editor.',
    );
    return runtime;
  }
  if (command === 'serve' && dbPath) {
    if (missing()) throw new Error(`${shown} does not exist`);
    if (!option('public')) throw new Error('give the address people will open, like --public=https://cms.example.com');
    const store = await Store.open(dbPath);
    const editor = await startEditor(store, { ...mail(), ...kept(dbPath), public: option('public'), port: option('port') ? Number(option('port')) : 4321, hostname: option('host') || '127.0.0.1' });
    console.log(
      `Serving ${shown} on port ${editor.port}: the site at ${option('public').replace(/\/+$/, '')}/, its editor at ${editor.url}\n\n` +
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
        const files = await exportSite(store, extra, (line) => console.log(`Note: ${line}`));
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

if (import.meta.main && Bun.argv[2] === '__extension-runner') startRunner();
else if (import.meta.main) {
  main(Bun.argv.slice(2)).catch((error: unknown) => {
    console.error(`${NAME}: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
