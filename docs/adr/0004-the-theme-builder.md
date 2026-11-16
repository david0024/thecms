# ADR 0004 — The theme builder

- **Status:** Accepted
- **Date:** 2026-11-16
- **Builds on:** ADR 0001 d8 (a theme is a data document, and there is a visual
  theme builder), ADR 0002 d2 (token groups and style properties).

## Decisions

### d1. The builder edits the theme document and nothing else

It shows the theme's name, its tokens by group (colours, spacing, corners,
typefaces, text sizes, widths), and for each block type its default style and
its named variants. Each of those is a field of the document in
`src/core/theme.ts`. The builder has no state of its own that could differ from
what is saved.

### d2. A change that would leave the theme invalid is not made

Every change is tried on a copy and checked with `parseTheme`, the same check
the server runs. If the copy is not a valid theme, the change is dropped, the
field says why, and the site keeps the theme it had. So: a value that is not a
colour is never applied; a token still used by a block's default cannot be
removed; and the canvas never shows a half-applied theme.

*Why client-side as well:* the core is pure TypeScript, so the admin runs the
very same function the server does. The server still checks; the admin just
does not send what would be refused.

### d3. Block defaults and variants use the same style controls as a block

One component (`StyleEditor`) edits a style, whether it is a block's own, a
block type's default or a variant. In a theme the choices are the theme's own
tokens first, then a free value.

### d4. A theme has a draft and a published copy, like a page

The editor shows and changes the draft. The export uses the published copy.
"Publish theme" freezes the draft.

*Why:* without it, trying a colour in the builder would repaint the live site
on the next export. This follows ADR 0002 d6 for pages.

### d5. A theme is a file

"Download this theme" saves the document as `<name>.theme.json`. "Upload a
theme file" reads one, and it is checked like any other input: a file with any
issue is refused whole, with the first issues named. A theme file contains no
code, so opening one from a stranger runs nothing.

## Not yet

- ~~Header and footer are fixed components.~~ Done in ADR 0006. Page
  templates are still not built.
- **Undo** covers a page's blocks, not theme changes.
- **Dark mode** and per-screen-size values (ADR 0002 d2).
- **Typefaces** are still the device's own (ADR 0002 d3).
- **A check of contrast** between text and background colours.
- A token cannot be renamed; it is added and removed.

## Verification

`e2e/editor.cjs`, in a real browser: a colour changed in the builder repaints
the page; a value that is not a colour is not applied; a new token styles every
block of a type; a token in use cannot be removed; the downloaded file holds
what was built; a file with a bad value is refused whole; until the theme is
published the export keeps the published one; after publishing, the exported
stylesheet carries the theme as built, and no refused value is in it.
