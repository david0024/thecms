# ADR 0058 — What the site writes for search engines by itself

- **Status:** Accepted (owner, 2026-11-22: "Da, toate, în ordinea asta", on a proposal of five stages that bring what Rank Math does, free and Pro, into thecms; this is the first)
- **Date:** 2026-11-22
- **Builds on:** ADR 0050 (search engines and sharing), ADR 0030 (data for search engines), ADR 0029 (the site check), ADR 0009 (WordPress import)

ADR 0050 gave thecms what Yoast gives a WordPress site. Set beside Rank Math,
free and Pro, a few things were still missing. The owner agreed to all of
them, in five stages, each with its own ADR:

1. What the site writes by itself, without AI, and the small things (this ADR).
2. Writing with AI: the title for search engines, a whole site at once, a picture's words from the picture.
3. More data for search engines: questions and answers, a local business, an event, a product.
4. Addresses that are not found, kept in a list, and search engines told at once when a page changes.
5. Tools for large sites: links between pages, many titles in one table, Google Search Console.

A beginner never has to touch any of it: what is here is written by the
site, and each choice has a default that is right for most sites.

## Decisions

### d1. A description the site writes, shown in grey

A page or an entry whose description is empty has one written from its
words, as before, but now:

- each heading and each line ends as a sentence, so a title does not run
  into the paragraph under it ("Our workshop. We started in 2014."), and
- it is cut after the last whole sentence that fits in 160 letters, when
  that leaves at least half; otherwise after the last whole word, with "…".

An entry's description is its own, else its excerpt, else this. The empty
description field shows, in grey, the words that will be used, so the owner
sees them without knowing they were written.

The site's own search keeps reading the words as they are.

### d2. A picture's words from its file's name

When a picture is uploaded or picked for a place that has no words for it,
the words are taken from the file's name: `sala-de-nunti_2.jpg` gives "Sala
de nunti". A name a camera, a phone or a program made (`IMG_1234`,
`DSC0042`, `PXL_…`, `Screenshot …`, `WhatsApp Image …`, a run of digits or
letters and digits) gives nothing, because those words would be wrong. The
owner sees the words and changes them; the site check still names a picture
without words (ADR 0029).

The logo takes none: left without words, it is read out as the site's name,
which is right.

### d3. The sitemap says when each page changed, and its pictures

Each page and entry in `sitemap.xml` has `<lastmod>`: the day it was last
published, as the store keeps it. Each lists the pictures it shows that are
the site's own (`image:image`); a picture on another site is that site's to
list. A list of entries has no date of its own and says none.

### d4. Codes that prove the site is the owner's

Site settings take the code Google Search Console gives, and the one Bing
Webmaster Tools gives. The owner pastes the whole `<meta …>` tag they are
shown, or only the code; only the code is kept, and only if it is made of
letters, digits, `-` and `_`. The home page says them
(`google-site-verification`, `msvalidate.01`); other pages do not need to.

### d5. Lines of the owner's own in robots.txt

Site settings take lines for `robots.txt`. Only its rules are kept
(`User-agent`, `Allow`, `Disallow`, `Crawl-delay`, `Sitemap`), each short,
at most a hundred. They come after the program's `User-agent: *` and
`Allow: /`, and before the sitemap's address. Most sites leave it empty: a
page the owner hides is already hidden (ADR 0050 d3).

The site check says, and does not stop, when these lines shut the whole site
to every search engine, or to Google's or Bing's (`Disallow: /`).

### d6. A link search engines do not follow

A link in text, and a link field (a button, a hero's buttons, a plan's
button, a link field of a content type), has a box "Search engines do not
follow this link (nofollow)". Ticked, the link is drawn with
`rel="nofollow"`. It is for paid links and links the owner does not vouch
for; the program never ticks it.

A WordPress link marked `nofollow`, `sponsored` or `ugc` is imported with
the box ticked.

The header's button and the footer's links are the site's own and do not
take it.

## What this does not change

- Everything here is written into the page's HTML, the sitemap and
  `robots.txt`, so a site exported to a static host keeps all of it.
- The public site still runs no script (ADR 0001).
