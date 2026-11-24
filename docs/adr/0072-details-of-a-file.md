# ADR 0072 — The details of a file in the media library, and a way out to the site

- **Status:** Accepted (Liviu asked for both on 2026-11-24, from a review of the admin; "ai acordul meu si al lui David", Liviu, the same day)
- **Date:** 2026-11-24
- **Builds on:** ADR 0005 (images stored with the site), ADR 0046 (documents, sound and video), ADR 0051 (backups), ADR 0057 (a complete export)

A review of the admin, done as a beginner would use it, found two things a
WordPress user looks for first and does not find. The media library showed a
file's picture, the name it was uploaded under and its size, and nothing could
be changed: not its name, not the words for people who cannot see it. Those
words lived only in each Image block, typed again each time the same picture
was put on another page. And nothing in the admin led to the site itself.

## Decisions

### d1. A way out to the site, and an address for each screen

The site's name at the top of the menu leads to the site, in a tab of its own.
The builder has "View on the site" for a page or entry that is published, and
a published page's address in the lists is a link to it. Each screen writes
its address after the key (`#token=…&at=media`, `at=edit/page/about`), so
reloading keeps the screen, Back goes to the one before, and a screen opens
in a new tab. An address the admin does not know, or that is not this
person's, is left alone; the server still decides what each person may do.

### d2. A file has a name in the library, which can be changed

Choosing a file opens its details beside the list: a larger picture, its
name, what it is (PNG, PDF), its size, its dimensions, when it was uploaded,
its address with a button that copies it, and the pages that use it, as the
server already knew to refuse a delete. The name is only the library's; the
file's address is made from its bytes and never changes, so no page breaks.
The owner and the editors rename; authors and contributors read.

### d3. A picture's words are kept with it, as the words offered

A picture can be described in the library: the words for people who cannot
see it. They are offered each time the picture is put on a page (chosen from
the library in an image field), and each page can change them there. A page
that already shows the picture keeps its own words: describing it later does
not reach into pages, as in WordPress. Only a picture has these words.

They are kept in a table of their own, `media_texts (name, alt)`, beside
`media_sizes`: older sites open unchanged, and the table goes into backups and
comes back from them. A content file (ADR 0057) carries a picture's words as
`alt`, which the schema of a content file (ADR 0069) now names.

A caption stays with the block that shows the picture: it says something
about the picture on that page, not about the file.

### d4. Where a file is used, asked when it is shown

`GET /api/media/used?name=` answers with the titles of what shows or links to
the file: pages, entries, a type's own page, the logo and the picture for
sharing. `PUT /api/media?name=` takes a new name and a picture's words.

## Not now

The rest of the review (grouping the menu, settings as a screen of their own,
a start screen, a bar on the site for whoever is signed in, the admin on a
phone, the panel of blocks) changes how the admin is organised, and is
discussed with David first.
