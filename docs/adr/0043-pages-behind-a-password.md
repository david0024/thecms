# ADR 0043 — Pages behind a password

- **Status:** Accepted (owner, 2026-11-20: "mergem pe propunerile tale", on ADR 0037, whose stage 1 names private and password-protected pages)
- **Date:** 2026-11-20
- **Builds on:** ADR 0037 d4, ADR 0038 (the runtime), ADR 0022 (accounts)

WordPress lets an author put a page behind a password, and keep a page
private to those signed in. A thecms page was either published, for anyone,
or not.

## Decisions

### d1. A page may ask for a password

Beside a published page, under the schedule, the editor has **Password**: a
new password puts the page behind it, at once, with each of its translations;
another replaces it; "Open it to everyone" takes it away. The password is
kept only as its hash (argon2id) and is never shown again. The home page is
open to everyone. Editors may set it, as they may publish.

### d2. The runtime asks for it

At the page's address the runtime (ADR 0038) answers 403 with a page of the
site's own frame that asks for the password, posting to `/_/unlock`. The
right one gives the visitor a key, kept in an HttpOnly cookie for 30 days and
named after the page. It is made from the page and its password's hash, so a
new password shuts out everyone who had the old one. A visitor may try ten
passwords in ten minutes. What is behind a password is never kept by a cache
(`private, no-store`).

### d3. Nothing behind a password leaves the runtime

The page is not in the sitemap or the search (ADR 0042), and search engines
are asked to keep none of it. An export cannot ask for anything, so it does
not hold the page: in its place is a page saying it cannot be opened there.

### d4. "Private", as WordPress means it, waits for visitors' accounts

A page that only signed-in people may see needs visitors who sign in on the
site; those come with the shop and the members of stage 2 (ADR 0037 d4). Until
then, a page that is not published is seen only in the admin.

## Not yet

- **Entries behind a password**, and a whole section of the site behind one.
- **A page for members only**, with the accounts of stage 2.
