# ADR 0052 — Relations between entries, and more kinds of field

- **Status:** Accepted (owner, 2026-11-21: chose "Aprob așa cum e", on the proposal of a field that links to other entries, picked by title in the editor, shown on both sides by itself, and four more kinds of field)
- **Date:** 2026-11-21
- **Builds on:** ADR 0037 d4 (stage 2: relations between entries and more kinds of field), ADR 0010 (content types; its d4 is superseded here), ADR 0011 (the block that lists entries), ADR 0015 (a type's own page)

A project has a client, a recipe its ingredients, a course its teacher, an
article "related articles". In WordPress this is ACF's Relationship field or
a plugin like it. Until now a thecms entry could hold only text, a date, a
picture and a link, so the owner wrote the client's name by hand on every
project and kept them in step.

## Decisions

### d1. A field that links to other entries

A content type's field may be of the kind **Link to entries** (`entries`).
The owner names the type it links to (`to`: Clients; the type itself, for
"related articles") and whether it holds one entry or several (`many`, at
most 20). The entry keeps the addresses of the entries it links to, in the
order the author put them.

A link field whose type is removed is removed with it. A type that still has
entries cannot be removed (ADR 0010 d6), so no entry loses what it held
without the owner emptying that type first.

### d2. Picked by title, in the editor

In the entry's settings the field is a short list of titles. "Add" opens a
search over the titles of the other type's entries, drafts among them; one
is chosen with a click. Each can be moved up or down or taken out. Nothing
is typed by hand, and an address is never shown.

### d3. Shown on both sides, by themselves

On the entry's page, among its fields, each linked entry is drawn as a small
card: its cover, if it has one, and its title, leading to it.

On the page of an entry that others link to, a list of them is drawn after
its blocks, with no step from the owner: under a client, "Projects", each
project that names it. The list is headed by the other type's name, and by
the field's name as well when that type has more than one field linking
here.

A type with its own page (ADR 0015) has a part for it, **Entries linked to
this one** (`related`); where the page does not place it, it is drawn after
the page, as on the default one. The block that lists entries (ADR 0011)
has the choice **Only those linked to the entry shown**: on an entry's page
it lists the entries of its type linked to that entry, either way; anywhere
else, nothing.

Only one step is drawn: a project shows its client, not the client's other
projects. Only published entries are shown to visitors; the editor shows the
drafts, as everywhere else.

### d4. Nothing is left pointing nowhere

Deleting an entry takes it out of every entry that links to it, in their
drafts and in what is published, at once. Before it is deleted the entry's
settings say where it is used ("Linked from 3 entries: …"), so the owner
knows what changes.

An entry keeps its address once it is made; when entries can be moved, the
links move with them, as a page's menu items do (ADR 0036).

Links are part of the entry, so they are in its versions (ADR 0045), in
backups (ADR 0051) and in an export.

### d5. Four more kinds of field

Besides short text, long text, date, image and link, a type's field may be:

- **Number**: a price, an area, a year. Kept as a number; shown in the
  site's language's way of writing numbers.
- **Yes or no**: available, sold out. Not drawn until it is set; then
  "Yes" or "No", in the site's language.
- **Choice from a list**: the owner writes the choices, one per line (at
  most 30); the author picks one. A choice taken off the list is no
  longer shown on the entries that held it.
- **File**: a document from the media library (ADR 0046), drawn as a link
  with its words. The export takes the file along, as it does a picture.

Each value is cleaned as its kind, as the others are. A field's kind can
still be changed; a value that does not fit the new kind is emptied.

### d6. Limits, so that it stays simple

- Links are between entries only, not to pages, and are drawn one step deep.
- Lists are not yet filtered or ordered by a field ("only those available",
  "cheapest first"). That comes with archives, later in stage 2.
- A type still has at most 12 fields (ADR 0010).

## Consequences

ADR 0010 d4 ("no relations between entries") is replaced by d1–d5 here; its
text is kept, as the earlier reasoning. The data an entry keeps is still one
document, so the editor, the store, the export and backups need nothing new
to carry links.
