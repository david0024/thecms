# ADR 0006 — The header and footer

- **Status:** Accepted
- **Date:** 2026-11-16
- **Builds on:** ADR 0001 d7 (content and style are kept apart), d8 (a theme is
  a data document, and covers the header and footer), ADR 0004 (the builder).

Until now the header and footer were fixed: the site's name, the menu, one
line of text. ADR 0001 d8 says they belong to the theme. This decides which
part of them does.

## Decisions

### d1. What they say is the site's; how they look is the theme's

The same split as for a block (ADR 0001 d7), applied to the two parts every
page shares.

- **The site** holds what is said: its name, a logo, one button in the header,
  the footer's text and its links. These are content. They survive a change of
  theme untouched.
- **The theme** holds how it is laid out: an arrangement for the header and one
  for the footer, whether the header stays on screen while the page scrolls,
  and a style for each (the same style properties a block has, bound to tokens
  or free).

A theme that carried the logo or the footer text would take them away when the
owner tried another theme. A site that carried the header's colour would not
follow the theme. Neither is acceptable, so neither is possible.

### d2. An arrangement is a name from a closed list

`inline`, `centered`, `stacked` for the header; `inline`, `centered` for the
footer. A theme picks one by name. It cannot describe a layout of its own,
because a theme is data and not CSS (ADR 0001 d8); a new arrangement is added
to the list on purpose, like a block type.

### d3. The markup is the same under every theme

The header and footer are always the same HTML. An arrangement reaches them
through the stylesheet alone: it sets a few custom properties that their one
flex row reads.

So the rule that made themes safe for blocks holds for the whole page: changing
the theme changes the stylesheet and not one byte of any page.
`test/layout.test.ts` draws a page under two themes with different layouts and
compares the markup.

### d4. The theme is written after the structure

The stylesheet was the theme's rules followed by the shared structure. Where
both set the same property on the same class, the structure won, so a theme
could not, for instance, change the hero's default spacing. The order is now
structure first, theme after. Found while giving the header a background.

### d5. The layout is optional in a theme file

`layout` may be left out, and a theme file written before this ADR loads with
the default (`inline`, not pinned). The spec stays `thecms.theme/1`. When
present it is checked like the rest: one bad value refuses the whole theme.

### d6. Site settings have no draft

A page and the theme each have a draft and a published copy. The site's
settings (name, logo, button, footer) do not: they are used by the next export.
A site is published by exporting it, so nothing reaches visitors without that
step either way. If hosted, always-live sites arrive, this needs another look.

### d7. In the editor the header is never pinned

A header that stays on screen would sit on top of the block being edited and
of the places a block can be dropped. The canvas shows it where it starts and
lets it scroll away. This is the one place the canvas knowingly differs from
the public page.

## Not yet

- **A menu for small screens.** The menu wraps onto more lines; there is no
  button that opens it. A static page has no script, so this is a CSS-only
  disclosure and needs its own care for keyboard and screen-reader users.
- **Menu order and sub-menus.** The menu is the pages, in the order they were
  made.
- **Several footer columns**, a logo with the name beside it, a favicon.
- **Page templates** (a landing page without header, a page with a sidebar).

## Verification

`e2e/editor.cjs` changes the header's arrangement and background in the theme
builder and checks that its markup did not change; edits the footer and uploads
a logo from the site settings; then checks the exported pages and stylesheet.
`test/layout.test.ts` holds d1 to d5 without a browser.
