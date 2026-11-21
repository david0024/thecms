# ADR 0010 — Content types

- **Status:** Accepted
- **Date:** 2026-11-17
- **Builds on:** ADR 0007 (the blog), ADR 0008 (the menu), ADR 0001 d7 (one
  vocabulary, data not code).

The site had pages and blog posts. A post was already "a page's blocks, a few
fields, and a list". A portfolio, a team page, a list of events are the same
thing with other fields, and in WordPress each one needs a plugin or code.
The owner asked why posts should be special at all.

## Decisions

### d1. A content type is data the owner writes

A type is a name, an address and a few choices: whether its entries are
dated, grouped by category, offered as a feed, and which extra fields each
carries. It is made in the admin from a form. Nothing about a type is code,
so a type cannot break the site and needs no plugin.

Types are kept in the site's settings, beside the menu.

### d2. Posts are a type that is always there

> Replaced by ADR 0025: no type is built in; the blog is an example the owner may rename or delete.

Someone coming from WordPress looks for "Posts" and finds it. It is not in
the owner's list of types, it cannot be removed, and it keeps its address
(`/blog/`) and its name from the site's settings. Everything else treats it
as one type among the others, so there is one code path, not two.

### d3. One document for every entry

An entry of any type is the same document: title, description, date, summary,
cover, categories, blocks, and `fields` for what its type adds. A type that
is not dated or has no categories simply does not use those parts. So the
editor, the store, the export and the import handle every type alike.

Entries are stored in one table keyed by type and address. A site made before
this ADR has its `posts` table moved into it the first time it is opened.

### d4. Fields come from a short fixed list

Short text, long text, date, image, link. Each value is cleaned as its kind,
with the same checks as anywhere else (an address that could run script is
refused). A field's key is made from its label once and then kept, so
renaming a field loses nothing.

There are no relations between entries, no queries, no computed fields and no
permissions per type. Those make a data platform, which is another product.
This one is for presentation sites. (Superseded by ADR 0037: relations
between entries and more kinds of field come in its stage 2; they came in
ADR 0052.)

### d5. Each type has a list and a page for every entry, under its address

`/projects/`, `/projects/<entry>/`, `/projects/category/<name>/`, and a feed
where the type asks for one. A dated type lists newest first; another lists
by title. How lists and entries look is the theme's; the extra fields are
drawn as a short list of name and value under the title.

### d6. An address belongs to one thing

A type may not take the address of a page, of the site itself, or of another
type, and a page may not take a type's. A type that still has entries cannot
be removed: the entries would be left at an address nobody chose.

### d7. The menu can lead to a type

A menu item can point at a type's list by name (ADR 0008 d3). Like the blog,
a type is left out of the menu until it has something to show, and the
automatic menu adds each type that does.

## Known gaps

- A type's list and entry pages have one layout; the theme cannot yet lay out
  one type differently from another.
- Changing a type's address does not leave redirects from the old one.
- Entries cannot be ordered by hand.
