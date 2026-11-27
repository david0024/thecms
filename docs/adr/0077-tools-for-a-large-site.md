# ADR 0077 — Tools for a large site: links to add, every title in one table, Search Console

- **Status:** Accepted (owner, 2026-11-22: "Da, toate, în ordinea asta", on the five SEO stages of ADR 0058; this is the fifth and last)
- **Date:** 2026-11-27
- **Builds on:** ADR 0050 (search and sharing), ADR 0058, ADR 0059 (AI for search engines), ADR 0053 (statistics)

A site of a few pages is looked after page by page. A site of hundreds needs
to see them together: which pages could lead to each other, which have no
title or description of their own, and what Google shows of them. Rank Math
offers all three; the site can too, without anything new to install.

## Decisions

### d1. Links a page could add

"Search and sharing" in the editor lists the site's other pages and entries
whose title the page's words already say, as whole words, accents and capitals
aside, and that it does not link to yet: published, in the page's language,
the longest titles first, at most eight. The home page, the page itself and a
title of fewer than four letters are left out. Each has its address and a
button that copies it; the author selects the words and links them. Nothing is
written into the page by itself: the words to link are the author's to choose.

### d2. Every title and description in one table

The owner and the editors have "Search engines" in the menu: every page in the
site's language and every entry, with its title for search engines and its
description, and in grey what the site writes when they are empty (ADR 0058
d1), with their lengths. "Only those missing" shows what is still to do. A
change is kept as it is written. A page or entry published as it was written
is published again with it, so the site says it at once; one with other
changes waiting keeps waiting for its author. A translation's title and
description are written in its own editor, beside its words.

With an extension turned on that writes a page's title or description (the
AI extension's "title" and "describe", ADR 0059), the table writes the missing
ones for the whole site, one page after another, those hidden from search
engines left out, and can be stopped.

### d3. Google Search Console

Beside the statistics, Search Console shows what people searched for when
Google showed the site, and the pages they found, over the last 28 days Google
has counted: clicks, how many times shown, the share clicked, the average
place. The table of d2 shows each page's clicks and place.

The owner connects it once with a service account of their own: its JSON key,
and the property (the site's address unless said otherwise). The admin says
how to make one and how to let it read the property. The key is kept only once
Google answers with it, so a key that does not work is said at once. The report
is asked for again after an hour, or when someone asks. Only the owner connects
and disconnects it; the editors read it.

## Not decided

- Signing in to Google with a button (OAuth): it needs an app registered by
  whoever runs the program, which a site on its own server has not. The
  service account needs nothing from us.
