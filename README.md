# thecms

A modern CMS for content sites, built for people coming from WordPress.

- **You arrange the page visually**, and what is saved is data, not HTML.
- **Full freedom over the look, without breaking the theme.** A block's content
  and its style are kept apart; a style value either follows the theme or is
  your own, and your own ones can always be reset.
- **A theme is a document you can build yourself**, export and share. It
  contains no code.
- **The site is published as static files**: fast, nothing to break into, and
  it runs on any host, including free ones.
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

## Where it stands

Early. What works today: you edit pages visually on the real page, choose a
theme, publish, and export the site as static files.

| | |
|---|---|
| Page model, block types, themes as data | done |
| Blocks: hero, text, image, services, contact details, gallery, questions and answers, testimonials, prices, a list of entries, groups | done |
| SQLite store, draft and published kept apart | done |
| The same site on Postgres or MySQL, chosen by the address | done |
| Static export with sitemap and robots.txt | done |
| Visual editor: add, move, remove, type on the page, style with theme tokens | done |
| Theme builder: tokens, block defaults and variants, themes as files | done |
| Images uploaded and kept with the site; headings, lists and links from a bar on the page; blocks moved by dragging | done |
| Header and footer: logo, button and links from the site, layout from the theme | done |
| Blog: posts, categories, tags, paged lists, Atom feed | done |
| Admin with sections: pages, posts, media, menu and settings, theme | done |
| Menu builder: sub-menus, wide menus with columns, a folded menu on phones, all without script | done |
| Content types: the owner adds kinds of entry (projects, team, events) with their own fields, list and address; posts are one of them | done |
| A block that lists entries of a type on any page (latest posts, a few projects) | done |
| Each content type's page designed in the builder, with the entry's parts placed in it | done |
| WordPress import: pages, posts, images, menu, links rewritten, old addresses kept alive, a report of what did not come over | done |
| Import from the admin: choose the file, see what would come over and what would not, then run it | done |
| A WordPress category kept as a section of its own: its posts become entries of a new content type | done |
| Contact form with consent, a small form service of the site's own, email to the owner, messages kept for a set time, exported or erased on request | done |
| Modules (isolated plugins) | planned |

## Try it

Needs [Bun](https://bun.sh) 1.4 or newer.

```sh
bun install
bun run cms init site.db              # a sample site, in one file
bun run cms edit site.db              # the visual editor; open the address it prints
bun run cms export site.db dist       # the published site as static files
```

Contact forms send to a small service of the site's own (ADR 0019). Run it where
visitors can reach it, put its address in Site settings, and export again:

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
server.

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
for t in editor import templates forms; do THECMS_COVERAGE=coverage node e2e/$t.cjs; done
bun run coverage           # the table, coverage/all.lcov, and the gate
```

```
src/core/     documents and their rules; pure TypeScript, no database, no framework
src/blocks/   one Svelte 5 component per block type, and the shared layout CSS
src/site/     the store (SQLite, Postgres or MySQL), the static export, the editing server, the command line
src/admin/    the editor: a Svelte 5 app and the script that runs inside the canvas
themes/       themes, as JSON
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
