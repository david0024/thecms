# thecms

A modern CMS for any site WordPress can make, its plugins included, built for
people coming from WordPress.

- **You arrange the page visually**, and what is saved is data, not HTML.
- **Full freedom over the look, without breaking the theme.** A block's content
  and its style are kept apart; a style value either follows the theme or is
  your own, and your own ones can always be reset.
- **A theme is a document you can build yourself**, export and share. It
  contains no code.
- **The site is served, as a WordPress site is**, so forms, comments, search
  and pages behind a password always work, with nothing to set. Pages are
  built again only when what visitors see has changed, so they are as fast as
  files. A simple site can still be exported as static files, and is told
  what it loses.
- **Modules cannot take the site down.** They declare what they do and run
  isolated.

The decisions behind this, each with its reason:

- [ADR 0001 — Foundations](docs/adr/0001-foundations.md)
- [ADR 0002 — The first slice](docs/adr/0002-the-first-slice.md)
- [ADR 0003 — The editor works on the real page](docs/adr/0003-the-editor.md)
- [ADR 0004 — The theme builder](docs/adr/0004-the-theme-builder.md)
- [ADR 0005 — Images, formatting and dragging](docs/adr/0005-images-formatting-dragging.md)
- [ADR 0006 — The header and footer](docs/adr/0006-header-and-footer.md)
- [ADR 0007 — The blog](docs/adr/0007-the-blog.md)
- [ADR 0008 — The menu](docs/adr/0008-the-menu.md)
- [ADR 0009 — Importing a WordPress site](docs/adr/0009-wordpress-import.md)
- [ADR 0010 — Content types](docs/adr/0010-content-types.md)
- [ADR 0011 — A block that lists entries](docs/adr/0011-the-entries-block.md)
- [ADR 0012 — Importing from the admin](docs/adr/0012-import-from-the-admin.md)
- [ADR 0013 — One store, three databases](docs/adr/0013-sqlite-postgres-mysql.md)
- [ADR 0015 — A page for each content type](docs/adr/0015-a-page-for-each-content-type.md)
- [ADR 0016 — A category that is a section of its own](docs/adr/0016-categories-as-sections.md)
- [ADR 0017 — Gallery, questions, testimonials, prices](docs/adr/0017-more-blocks.md)
- [ADR 0018 — Tags](docs/adr/0018-tags.md)
- [ADR 0019 — The contact form and the site's form service](docs/adr/0019-the-contact-form.md)
- [ADR 0020 — The core is AGPL-3.0-or-later](docs/adr/0020-licence-agpl.md)
- [ADR 0021 — Language packs](docs/adr/0021-language-packs.md)
- [ADR 0022 — Accounts](docs/adr/0022-accounts.md)
- [ADR 0023 — Installation](docs/adr/0023-installation.md)
- [ADR 0024 — The same page in more than one language](docs/adr/0024-languages.md)
- [ADR 0025 — No built-in blog: every content type is the owner's](docs/adr/0025-no-built-in-type.md)
- [ADR 0026 — Extensions, on the model of Zveltio's third-party extensions](docs/adr/0026-extensions.md)
- [ADR 0027 — AI writing, as an extension](docs/adr/0027-ai-extension.md)
- [ADR 0028 — What was published is kept, to bring back](docs/adr/0028-published-versions.md)
- [ADR 0029 — The site is checked before it is published](docs/adr/0029-check-before-publishing.md)
- [ADR 0030 — Data for search engines](docs/adr/0030-data-for-search-engines.md)
- [ADR 0031 — An extension's screens are data: `thecms.view/1`](docs/adr/0031-extension-screens-as-data.md)
- [ADR 0032 — A page is translated field by field](docs/adr/0032-translation-by-field.md)
- [ADR 0033 — Sections: blocks written once, shown on many pages](docs/adr/0033-sections.md)
- [ADR 0034 — Actions on translations, and in every language](docs/adr/0034-actions-on-translations.md)
- [ADR 0035 — Theme, layout, page, section, site: who decides what](docs/adr/0035-layouts-and-boundaries.md)
- [ADR 0036 — Old addresses: moved pages and redirects written by hand](docs/adr/0036-redirects.md)
- [ADR 0037 — What thecms is for: anything WordPress does, with its plugins](docs/adr/0037-direction.md)
- [ADR 0038 — The site's runtime: the published site and what cannot be static, from one address](docs/adr/0038-the-runtime.md)
- [ADR 0039 — Publish later, and the site's clock](docs/adr/0039-publish-later.md)
- [ADR 0040 — Comments, with moderation](docs/adr/0040-comments.md)
- [ADR 0041 — Extensions on the server: routes, jobs and events](docs/adr/0041-extensions-on-the-server.md)
- [ADR 0042 — Search on the site](docs/adr/0042-search.md)
- [ADR 0043 — Pages behind a password](docs/adr/0043-pages-behind-a-password.md)
- [ADR 0044 — The site is served](docs/adr/0044-the-site-is-served.md)

## Where it stands

Early. What works today: you edit pages visually on the real page, choose a
theme, publish, and export the site as static files.
What comes next, in four stages up to a shop, memberships and courses, is in
[ADR 0037 d4](docs/adr/0037-direction.md#d4-the-order).

| | |
|---|---|
| Page model, block types, themes as data | done |
| Blocks: hero, text, image, services, contact details, gallery, questions and answers, testimonials, prices, a list of entries, groups | done |
| SQLite store, draft and published kept apart | done |
| The same site on Postgres or MySQL, chosen by the address | done |
| Static export with sitemap and robots.txt, for a simple site; it says what only the server does | done |
| Visual editor: add, move, remove, type on the page, style with theme tokens | done |
| Theme builder: tokens, block defaults and variants, themes as files | done |
| Images uploaded and kept with the site, each offered at the size that fits a phone or a wide screen (srcset made in the browser); headings, lists and links from a bar on the page; blocks moved by dragging | done |
| Header and footer: logo, button and links from the site, layout from the theme | done |
| Content types the owner defines (a blog is only an example): entries at `/<type>/<entry>/`, categories, tags, paged lists, Atom feed | done |
| Admin with sections: pages, posts, media, menu and settings, theme | done |
| Menu builder: sub-menus, wide menus with columns, a folded menu on phones, all without script | done |
| Content types: the owner adds kinds of entry (projects, team, events) with their own fields, list and address; posts are one of them | done |
| A block that lists entries of a type on any page (latest posts, a few projects) | done |
| Each content type's page designed in the builder, with the entry's parts placed in it | done |
| WordPress import: pages, posts, images, menu, links rewritten, old addresses kept alive, a report of what did not come over | done |
| Import from the admin: choose the file, see what would come over and what would not, then run it | done |
| A WordPress category kept as a section of its own: its posts become entries of a new content type | done |
| Contact form with consent, a small form service of the site's own, email to the owner, messages kept for a set time, exported or erased on request | done |
| Language packs: the admin and the site's words in one JSON file a language, checked against English; Romanian ships complete | done |
| Accounts for a served editor: the first owner from a one-time link, editors invited by the owner, an editor writes content and nothing else | done |
| Installed with one command: one file a platform from GitHub Releases, checked by its checksum; a server with systemd in one more option; `thecms update` | done |
| Extensions on the model of Zveltio's third-party ones: one file, accepted by the owner for what it asks; collections, actions on a block or a page, screens as data; code in a process of its own, on a server under a user of its own with no network | done |
| Extensions on the server (`thecms.extension/2`): public addresses under `/_/x/`, jobs the site's clock runs at an interval, events from the site (a page published, a comment, a message) | done |
| Pages in more than one language: each translated from the list of pages, at /ro/…, with the header, footer and menu of its language, a switcher and hreflang | done (posts and entries: planned) |
| AI writing, as an extension with the owner's key (Claude, OpenAI or Ollama): a block written or rewritten as asked, a page translated into its language, a page's description; each comes back as a change to look at | done (image descriptions: planned) |
| The last twenty publications of each page and entry kept, and one brought back into the editor as a change | done |
| Publish later: a page or an entry set for an hour, published then by the editor or the runtime | done |
| Pages behind a password, asked by the runtime; left out of the sitemap, the search and any export | done (members-only pages: with stage 2) |
| Search on the site: a block placed anywhere, answered by the runtime with a page of the site's own; every word, without minding case or accents | done |
| Comments on the entries of a type that takes them: a plain form, held for the owner's approval, shown without the writer's address, given or erased on request | done |
| A check before publishing: a link that leads nowhere stops the export, a picture with no description is listed; in the admin under the pages | done |
| The canvas shown as on a phone, a tablet or a wide screen | done |
| Data for search engines (schema.org): the site and its business on the home page, an article for each dated entry | done |
| The site is served (`thecms`, or `thecms run` without the editor): pages, forms, comments, search and old addresses as real 301s from one address, built again only when something is published; a cart and accounts arrive under `/_/` | started |
| Valkey on a server for built pages, the clock's lock, sessions and the counters that limit tries, with a fallback in memory and on disk; Settings → Performance tests it | done |

## Install

On Linux or macOS:

```sh
curl -fsSL https://github.com/david0024/thecms/releases/latest/download/install.sh | sh
```

On Windows, in PowerShell:

```powershell
irm https://github.com/david0024/thecms/releases/latest/download/install.ps1 | iex
```

Then, in a folder for your site, run `thecms`. It makes `site.db` with sample
pages and serves the site, with its editor at `/admin/`. `thecms update` brings the newest release.

On a Linux server, as root, the site and its editor at your address, behind the
web server that holds the certificate:

```sh
curl -fsSL https://github.com/david0024/thecms/releases/latest/download/install.sh \
  | sh -s -- --server --public=https://cms.example.com
```

It installs Valkey and starts it, listening only on the server, for what the
site's processes share (`--no-valkey` leaves it out). It prints the link that
makes the owner's account. Add
`--database=postgres://…` to keep the site in a database server (ADR 0023).

## Try it from the sources

Needs [Bun](https://bun.sh) 1.4 or newer.

```sh
bun install
bun run cms init site.db              # a sample site, in one file
bun run cms edit site.db              # the site and its editor; open the address it prints
bun run cms run site.db               # the site alone, for visitors
bun run cms export site.db dist       # or the published site as static files
```

The site's forms, comments and search are answered by its own server. To be
told of a message by email, set `THECMS_SMTP` and `THECMS_MAIL_TO`. A site
exported as files can send its forms to the small form service (ADR 0019): run
it where visitors can reach it, put its address in Site settings, and export
again:

```sh
THECMS_SMTP=smtps://user:pass@mail.example.com THECMS_MAIL_TO=you@example.com \
  bun run cms forms site.db 4322     # receives at /send; messages show in the admin
```

`site.db` can be a Postgres or MySQL address instead of a file, and every
command takes it the same way (ADR 0013):

```sh
bun run cms init postgres://user:pass@localhost:5432/mysite
bun run cms edit mysql://user:pass@localhost:3306/mysite
```

MySQL 8.4 must allow `mysql_native_password` for the site's user for now
(`--mysql-native-password=ON`); Postgres needs nothing special. To run the
store's tests on them too, set `THECMS_TEST_POSTGRES` and `THECMS_TEST_MYSQL`
to the address of an empty database each.

The admin opens on the list of pages, with sections for posts, media, the menu
and settings, and the theme. Choose a page to open it in the builder. There, click any text on the page and type. Add blocks from the left,
style the selected block on the right, then Publish. **Edit theme** opens the
theme builder: change the colours, typefaces and spacing, set how each block
type looks by default, and download the result as a file. A theme is published
separately from pages, with **Publish theme**. `export` writes what is published; serve `dist` with any static file
server, and read what it says a static host cannot do.

To bring a WordPress site: in WordPress choose Tools, Export, All content. Then open
**Import** in the admin and choose the file; it shows what would come over before
anything is written. Or, from the command line:

```sh
bun run cms import site.db export.xml   # a new site.db from the export
```

Add `--types=portfolio,team` to bring a plugin's kinds of entry as content types, and `--categories=projects` to make the posts of a category a content type of their own (ADR 0016).

It copies the images, rewrites links, keeps old addresses working, and prints
what could not come over (forms, shortcodes, comments).

The address `edit` prints carries a key. The editor answers only on your own
computer and only to that key.

To let a client edit their site from anywhere, serve the editor at an address
of its own, behind a server that holds the certificate (ADR 0022):

```sh
bun run cms serve site.db --public=https://cms.example.com   # listens on 127.0.0.1:4321
```

While the site has no owner it prints a link that works once, for an hour: open
it and make the owner's account. The owner invites others from **People**; an
editor writes and publishes pages, posts and entries, and the rest stays with
the owner. Locked out: `bun run cms reset-link site.db you@example.com --public=https://cms.example.com`.

## Develop

```sh
bun run check              # types, then tests
bun test                   # tests only
node e2e/editor.cjs        # the editor in a real browser, start to exported files (needs Playwright)
```

Coverage is counted over the whole source tree: the unit tests, and what the
browser ran in the end-to-end tests, traced back to the source lines. CI fails
when it drops under the floor in `package.json`, or when a source file is
measured by no test.

```sh
bun test --coverage --coverage-reporter=lcov --coverage-dir=coverage
for t in editor import templates forms admin accounts translations; do THECMS_COVERAGE=coverage node e2e/$t.cjs; done
bun run coverage           # the table, coverage/all.lcov, and the gate
```

```sh
bun tools/build.ts dist-bin --targets=linux-x64   # the program as one file (all platforms without --targets)
```

A release is a tag: set the version in `package.json`, then push `v<version>`.

```
src/core/     documents and their rules; pure TypeScript, no database, no framework
src/blocks/   one Svelte 5 component per block type, and the shared layout CSS
src/site/     the store (SQLite, Postgres or MySQL), the static export, the editing server, the command line
src/admin/    the editor: a Svelte 5 app and the script that runs inside the canvas
themes/       themes, as JSON
languages/    language packs, as JSON (more from the folder in THECMS_LANGUAGES)
docs/adr/     decisions, with their reasons
```

Three rules hold everywhere:

1. **One list of block types** (`src/core/blocks.ts`). The renderer draws
   exactly those; a test fails otherwise.
2. **Nothing an author typed is ever markup or CSS.** Text is escaped by the
   renderer; a style value is a theme token or a checked literal.
3. **The core imports nothing but itself.** A test holds it to that.

## Licence

The core is [AGPL-3.0-or-later](LICENSE) (ADR 0020). Themes, language packs and
the client/SDK are MIT; themes, modules and the sites you build may carry any
licence. Contributions come under a simple [CLA](CLA.md); see
[CONTRIBUTING.md](CONTRIBUTING.md).
