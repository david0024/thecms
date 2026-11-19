# ADR 0016 — A category that is a section of its own

- **Status:** Accepted
- **Date:** 2026-11-19
- **Builds on:** ADR 0009 (WordPress import), ADR 0010 (content types), ADR 0012 (import from the admin).

Many WordPress sites have no custom post types. They keep their projects,
their team or their events as ordinary posts filed under a category
("Projects"), because that was the easy way in WordPress. Brought over as
posts, those projects end up in the blog, mixed with the news. The owner asked
that the import help put each kind of content where it belongs.

## Decisions

### d1. The import offers each category, and the owner chooses

The import screen lists every category posts were filed under, with how many
posts each holds. The owner ticks the ones that are a section of their own.
The plan is read again at once, so the counts show what would happen before
anything is written. On the command line, `--categories=projects,team` does
the same.

Which categories are sections cannot be told from the file, so nothing is
chosen for the owner.

### d2. A chosen category becomes a content type, and its posts its entries

The type takes the category's name and address (`/projects/`). Its entries
keep what made them posts: a date, the newest first, a feed. A post filed
under two chosen categories goes to the first one it lists. Entries of such a
type are not grouped by category, so a post that had other categories too
loses them, and the owner is told which posts.

### d3. Every old address still leads somewhere

The old address of each post leads to its entry, the category's old archive
(`/category/projects/`) leads to the type's list, and links and menu items
that pointed at either are rewritten to the new addresses.

## Not done here

- Mapping a category onto a content type the site already has.
- Turning a category's custom fields (from a plugin) into the type's fields.
