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

## Where it stands

Early. What works today: you edit pages visually on the real page, choose a
theme, publish, and export the site as static files.

| | |
|---|---|
| Page model, block types, themes as data | done |
| SQLite store, draft and published kept apart | done |
| Static export with sitemap and robots.txt | done |
| Visual editor: add, move, remove, type on the page, style with theme tokens | done |
| Theme builder: tokens, block defaults and variants, themes as files | done |
| Drag and drop, rich text toolbar, media library, blog | next |
| WordPress import | planned |
| Modules (isolated plugins) | planned |

## Try it

Needs [Bun](https://bun.sh) 1.4 or newer.

```sh
bun install
bun run cms init site.db              # a sample site, in one file
bun run cms edit site.db              # the visual editor; open the address it prints
bun run cms export site.db dist       # the published site as static files
```

In the editor, click any text on the page and type. Add blocks from the left,
style the selected block on the right, then Publish. **Edit theme** opens the
theme builder: change the colours, typefaces and spacing, set how each block
type looks by default, and download the result as a file. A theme is published
separately from pages, with **Publish theme**. `export` writes what is published; serve `dist` with any static file
server.

The address `edit` prints carries a key. The editor answers only on your own
computer and only to that key.

## Develop

```sh
bun run check              # types, then tests
bun test                   # tests only
node e2e/editor.cjs        # the editor in a real browser, start to exported files (needs Playwright)
```

```
src/core/     documents and their rules; pure TypeScript, no database, no framework
src/blocks/   one Svelte 5 component per block type, and the shared layout CSS
src/site/     the SQLite store, the static export, the editing server, the command line
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

[GPL-3.0-or-later](LICENSE). Themes are data and modules run behind a contract,
so they may carry any licence.
