# ADR 0053 — Statistics without a cookie

- **Status:** Accepted (owner, 2026-11-21: "in principiu sunt de acord. ma gandeam ca ar fi util sa fie o extensie dar in cel mai rau caz o mutam ulterior in extensii")
- **Date:** 2026-11-21
- **Builds on:** ADR 0037 d4 (stage 2 names statistics without a cookie), ADR 0044 (the site is served), ADR 0042 (search), ADR 0022 (accounts)

An owner wants to know whether anyone reads the site, which pages, and where
the readers come from. WordPress does it with a plugin that puts a script and
a cookie on every page, and with them a consent banner. thecms serves every
page itself (ADR 0044), so it can count what it serves, and needs neither.

## Decisions

### d1. Counted by the server, with nothing on the page

The site's server counts a page when it sends it: no script, no cookie, no
pixel, nothing stored in the visitor's browser. The page is the same page,
as fast; one served from the cache is counted too. A page is counted when it
is answered with itself (a page behind a password, once opened); a missing
page, a redirect, a picture or a file is not.

Not counted:

- **robots**: anything that does not call itself a browser (`Mozilla/` or
  `Opera/`), and the browsers that say they are a crawler, a preview or a
  monitor;
- **people signed in to the admin**, who carry its session;
- **pages a browser loads ahead**, which say so (`Sec-Purpose: prefetch`).

### d2. Nothing personal is kept

To tell one visitor from three, the server makes a fingerprint from the
visitor's address, their browser's name and a key that changes every day.
The fingerprint is only looked up, among the day's, where the site's
processes share what they share (Valkey, ADR 0044 d4); the address is never
written anywhere. The key of a day is deleted when the next day begins, so
not even the server can tell, after that, who was there.

What the database keeps is the day's totals, and only them: one row for each
day and each thing counted ("21 November: 140 visitors, 410 pages seen, the
page /contact/ 35 times"). They are kept for as long as the site is, in its
backups too.

Because nothing is stored in the visitor's browser and nothing kept names a
person, no consent is asked, and the site needs no cookie banner for this.

### d3. What the owner sees: Statistics

A screen of its own in the admin, for the owner and the editors (they only
read it):

- visitors and pages seen, for today, 7 days, 30 days and 12 months, with a
  chart (by day; by month for 12 months);
- the pages read most;
- where the visitors came from: a search engine or a network by its name
  (Google, Facebook), another site by its address, a campaign by its
  `utm_source`, or directly;
- phone, tablet or computer;
- what visitors searched for in the site's own search.

A visitor is counted once a day: one who comes back another day is counted
again, as the totals of each day are added.

The day is the owner's. When the owner opens Statistics, their browser's
time zone is kept (`Europe/Bucharest`), and days begin at midnight there;
until the owner first does, in UTC.

### d4. Built apart, so that it can become an extension

The owner said an extension would suit it, and that it can move to one
later. It is built so that the move is short:

- all of it is one file, `src/site/stats.ts`: what is counted, how, the
  fingerprint, the totals and what the screen is shown;
- the runtime calls it at two moments only: a page served and a search made;
- it keeps its rows in a table of its own, `visits`, that nothing else reads;
- the screen, `Stats.svelte`, reads one address, `/api/stats`.

It is not an extension now because the extension format cannot yet carry it:
an event for each page served (ADR 0041 d4 sends events after a change, and
never a visitor's address), and a view kind for a chart (ADR 0031). When
both exist, the file moves into an extension and the table becomes its
collection.

### d5. A static export says it loses them

An export to a static host has no server to count. When the site already has
statistics, the site check says, with the other things only the site's
server does (ADR 0044 d3), that they stop on a static host.

## Not done, on purpose

- **How long someone stayed on a page, and the bounce rate.** Without a
  script on the page, the server cannot know.
- **The visitor's country.** It needs a database of addresses by country; an
  extension may bring it.
- **A visitor who comes back on another day** is not known as the same one:
  that would need a cookie, or keeping who they are.
- **A cache in front of the site** (a CDN that keeps the pages) answers
  visitors without the server, which then does not count them.
