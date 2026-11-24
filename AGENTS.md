# AGENTS.md

For AI agents (Claude, Cursor, Codex and the others). Two jobs, two parts:
building a site **with** Uhlaka, and working **on** Uhlaka's code.

## Building a site with Uhlaka

Do not write HTML. A Uhlaka site is data: pages made of blocks, a theme, a
menu, forms. Write that data as one content file, import it, and the owner gets
a site they can edit on the page from the first day.

1. **Write a content file** (`<name>.uhlaka.json`) that keeps to
   [`docs/content-schema.json`](docs/content-schema.json). Start from
   [`docs/examples/dental-clinic.uhlaka.json`](docs/examples/dental-clinic.uhlaka.json),
   a whole site: settings, three pages, a form and a post.
2. **Import it into a new site:** `uhlaka import site.db site.uhlaka.json`
   (from the sources: `bun run cms import …`). A new site takes the file's
   settings and theme too; a site that already has pages keeps its own and only
   gains what it lacks. Read what the command prints: anything it could not
   take is listed there.
3. **Look at it:** `uhlaka edit site.db` prints an address with the editor and
   the site. `uhlaka export site.db dist` writes the published site as files
   and warns of what is wrong (a link to nowhere, two pages with one title).

Rules that keep the site editable and good-looking:

- **Only the blocks in the schema** (`$defs/block-*`), only their fields. An
  unknown block or field is dropped on import, silently.
- **Words, not looks.** A block's `content` holds what it says: never a
  colour, a size or markup. Rich text is a list of nodes (`paragraph`,
  `heading` 2–4, `quote`, `list`), with `bold`, `italic`, `code` and links on
  spans. The look is the theme's: leave `style` out; pick a theme's `variant`
  if one fits.
- **A theme is a document.** To give the site one, copy a file from
  [`themes/`](themes/) into `theme.published` (Atelier, Studio, Plain). Do not
  invent token names.
- **Pictures** are `{ "src": "https://…", "alt": "…" }`, or files carried in
  `media`. Every picture says what it shows in `alt`.
- **Every page** gets a `description` (one or two sentences, for search
  engines) and `inMenu` when it belongs in the menu; `settings.menu: null` lets
  the site make the menu from those pages. `published` the same as `draft`
  publishes it; left out, it stays a draft for the owner.
- **Forms** are defined in `forms` and placed by a `form` block that names
  them. Every form asks for consent; the site has `contact` already.
- **More than one language:** `settings.languages`, and each page's
  `translations` (ADR 0032). Write the main language first.

What Uhlaka is and what it does: [README.md](README.md),
[docs/status.md](docs/status.md).

## Working on Uhlaka's code

- **Read the decision first.** Every decision is an ADR in
  [`docs/adr/`](docs/adr/), written before the work it decides; a change of
  direction gets a new one, marked *Proposed* until the maintainer confirms
  it. [ADR 0037](docs/adr/0037-direction.md) says where Uhlaka is going.
- **The site is served by Uhlaka's own server** (ADR 0044); the static export
  is an option for simple sites. Extensions run in a process of their own with
  only what they declared (ADR 0026, ADR 0041).
- **The core** (`src/core/`) is pure TypeScript: no database, no framework, no
  runtime. `test/gates.test.ts` holds it to that.
- **Nothing from a third party in a page**: no CDN, no font service, no
  tracker. Fonts and files are served by the site (ADR 0001 d3, ADR 0068).
- **No new dependency** without a decision. There is one at run time (Svelte).
- **Every input is cleaned** by the core's `normalize*` and `clean*`
  functions; nothing a visitor, an import or an extension sends is trusted.
- **A block type is added in one place** (`BLOCKS` in `src/core/blocks.ts`)
  and drawn in `src/blocks/`; `test/contract.test.ts` checks both, and
  `bun tools/content-schema.ts` brings the schema along (its test fails
  until you do).
- **Words** the admin or the site shows are in the language packs
  (`languages/`), English first, checked by the tests; Romanian ships
  complete.
- **Before you push:** `bun run check` (types, then every test). Development
  setup: [docs/development.md](docs/development.md). Contributions fall under
  [CLA.md](CLA.md).
- **Licence:** the core is AGPL-3.0-or-later; themes, language packs and the
  SDK are MIT (ADR 0020).
