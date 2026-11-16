# ADR 0002 — The first slice: documents in, a static site out

- **Status:** Accepted 2026-11-16 (owner: "mergem pe ceea ce propui tu")
- **Date:** 2026-11-16
- **Builds on:** ADR 0001 (d7 a block keeps content and style apart; d8 a theme
  is data; d9 SQLite and static export).
- **Inputs:** a read of MYCMS (`david0024/MYCMS`), the owner's earlier CMS, and
  the first working code in this repository.

ADR 0001 left four points open and said the prototype would settle them. This
records how the first slice settled them, and what it took from MYCMS.

## What the slice is

Pages, a theme and site settings go in as documents; a static site comes out.
There is no editor yet. That order is deliberate: the editor is a way of
changing these documents, so the documents and the rules that keep them clean
come first and are tested on their own.

```
src/core/     documents and their rules; pure TypeScript
src/blocks/   one Svelte 5 component per block type, and the shared layout CSS
src/site/     the SQLite store, the static export, the command line
themes/       themes, as JSON
```

## Decisions

### d1. Rich text is a document of typed nodes, not HTML

Paragraphs, headings (levels 2 to 4), quotes and lists, holding spans with
marks (bold, italic, code) and an optional link.

*Why:* stored HTML has to be sanitised on every write and every read, and one
miss runs a script for every visitor. MYCMS does exactly that, carefully, with
an allow-list applied twice. A typed document has no such path: the renderer
draws the nodes it knows and escapes every string. The price is a converter
from HTML for the WordPress import, which is written once.

### d2. The token groups, and the properties a block may set

Six token groups: `color`, `space`, `radius`, `font`, `size`, `width`. Every
theme defines a required set in each (`REQUIRED_TOKENS`), so a block bound to
one of those looks right under any theme. A theme may add tokens; a reference
to a token the current theme lacks writes nothing, and the theme's default for
that block shows.

A block may set eleven properties (`STYLE_PROPS`): background, colour, padding
(block and inline), margin, gap, radius, typeface, text size, width and
alignment. The list is closed and grows on purpose.

A free value must be plainly a colour, a length or a known name. It is checked
when it is saved and again when the stylesheet is written. Nothing is escaped:
what does not match is dropped. This is the same rule as Zveltio's theme
(`packages/ui/src/theme.ts`), applied to blocks as well.

*Not yet covered:* dark mode, and per-screen-size values. Both are additions to
this model, not changes to it.

### d3. Typefaces come from the visitor's device, for now

`font` values are names of system font stacks. No font file is requested, so no
request leaves the site (ADR 0001 d3). Self-hosted typefaces, as MYCMS ships
them, join this list when the media library can serve files.

### d4. `@zveltio/ui` is not a dependency of this slice

Its block components draw with Tailwind and daisyUI class names, and its theme
is daisyUI's token set. Using them would make every export run a Tailwind build
and would hand the token vocabulary to daisyUI, when the theme builder (ADR
0001 d8) needs to own it. The blocks here are a few lines of markup each over
CSS custom properties, and the whole stylesheet of a site is a few kilobytes.

This narrows "use the packages as dependencies" from the brief, so it is the
owner's to overturn. Nothing was copied from Zveltio; the tree operations
follow the same behaviour and are written against our own block shape.

### d5. One package, with the core kept pure by a test

The repository is one package for now. `src/core` imports nothing but itself:
no database, no framework, no runtime API, and `test/gates.test.ts` fails if
that changes. A package is extracted when something else needs it (the brief's
rule), and the core can be extracted at any time because of this gate.

### d6. Taken from MYCMS

- **Draft and published are separate.** A page keeps its draft and a frozen
  copy of what was last published; visitors and the export see only the copy.
- **Clean on the way in and again on the way out.** A row written before a
  rule was tightened is read under today's rules.
- **The editor will show the real page.** MYCMS renders the page with the
  public renderer inside a frame and marks what can be edited. `renderPage` is
  written to serve both for that reason. This is the plan for the next slice.

Not taken: themes as CSS text (they contradict ADR 0001 d8), HTML rich text
(d1), many sites in one database (ADR 0001 d9 is one file per site), the shop
(ADR 0001 d2).

### d7. The store uses Bun's SQLite directly

`src/site/store.ts` uses `bun:sqlite`. Cloudflare D1 and Turso need the same
operations behind an interface; that interface is written when the second
database arrives, from two real implementations instead of a guess.

## What the tests hold

Each was broken on purpose once, to see it fail:

- a free value that is not a colour, a length or a known name never reaches a
  stylesheet, even when it is forged past the first check;
- changing the theme leaves every page's HTML byte for byte the same; only the
  stylesheet changes; "reset to theme" removes free values and nothing else;
- text an author typed is never markup, read the way a browser reads it;
- an exported page has no script, no request to another host and no framework
  marks;
- the renderer draws exactly the block types the core defines;
- the core imports nothing from outside itself;
- an export never empties a folder it did not make.

## Next

The editor: add, move, remove and edit blocks on the real page, with the style
panel offering the theme's tokens first.
