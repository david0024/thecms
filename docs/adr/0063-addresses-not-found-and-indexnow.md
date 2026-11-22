# ADR 0063 — Addresses not found, and IndexNow

- **Status:** Accepted (owner, 2026-11-22: "Da, toate, în ordinea asta", on the five SEO stages of ADR 0058; this is the fourth)
- **Date:** 2026-11-22
- **Builds on:** ADR 0036 (old addresses), ADR 0038 (the runtime), ADR 0041 (the site's events), ADR 0058

ADR 0036 lets the owner lead an old address to a new one, but only one they
know of. Rank Math shows the addresses visitors asked for and did not find,
so the owner can lead them somewhere, and tells search engines at once of
what is published. The site can do both.

## Decisions

### d1. Addresses not found

The site served from here (the runtime, ADR 0038) notes each address a
visitor asks for with GET and does not find: how many times, when it was last
asked for, and the page that last led there, as its host and path (no query,
no visitor's address). What robots ask every site for, looking for another
software's weak spots (`.php`, `.env`, `/wp-…`, `/.git`, `.yml`, `.sql`…), is
not noted. The 500 asked for most recently are kept.

Settings → Old addresses shows them below the redirects, the most asked for
first. "Redirect" fills a new redirect from that address; a redirect made
takes it off the list. One is forgotten, or all of them. Only the owner
forgets them, as only the owner changes redirects. The list is not in a
backup: it is what visitors did, not what the owner made. An exported site
has none.

### d2. IndexNow

When the owner asks for it in Site settings, and the site has its address,
the engines that read IndexNow (Bing, Yandex, Seznam, Naver and the others,
not Google) are told of each page and entry published, ten seconds after it,
those published together in one message, through `api.indexnow.org`. Only an
address in the sitemap is told, so a page hidden from search engines or
behind a password never is. Several processes hearing the same publication
tell it once. The key that proves the site is the one telling them is made
once and served at `/<key>.txt`, only while the owner asks for IndexNow. A
refusal is written to the log; nothing waits for it.

## Not decided

- Telling IndexNow of an address removed: a 404 tells the engines in time.
- A 404 noted in an exported site: the host's own logs have them.
