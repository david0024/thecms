# ADR 0011 — A block that lists entries

- **Status:** Accepted
- **Date:** 2026-11-17
- **Builds on:** ADR 0001 (blocks as data), ADR 0010 (content types).

Entries had their own list (`/blog/`, `/projects/`) and nowhere else to
appear. A home page could not show the latest posts, which is what most
WordPress front pages do.

## Decisions

### d1. The block holds a question, not an answer

`entries` stores a title, the name of a content type, how many to show, and
the words of the link to the whole list. It never stores the entries. They
are looked up when the page is drawn, so a page is never stale: publish a
post, export, and every list that should show it does.

This is the first block whose markup depends on something outside itself.
The rule that keeps it honest: what it reads is handed to the renderer by the
caller (`EntryLists`), never fetched by the block. The export hands it what
is published; the editor's canvas, the drafts.

### d2. The order is the type's own

A dated type shows its newest; another shows the first by title. The block
has no sorting or filtering of its own. A block that could query would be a
second place where "which entries" is decided.

### d3. Nothing to list means nothing drawn

With no entries, or a type the site no longer has, a visitor sees the block's
title and no list and no link. Only the author, in the editor, is told that
it is empty.

### d4. Two new field kinds

`source` (a content type's name) and `number` (bounded). Both are declared in
the block vocabulary like every other field, so cleaning and the editor's
form come from the one declaration (ADR 0001 d7).

## Known gaps

- No filter by category, and no way to pick particular entries by hand.
- One layout (cards). Variants of it are the theme's to add.
- A page that lists entries is not marked as changed when an entry is
  published; it is simply right at the next export.
