# ADR 0054 — Entries in more than one language

- **Status:** Accepted (owner, 2026-11-21: agreed to the direction as proposed; on a list in another language, "Doar cele traduse")
- **Date:** 2026-11-21
- **Builds on:** ADR 0024 (the same page in more than one language), ADR 0032 (translation by field), ADR 0034 (actions on translations), ADR 0010 (content types), ADR 0040 (comments), ADR 0042 (search), ADR 0052 (relations and more fields)
- **Replaces:** the "Not decided here" of ADR 0024 and ADR 0032 on posts and entries, and the "Not yet" of ADR 0034 on entries

Since ADR 0024 a page can be in several languages, and since ADR 0032 it is
translated field by field. Posts and the entries of every other type stayed in
the main language: the Romanian site of an English workshop had its pages in
Romanian and its blog in English, and the Romanian menu had no blog at all.
Stage 2 of ADR 0037 d4 names entries in more than one language. WordPress needs
a plugin for it (WPML, Polylang); thecms does it as it does pages.

An example. An English workshop with a Romanian site writes "How we restored
an oak table" at `/blog/oak-table/`. Beside it in the list of posts there is
"+ ro". The owner writes its Romanian title, summary and words, and gives it
the address `masa-de-stejar`. The blog is called "Jurnal" in Romanian, at
`/ro/jurnal/`, so the post is at `/ro/jurnal/masa-de-stejar/`. Its cover, its
date and its category are the English post's; its category is written
"Restaurare" in Romanian, once, in the blog's settings.

## Decisions

### d1. An entry is translated field by field, as a page is

An entry keeps, for each other language it is in: its address there, its
title, description, summary and title for search engines, the words of its
blocks (as ADR 0032 d2 keeps a page's), and the words of its type's fields.

- **Translated:** the title, the description, the summary, the words of the
  blocks, a short or long text field, what a picture shows (the cover's and an
  image field's description), a link's and a file's words.
- **Common:** the date, the cover and every picture, a number, yes or no, a
  date field, a choice, a file, a link's address, the links to other entries,
  the categories and the tags. A choice, a category and a tag are written in
  each language by the type (d3), not by the entry.

A value the same as the main language's is not kept. A field with no value
shows the main language's: an entry half translated is a whole entry.
Writing a translation does not change the layout (ADR 0032 d3), and an entry
can be split for a language (ADR 0032 d4).

### d2. An entry is in a language once it is started there

An entry is started in another language from its list, with "+ ro", and
opened in the editor at `ro/<its address>`. Until then it is not in that
language. **A list in another language shows only the entries started in it**
(owner, 2026-11-21): a Romanian visitor is not shown English posts in the
Romanian blog. So are its categories, its tags, its feed, the block that lists
entries on a page in that language, and the links of a link field (ADR 0052):
an entry links, in Romanian, only to the entries in Romanian.

### d3. A type has its name, its address and its words in each language

In the type's settings, each of the site's other languages has the type's
name ("Jurnal"), the name of one ("Articol"), its address (`jurnal`, at
`/ro/jurnal/`), and the type's words in that language: each category and tag
its entries use, and each choice of its choice fields ("Restoration" is
"Restaurare"). Each is written once. Left empty, it is the main language's,
under the language's prefix: `/ro/blog/`, "Restoration".

An address a type takes in a language is taken there: no other type and no
page in that language may have it.

### d4. One entry, one draft, one publication

A translation is part of its entry, as a page's is (ADR 0032 d5): saved into
the entry's draft, published with it, kept in its versions. Publishing the
Romanian post publishes the post. Removing a translation takes the entry out
of that language from its next publication. A language a translated entry is
in is not removed from the site (ADR 0032 d8).

### d5. In its language, an entry is drawn in that language

- The page says `lang="ro"`; the site's words, the header, the footer and the
  menu are that language's (ADR 0024 d4).
- The menu's link to a type's list leads to its list in that language, under
  its name there, when the type has entries in it. Until now such a link was
  left out of the menu in every other language.
- The switcher leads to the entry in each language it is in, and to that
  language's home page where it is not. The head lists each language it is in
  as `hreflang`. A type's list says where it is in each language that has
  entries of it.
- The breadcrumbs start at that language's home page.

### d6. Comments and search stay in their language

- A comment written under the Romanian post is kept with its language and
  shown under the Romanian post only. The comment form says which entry and
  which language; the owner approves it as any other.
- The search field on a page in another language asks in that language. Its
  answer is drawn in that language's frame and lists only that language's
  pages and entries.

### d7. The check says what is not translated

The check before publishing (ADR 0029, ADR 0032 d6) lists, for each published
entry and language, how many texts still show the main language's words. It
warns, as for pages.

### d8. Actions for each language work on entries

"Translate this page, in every language" (ADR 0034 d2) is offered on an entry
too. For each language the entry is not split for, it starts the translation
where there is none and fills in only what it does not say yet: the title,
the description, the summary and the words of the blocks. The type's text
fields are sent with the entry and are written by hand for now.

## Not yet

- An entry written only in another language, with no entry in the main one.
- The words written on a type's own page (ADR 0015) are the main language's in
  every language.
- Bringing translations from WordPress (WPML, Polylang).
- An action for each language that also fills in a type's text fields.
