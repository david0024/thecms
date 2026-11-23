# Working from the sources

Needs [Bun](https://bun.sh) 1.4 or newer.

```sh
bun install
bun run cms init site.db              # a sample site, in one file
bun run cms edit site.db              # the site and its editor; open the address it prints
bun run cms run site.db               # the site alone, for visitors
bun run cms export site.db dist       # or the published site as static files (site.zip: as a ZIP)
bun run cms export site.db site.uhlaka.json   # the content in one file; `import` takes it back
```

The site's forms, comments and search are answered by its own server. To be
told of a message by email, set `UHLAKA_SMTP` and `UHLAKA_MAIL_TO`. A site
exported as files can send its forms to the small form service (ADR 0019): run
it where visitors can reach it, put its address in Site settings, and export
again:

```sh
UHLAKA_SMTP=smtps://user:pass@mail.example.com UHLAKA_MAIL_TO=you@example.com \
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
store's tests on them too, set `UHLAKA_TEST_POSTGRES` and `UHLAKA_TEST_MYSQL`
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

## Checks, coverage and builds

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
for t in editor import templates forms admin accounts translations export; do UHLAKA_COVERAGE=coverage node e2e/$t.cjs; done
bun run coverage           # the table, coverage/all.lcov, and the gate
```

```sh
bun tools/build.ts dist-bin --targets=linux-x64   # the program as one file (all platforms without --targets)
```

A release: set the version in `package.json` (alpha and beta versions carry a dash, ADR 0045), then push the tag `v<version>`, or run the Release workflow by hand.

```
src/core/     documents and their rules; pure TypeScript, no database, no framework
src/blocks/   one Svelte 5 component per block type, and the shared layout CSS
src/site/     the store (SQLite, Postgres or MySQL), the static export, the editing server, the command line
src/admin/    the editor: a Svelte 5 app and the script that runs inside the canvas
themes/       themes, as JSON
languages/    language packs, as JSON (more from the folder in UHLAKA_LANGUAGES)
docs/adr/     decisions, with their reasons
```

Three rules hold everywhere:

1. **One list of block types** (`src/core/blocks.ts`). The renderer draws
   exactly those; a test fails otherwise.
2. **Nothing an author typed is ever markup or CSS.** Text is escaped by the
   renderer; a style value is a theme token or a checked literal.
3. **The core imports nothing but itself.** A test holds it to that.
