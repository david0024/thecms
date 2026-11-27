# ADR 0080 — The logo: the UH monogram

- **Status:** Accepted (David, 2026-11-27: "ramane acest logo. arata foarte bine. deci stabilit definitiv."; the colours chosen the same day)
- **Date:** 2026-11-27
- **Builds on:** ADR 0068 (the Atelier theme and the faces that ship)

Uhlaka had no logo: the admin's tab showed the browser's blank icon, and the
README began with the name alone. Several rounds of sketches were drawn
(an arch, a weave, a rotated #, a mat, page and tool symbols). David chose
none of them; he brought a monogram of his own, and chose it.

## Decisions

### d1. The mark is the UH monogram

A U and an H drawn in thin parallel lines, white and blue on a black tile.
The right arm of the U becomes the left post of the H. It was drawn from
David's picture and cleaned up as a vector: every line 11 units on a 404-unit
tile, square ends, the posts lined up. The files are in [`brand/`](../../brand/);
they are the reference, not the picture.

### d2. Two colourways, by context

- **The original** (black, white, blue) is the main logo: the README, the
  admin, anywhere Uhlaka names itself.
- **The Atelier version** (Atelier blue tile, white U, yellow H) is for
  uhlaka.org, which wears the Atelier theme, and anywhere the logo stands
  next to that theme.

### d3. A separate drawing for 16 px

At 16 px the parallel lines run together. The tab icon is its own drawing:
only the U and the H, sharing the post, in strokes of 2 px on the pixel grid.

### d4. The admin shows it in the browser tab

The admin page names `/admin/icon.svg` as its icon, served by the program
from `brand/uhlaka-icon-16.svg` (no request leaves the site, ADR 0001 d3).
The admin's own screens keep showing the owner's site, not Uhlaka's logo:
the admin is the owner's, and the site's name stays at the top of the rail.

## Not decided here

- **The licence of the logo.** The core is AGPL and themes are MIT
  (ADR 0020); a logo is usually kept out of both, as a mark, with a short
  policy on who may use it. That is for Chef to decide.
- **A trademark search** for the mark has not been made.
- **The story of the name** (what *uhlaka* means in isiZulu) waits for a
  native speaker; it does not touch the logo.
