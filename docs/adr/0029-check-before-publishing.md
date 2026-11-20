# ADR 0029 — The site is checked before it is published

- **Status:** Accepted (owner, 2026-11-20: asked for the clearly useful ideas from a review of SveltyCMS to be built; this was the second)
- **Date:** 2026-11-20
- **Builds on:** ADR 0001 (static export), ADR 0005 (a picture the site does not have stops the export)

A page renamed or unpublished leaves links to it on other pages, in the menu,
in a button. On a static site those links lead to a 404 the owner never sees.
A picture with no description is invisible to someone using a screen reader,
and to a search engine.

## Decisions

### d1. The output is read, not the pages

The check builds the published site exactly as an export does, in memory, and
reads the HTML. So every link counts, wherever it came from: a text, a button,
the menu, the footer, the language switcher, a list of entries. A link is to
the site when it starts with one `/`; links elsewhere are not followed.

### d2. A link that leads nowhere stops the export

As a missing picture already does (ADR 0005): nothing is written, the last
export stays, and the owner is told each address and the pages that link to
it. An address with `?` or `#` after it is the address before them.

### d3. A picture with no description is said, not stopped

Some pictures are only decoration, and the owner decides. The export prints
them as notes; the admin lists them.

### d4. In the admin, under the pages

"Check the site", under the list of pages, shows both lists. A missing
translation is not part of it: the list of pages already shows it ("+ ro").

## Not decided

- Links to other sites. Following them needs the network, and a site that is
  down today may be up tomorrow.
- Checking on each publish rather than on demand.
