# ADR 0055 — Authors and contributors

- **Status:** Accepted (owner, 2026-11-21: agreed to the roles as proposed, "Da, cum ai propus", contributors uploading images included)
- **Date:** 2026-11-21
- **Builds on:** ADR 0022 (accounts), ADR 0010 (content types), ADR 0054 (entries in more than one language), ADR 0037 d4 (stage 2)

Since ADR 0022 a served site has two roles: the owner, who may do everything,
and the editor, who writes and publishes every page, post and entry. A blog
written by several people needs less than that for most of them: someone who
writes their own posts and nothing else, and someone whose posts are read
before they are shown. WordPress has both, as Author and Contributor; stage 2
of ADR 0037 d4 names them.

An example. Ana is an author on a firm's blog. She writes "How to choose an oak
door" and publishes it; the post shows "by Ana Pop" under its title, and her
short description at its end. She cannot open the site's pages, the theme or
the settings, and cannot change Mihai's posts. Mihai is a contributor. He
writes a recipe and sends it for review. The owner sees it under "To review",
reads it and publishes it, or sends it back with a word on what to change.

## Decisions

### d1. Four roles

- **Owner:** everything (ADR 0022).
- **Editor:** as in ADR 0022: every page, post and entry, and what is
  published.
- **Author:** writes, publishes, sets for later and deletes their own posts
  and their own entries of every type, in every language. Uploads images and
  files. Reads the others' entries, and the pages, without changing them.
- **Contributor:** writes their own posts and entries and uploads images and
  files, but publishes nothing. "Send for review" stands where "Publish" is.
  Once an entry of theirs is published, it is no longer theirs to change or
  delete.

What only the owner and the editors do: pages, sections, the menu, comments,
statistics, deleting from the media library, pages behind a password, and every
action of an extension for each language. The owner's own part (ADR 0022 d4)
stays the owner's.

The server decides; the admin hides only what the server would refuse.

### d2. Every entry has an author

Whoever creates an entry is its author. An entry made before this record has
none until an editor gives it one. The owner and the editors change an entry's
author in the editor, among the people who have an account; an author or a
contributor cannot give their entry away.

A translation (ADR 0054) is its entry's: the entry's author writes it.

### d3. A name and a few words about each person

Each person has a name shown on the site and a short description, up to 300
characters, which they set themselves on a "Me" screen. Under the title of a
dated entry (a post) the site shows "by" and the author's name, beside the date;
at its end, the description, when there is one. An entry whose author has no
name shows no byline. For search engines, a post's author is that person
(schema.org `Person`), not the business.

The name and the description are read when the site is built: a new name shows
on every post of that person at once, without publishing them again.

### d4. Review

A contributor's "Send for review" marks the entry as waiting. The owner and
the editors see every entry waiting, with who wrote it, on a "To review"
screen, and the list of its type says "waiting" beside it. They open it,
change it if they want, and publish it, which ends the review; or they send
it back with a note of up to 500 characters, which the contributor sees on
their entry, and send it for review again when it is ready.

The site sends no email for it: as with invitations (ADR 0022 d3), the people
who review open the admin.

### d5. Someone removed leaves their entries to someone

When the owner removes someone, their entries pass to the owner who removes
them, or to another person the owner chooses. Nothing is unpublished or
deleted.

## Not decided here

- Archives by author (`/blog/author/ana-pop/`) and by date: the next record.
- A picture of each person: their description is words only for now.
- Custom roles, or a role limited to one content type.
