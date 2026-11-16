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

## Where it stands

Early. What works today: pages, a theme and site settings go in as documents,
and a static site comes out.

| | |
|---|---|
| Page model, block types, themes as data | done |
| SQLite store, draft and published kept apart | done |
| Static export with sitemap and robots.txt | done |
| Visual editor | next |
| Theme builder, media library, blog | planned |
| WordPress import | planned |
| Modules (isolated plugins) | planned |

## Try it

Needs [Bun](https://bun.sh) 1.4 or newer.

```sh
bun install
bun run cms init site.db              # a sample site, in one file
bun run cms export site.db dist       # the site as static files
```

Open `dist/index.html` through any static file server. Then change the theme
and export again; the pages are the same, the look is not:

```sh
bun run cms theme site.db themes/studio.json
bun run cms export site.db dist
```

## Develop

```sh
bun run check       # types, then tests
bun test            # tests only
```

```
src/core/     documents and their rules; pure TypeScript, no database, no framework
src/blocks/   one Svelte 5 component per block type, and the shared layout CSS
src/site/     the SQLite store, the static export, the command line
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
