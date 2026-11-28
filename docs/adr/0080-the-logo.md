# ADR 0080 — The logo: the UH monogram

- **Status:** Accepted (David, 2026-11-27: "ramane acest logo. arata foarte bine. deci stabilit definitiv."; the colours, the mark's terms, the name's story and the tagline chosen the same day)
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

### d5. The logo is a reserved mark, not under the code's licences

The core is AGPL and themes are MIT (ADR 0020); neither covers the name
Uhlaka or its logo. They stay the project's mark, as WordPress keeps its own
(David, 2026-11-27: "e marca rezervata, clar"):

- **Anyone may use them to talk about Uhlaka**: in an article, a talk, a
  list of tools, a tutorial, a link to the project, a page that says a site
  is made with Uhlaka.
- **Not on a fork, or on a product or service that could pass as the
  official one.** A fork takes its own name and its own logo.
- **Not changed**: no redrawing, recolouring or stretching; the files in
  `brand/` are the reference.

`brand/README.md` says this where the files are; the README's licence
section points to it.

### d6. The name's story and the tagline

The README tells why the name, in three short paragraphs: *uhlaka* is a
framework and the outline drawn before speaking; a site needs a frame that
holds, as the logo's U holds its H; and the frame is a plan, not code, that
a person and an AI both read and neither can break. The tagline is
*Structure first. Built for humans and AI.* (David, 2026-11-27: "da, imi
place. asa le facem"). uhlaka.org tells the same story.

## Not decided here

- **A trademark search** for the mark has not been made, nor a registration.
- **A native speaker's reading** of the story (d6). It uses only the
  meanings found in sources: *uhlaka* as "framework" (an official South
  African document, Microsoft's glossary) and as the outline of a talk.
  Other meanings that were going around (the woven frame of a hut, a
  stretcher) could not be confirmed and are left out.
