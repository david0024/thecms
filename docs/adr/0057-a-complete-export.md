# ADR 0057 — A complete export: the content in one file, the data as JSON, the site as a ZIP

- **Status:** Accepted (owner, 2026-11-22: chose "Toate patru, cum am propus" on the proposal of a content file with an import back, the site's data as JSON beside its pages that can be turned off in the settings, and the static export downloaded as a ZIP from the admin)
- **Date:** 2026-11-22
- **Builds on:** ADR 0037 d4 (stage 2: "the site's data as JSON in the export and a complete export of the site"), ADR 0009 and ADR 0012 (the import, plan first), ADR 0043 (pages behind a password), ADR 0044 d3 (the static export, an option that says what it loses), ADR 0051 (backups)

A WordPress owner leaves, or copies a site, with Tools → Export: one file with
the content, which another WordPress site, or another CMS, takes in. That is
what WordPress users most fear losing (the comparison of 2026,
"Content that leaves easily"). thecms had two halves of it: the backup, which
puts a whole site back as it was (accounts, messages and all) but is not meant
to be read; and the static export, which wrote the published site as files,
from the command line only. This record closes stage 2 with the rest.

## Decisions

### d1. The content in one open file

The admin's new **Export** screen gives the content as one file,
`<site>-<day>.thecms.json`: JSON, `"format": "thecms.content/1"`, with the
documents as the store keeps them, so anyone can read it and the program can
take it back without a translation.

It holds, for each page, section and entry, what is being written and what
visitors see (both, so neither is lost), the hour it is set to be published,
and whether it was behind a password; each content type with its own page;
the forms; the theme (being changed and published), the settings with the
menu, the layouts and the old addresses; who wrote each entry, as the site
shows them (name, address, words and picture), and the comments the site
showed; and the pictures and files, each with its smaller copies, as base64.

It never holds what belongs to the people of a site and not to its content:
the accounts and their passwords, the password of a page, the messages
visitors sent, a comment waiting for approval, the address any comment was
sent from, the statistics, the installed extensions and their data. Putting a
whole site back as it was is the backup's work (ADR 0051), and the screen says
so.

The owner chooses **the whole site**, or some parts: the pages, each content
type, the sections, the forms, and "theme, settings, menu and old addresses".
The whole site carries the whole media library; a part carries only the files
it shows or links to. `thecms export <site> <file>.thecms.json [--parts=…]`
does the same from the command line.

### d2. The same file goes back in, by the import screen

The Import screen takes a content file as it takes a WordPress export, by its
content: it is read and counted first, nothing is written until the owner
says so, and nothing already in the site is replaced. A page, section, form or
entry whose address is taken is left as it is and named; so is a content type
whose address a page holds, with its entries. The files keep their names,
which are made from their bytes, so every link to them still works.

- "Take the old site's settings, menu, layouts and theme too" is offered when
  the file holds them, off by default; off, they are left as they are.
- A page that was behind a password comes as a draft, and the screen says why:
  the password is not in the file, and a page published without it would be
  shown to everyone.
- What was set to be published later is set again, when that hour is still
  to come.
- The people who wrote come as they do from WordPress (ADR 0056 d6): the one
  here with the same address, or someone added under People without access.
- A translation into a language the site does not have stays behind, and the
  report says to add the language and import again.

From the command line, `thecms import <site> <file>.thecms.json` brings it
into a new site (with its settings) or into one that has content.

### d3. The site's data as JSON, beside its pages

Each published page and entry can also be read as data, at its address
followed by `index.json` (`/about/index.json`, `/blog/oak-table/index.json`),
each type's list the same way (`/blog/index.json`), and `/site.json` names them
all. A page gives its title, description, blocks and the HTML of its own part
(without header and footer); an entry also its date, excerpt, cover,
categories, tags, fields and author; a list every entry with the address of
its data. Each file says `"format": "thecms.data/1"` and what it is.

It is written with the site, in every way it is published: served by the
site's own server (with `Access-Control-Allow-Origin: *`, so an app or a site
elsewhere can read it), and in the static export. Only what visitors see is
there, and never a page behind a password. Turned off in Menu and settings
("Let apps and other sites read the site's data as JSON"), none of it is
written. It is on by default: it shows nothing the pages do not already show.

### d4. The static export from the admin, as a ZIP

The Export screen gives the published site as files in a ZIP, for a host that
only serves files, with what such a host would not do said first (the same
list as the check before publishing, ADR 0044 d3). A link that leads nowhere
stops it, as it stops the export to a folder. `thecms export <site> site.zip`
does the same from the command line. The site served by thecms stays the way;
the screen says to choose files only for a simple site.

### d5. Only the owner

Everything under `/api/export/` is the owner's, as the import and the backups
are.

## Known gaps

- A content file from the admin goes back in up to 64 MB, as a WordPress
  export does; a larger one with `thecms import`.
- The file is thecms's own; WordPress does not read it. A file for WordPress
  (WXR) was offered and not chosen.
- The data beside the pages is read-only. Writing from outside goes through
  the admin's API (the comparison of 2026, level B), which is not part of this.
