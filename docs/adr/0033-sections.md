# ADR 0033 — Sections: blocks written once, shown on many pages

- **Status:** Accepted (owner, 2026-11-20: reusable sections, simple, with translation by field; the details left to the project)
- **Date:** 2026-11-20
- **Builds on:** ADR 0001 d7 (one block vocabulary), ADR 0028 (versions), ADR 0029 (the check before publishing), ADR 0032 (translation by field)

A site for a business repeats itself: a "Get in touch" band at the end of
most pages, an offer on three of them. Copied by hand, each copy is changed
by hand. WordPress has "synced patterns" for this, so someone who comes from
there expects it.

## Decisions

### d1. A section is kept like a page, without an address

A section has a name (`get-in-touch`), a title, blocks and translations by
field (ADR 0032). It is written in the builder as a page is, has a draft and
a publication, and keeps its versions. It has no address: a visitor never
opens a section, only a page that shows it.

### d2. A page shows it with the "Section" block

The block `section` names one section. A page, an entry or a content type's
page may show any number of them. The page keeps only the name; the
section's blocks stay in the section.

A section does not show another section: the builder refuses to save one
that does, and one met inside a section draws nothing.

### d3. Drawn in the page's language, written out by the export

When a page is drawn, each section block gets the section's blocks in the
page's language: its words there, its own blocks where it is split, the main
language's otherwise. The export writes them out as HTML on every page that
shows them, so the site stays static and every link and picture in a section
is checked, and copied, as a page's are.

The canvas draws the section's drafts, as part of the page, but not to be
typed into: a section is changed where it is written.

### d4. Published on its own

Publishing a section changes every page that shows it, from the next
export. A page that shows a section that is not published, or no longer
there, shows nothing in its place.

### d5. Kept while something shows it

The list of sections says where each is shown: pages, entries and content
types' pages, in their drafts and as published. A section shown anywhere is
not deleted; the reason says where it is shown.

## Consequences

- One more list in the admin, "Sections", and one more block.
- The same mechanism can later fill parts of a page's layout (the band above
  and below it, a sidebar).
