# ADR 0028 — What was published is kept, to bring back

- **Status:** Accepted (owner, 2026-11-20: asked for the clearly useful ideas from a review of SveltyCMS to be built; this was the first)
- **Date:** 2026-11-20
- **Builds on:** ADR 0002 (a draft, and a copy for visitors), ADR 0010 (content types), ADR 0015 (a page for each content type)

Someone coming from WordPress expects to undo a mistake made yesterday, not
only the one made a minute ago. The editor's undo lasts while the page is
open. This keeps what visitors saw.

## Decisions

### d1. A version is a publication, not a save

The editor saves a draft 0.7 seconds after each change, so a version per save
would be hundreds of near copies of the same page. What matters is what
visitors saw: each time a page or an entry is published, that copy is kept,
with when. The newest twenty of each are kept; an older one is dropped.

### d2. Brought back as a change

Bringing a version back puts it in the editor as a change: the person looks at
it, undoes it, or publishes it. Nothing is published by bringing it back, and
the draft that was there is one undo away.

### d3. Pages and entries alike, never a type's page

Versions are kept in one table, `versions (kind, slug, at, doc)`: `page` for a
page, the type's id for an entry. Deleting a page or an entry deletes its
versions. A type's page (ADR 0015) is design, not content, and has none.

## Not decided

- Comparing two versions side by side.
- Keeping versions of the theme and the site's settings.
