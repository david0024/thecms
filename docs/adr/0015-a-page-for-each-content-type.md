# ADR 0015 — A page for each content type

- **Status:** Accepted
- **Date:** 2026-11-19
- **Builds on:** ADR 0010 (content types), ADR 0003 (the editor works on the real page).

Every entry of a type was drawn the same way: title, date, cover, fields, then
its own blocks. A project page and a team member's page want different things
around the entry: a hero, a contact block, a list of other projects. The owner
asked that how a type looks be designed like any page, in the builder, and not
written in a template language.

## Decisions

### d1. A type's page is a page of blocks

A content type may have a page of its own: a list of ordinary blocks, kept
with the site. A new block, **Part of the entry**, places one part of the
entry being shown: the header (title, date, cover and fields together), the
title, the date and categories, the cover, all fields, one field, or the
entry's own blocks. Anything else on the page is an ordinary block and is the
same for every entry.

A type without a page of its own is drawn exactly as before. The default page
is two parts, the header and the entry's blocks, so starting from it changes
nothing a visitor sees.

### d2. Draft and published, like everything else

The page is saved as a draft and published on its own. Visitors keep the
published one until the owner publishes again. Going back to the default page
is itself a change that is published. An image used on the page is exported
and cannot be deleted while the page shows it.

### d3. Designed around a real entry, edited inside the real page

The builder opens the type's page drawn around the newest entry, or around an
example when the type has none. That entry is shown, not edited: clicking it
selects the part that holds it.

When an entry is edited, it is drawn inside its type's page, so the owner sees
it as visitors will. The page around it cannot be selected or typed into;
only the entry's own blocks can. The editor tells the two apart by a marker on
the region (`data-frozen`, `data-live`), which never reaches the export.

### d4. No loops, no script

A part of the entry draws nothing on an ordinary page, and nothing inside the
entry's own blocks, so an entry cannot hold itself. A field is drawn as text,
and an empty field is not drawn. No expression, condition or loop exists in a
type's page: what cannot be said with blocks and parts is a request for a new
part, not for a template language.

## Not done here

- A different page for each category of a type.
- The type's list page (`/projects/`) designed the same way.
