# ADR 0068 — Typefaces that ship with Uhlaka, button colours, and the Atelier theme

- **Status:** Accepted (Liviu chose direction "B Atelier" for uhlaka.org on 2026-11-24, out of three shown; David confirmed it the same day)
- **Date:** 2026-11-24
- **Builds on:** ADR 0001 d3 (no third-party request; fonts are self-hosted), ADR 0001 d8 (a theme is data), ADR 0002 d3 (typefaces), ADR 0004 (the theme builder), ADR 0006 (header and footer)

uhlaka.org wore the default theme, Plain, and it looked like any generated
site: the device's own typeface, one blue, six identical grey cards. Three
directions were drawn for it; Atelier was chosen: a deep blue with a sunny
yellow for buttons, a characterful display face for headings, a friendly
sans for text, and cards in a few soft colours.

The theme document could not say that. Typefaces were only stacks the device
already has; a button always took the primary colour, so a hero in the
primary colour hid its own buttons; every card was the surface colour. This
adds what was missing, each as data a theme holds, never as CSS.

## Decisions

### d1. Typefaces Uhlaka carries, served by the site itself

ADR 0001 d3 already said fonts are self-hosted. The program now carries two
families under the SIL Open Font License, in `fonts/`: Bricolage Grotesque
(for headings) and Figtree (for text, with its italic). They are two more
choices in the typeface list, `bricolage` and `figtree`, each a stack whose
fallbacks are the nearest device faces.

- The files are WOFF2, split into Latin and the rest of the Latin letters
  (ș, ț, ő...): a page loads only the files its words need (`unicode-range`).
  All six files are about 170 KB together.
- A site serves them at `/assets/fonts/`, from the program, with
  `font-src 'self'`: no request leaves the site.
- A site carries, declares (`@font-face`) and exports only the families its
  theme or its pages name. A site on Plain is byte for byte what it was.
- The canvas declares all of them, so trying a face in the theme builder
  shows it at once.

*Why not any font file the owner uploads:* a font is code a browser parses,
and licences vary. Faces that ship are checked once, here. More can join the
list the same way.

### d2. A block sets the colours of its buttons

Two style properties join the closed list: `buttonBackground` and
`buttonColor`, both colours, bound to a token or free like any other. A theme
uses them on a block type, a variant, the header or the footer; an owner on a
single block. Where none is set, a button is the primary colour, as before.

A theme may also give buttons their own corners: a radius token named
`button` (Atelier: fully round). Without it, buttons keep `md`.

The lead line of a hero follows the hero's text colour, a little softer, so a
hero in a dark colour stays readable.

### d3. Tints for the cards of a services block

A theme may define the colours `tint-1` to `tint-4`. Where it does, the cards
of a services block wear them in turn; where it does not, they keep the
surface colour. No block or page changes.

### d4. Atelier ships with Uhlaka

`themes/atelier.json`: background `#f7f8fc`, primary `#2337a8`, buttons in
the hero and header `#ffd24d`, footer `#18267a`, tints blue, yellow, mint and
peach; Bricolage Grotesque for headings and Figtree for text. Its hero is in
the primary colour (variants `centered` and `light`), and an image has the
variant `on-primary`, to sit on the hero's colour under it. It is a theme like
the others: chosen in the editor, changed in the builder, saved as a file.
uhlaka.org wears it.

## Not yet

- The editor's own screens keep their look; this is about sites.
- Letter spacing and weights of headings are not theme values.
- Navigation beside the documentation (a list of the guides) is its own
  decision.

## Verification

`test/site.test.ts`: a site on Atelier declares the faces and carries their
files, and every `url()` in its stylesheet is one of its own files; a site on
Plain carries none; the hero's button colours and the tints reach the
stylesheet. `test/served.test.ts`: the canvas's stylesheet declares every
face, the site serves them as `font/woff2` whether published or not, and a
page's `content-security-policy` allows the site's own fonts.
