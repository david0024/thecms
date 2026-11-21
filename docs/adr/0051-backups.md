# ADR 0051 — Backups, made by the site on a schedule

- **Status:** Accepted (owner, 2026-11-21: chose "Da, spre un spațiu S3", on the proposal of one file for the whole site, once a day by default, the last seven kept, putting back with a backup made first, for the owner only)
- **Date:** 2026-11-21
- **Builds on:** ADR 0037 d2 and d4 (stage 2: scheduled backups; the site's clock), ADR 0013 (three databases), ADR 0039 (the clock), ADR 0044 d4 (several processes), ADR 0048 (the installer)

A WordPress site gets its backups from a plugin, most often UpdraftPlus: a
copy made on a schedule, kept on the server and sent elsewhere, and put back
with a button. Until now a thecms site was backed up by copying its SQLite
file, which a beginner does not know to do, and which does not exist when
the site lives in Postgres or MySQL. The site now does it itself.

## Decisions

### d1. One file holds the whole site, whatever its database

A backup is one file, `site-2026-11-21-030000.thecms-backup`: gzip, inside it
one line of JSON saying what it is (`thecms.backup/1`, the program's version,
when it was made, the database it came from), then one line per row of each
table. Bytes (pictures, documents) are written as base64.

It holds everything the site keeps: settings, theme, pages, sections,
entries, versions, media, forms and their messages, comments, accounts (the
password hashes, never a password), page passwords, extensions and what
they keep. It does not hold who is signed in at the moment (sessions,
one-time links), nor the backup settings themselves (d4), nor Valkey's
address: those belong to the server the site runs on, not to the site.

Because the rows are written the same way for the three databases, a backup
made on SQLite is put back on Postgres or MySQL, and the other way round.
That is how a site moves from one database to another (ADR 0013,
"Consequences"), and from one server to another.

### d2. Once a day by default, at night, and "Back up now"

Backups are on from the start: once a day, at night (03:00 UTC until the
owner chooses an hour). The owner may choose once a week instead, another
hour, or turn them off. The hour is chosen in the owner's own time, and kept
with that time's distance from UTC as it was when it was saved; it moves by
an hour when summer time starts or ends, which does not matter for a backup.

The editor's clock (ADR 0039) makes them, without stopping a publication.
Where several processes share a site (ADR 0044 d4), one takes the backup
and the others do not. A backup missed because the site was stopped is made
as soon as it runs again. "Back up now" makes one at once.

### d3. Kept on the server, the last seven

Backups are kept in a folder `backups` beside the site's file, or in the
folder the program runs in when the site is in Postgres or MySQL (`/site` in
the Docker image, which is a volume). `THECMS_BACKUPS` names another folder.
The last seven are kept; an older one is deleted when a new one is made. The
owner may keep more or fewer, from 1 to 90. Each one can be downloaded, or
deleted, from the admin.

### d4. A copy outside the server, in any S3 storage

A backup kept on the same server does not help when the server is lost. The
owner may give the address of an S3 storage (Amazon S3, Backblaze B2,
Cloudflare R2, Wasabi, DigitalOcean Spaces, MinIO all speak it): its
address, its bucket, its region, a key and its secret, and a folder inside
it (`thecms/` by default). Each backup is then sent there too, and the same
number is kept there as on the server; only the files the site made are
ever deleted there. "Test" writes and deletes a small file, so the owner
sees at once that it works.

The secret is shown back as `***` and is not in any backup file. A copy that
could not be sent is said, and the backup on the server is kept.

### d5. Putting back, with a backup made first

Each backup has "Put back". It asks once, saying that what is on the site
now will be replaced. Before anything is replaced, the site makes a backup
of what is there now, named `before-restore-…`, so that a mistake can be
undone the same way. Then every table is emptied and filled from the file in
one transaction: a file that cannot be read changes nothing.

The person signed in stays signed in when their account is in the backup;
everyone else signs in again. Visitors see the site as it was at once.

A backup file from another server is put back by uploading it, up to 64 MB
from the admin; a larger one with `thecms restore <site> <file>`.

### d6. Only the owner, and a failure is said

Backups hold accounts and messages, so only the owner sees them, makes them,
downloads them and puts them back: every call under `/api/backups` is the
owner's. The admin says when the last backup was made, how large it was,
and whether the copy was sent. A backup that failed is said on the Backups
screen and at the top of the admin until one succeeds.

### d7. From the command line

`thecms backup <site> [folder]` makes one now, into the folder or the usual
one. `thecms restore <site> <file>` puts one back, after a backup of what is
there, as the button does.

## What this answers

- ADR 0048, "Not decided here": the database the installer set up is backed
  up by the site's own backups, whichever database it is.

## Known gaps

- A backup is not encrypted. The S3 bucket should be private; the admin says
  so beside the fields.
- A backup is made whole each time, not as the changes since the last one.
  For a site of a few hundred megabytes, once a day, this is fine.
- No email when a backup fails; it is said in the admin.
- Uploading from the admin stops at 64 MB, as an import does.
