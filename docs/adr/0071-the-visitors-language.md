# ADR 0071 — The visitor's language

- **Status:** Accepted (Liviu, 2026-11-24, asked whether ADR 0024's way of
  holding languages was the best one, and whether the site should take the
  browser's language; on the proposal, for himself and David: "poti face
  merge la tot. Ai acordul meu si al lui David")
- **Date:** 2026-11-24
- **Builds on:** ADR 0024 (the same page in more than one language), ADR 0032
  (translation by field), ADR 0054 (entries in more than one language),
  ADR 0044 (the site is served), ADR 0053 (statistics without a cookie)
- **Replaces:** ADR 0024's "Not decided here: a language chosen from the
  visitor's browser"

ADR 0024 gave each language its own addresses (`/` in English, `/ro/` in
Romanian) and a switcher in the header. It left out the visitor's browser,
because the site was static then and "sends nobody anywhere without a
click". Since ADR 0044 the site is served, so the server can read which
languages a browser asks for (`Accept-Language`). On uhlaka.org a Romanian
visitor still lands on the English home page and has to find "Română".

There are three ways a site can know a visitor's language: from the address,
from a choice the visitor made, or from the browser. They do not compete: the
question is which one wins, and where.

## Decisions

### d1. The address stays the language

Every page in every language keeps its own address, as now. It is what search
engines need (they index each address once, and Google crawls without
`Accept-Language`, so a page that changes language by header is indexed in one
language only), what a shared link needs (the friend sees what was sent), and
what the cache needs (one address, one page). Sites that hold the language
only in a cookie or a header lose all three. Nothing changes for owners or
for the addresses a site already has.

### d2. The switcher stays, always in sight, and remembers a choice

The header's switcher (ADR 0024 d5) stays outside the folded menu, so it is
there on a phone too. On a narrow screen it stays in the header's row,
between the name and the menu button, as short codes (EN, RO); the
language's full name is still read out. A click on it is a choice: the server keeps it in a
cookie, `uhlaka-lang`, for a year. This cookie is set only when the visitor
asks for a language, holds only that language, and is not read for anything
else: it needs no consent and no banner (ADR 0053 keeps the site free of
those). On a served site the switcher leads through `/_/language?l=ro&to=/ro/…`,
which keeps the choice and goes on to the page; an exported site's switcher
links straight to the page.

### d3. The home page opens in the visitor's language, once

When a visitor asks for the main home page (`/` exactly), has no
`uhlaka-lang` choice, and their browser prefers another of the site's
languages whose home page exists, the server answers with a temporary
redirect (302) to that home page (`/ro/`). Only then:

- **Only the home page.** A link to `/docs/install/` opens that page, in the
  language it was written in. A shared link is never turned into another.
- **Only without a choice.** A visitor who clicked "English" stays in English,
  on every visit.
- **Not for robots.** A request without `Accept-Language` (search engines,
  link previews) gets `/` as it is. The home page lists every language with
  `hreflang`, and `/` is also `hreflang="x-default"`.
- **Not in the cache.** The answer for `/` says
  `Vary: Accept-Language, Cookie`, so a cache in front (Cloudflare) never
  serves one visitor's redirect to another.

### d4. The owner can turn it off

Site settings → Languages has "Open the home page in the visitor's language",
on by default as soon as the site has a second language. A beginner does
nothing and gets it; an owner who wants `/` to stay in the main language turns
it off.

### d5. An exported site does not redirect

A static export has no server to read the browser. Its switcher still works;
the admin lists "opening in the visitor's language" among what an exported
site does not do (ADR 0044 d3).

## Considered and left out

- **A redirect on every page.** It breaks shared links and is what Google
  advises against; search engines already send each visitor to their language
  through `hreflang`.
- **A bar on each page ("This page is also in Română").** Useful, but it needs
  a script and words on every page; it can come later on top of d2 and d3.
- **One address, the language by cookie or header.** Bad for search engines,
  shared links and the cache (d1).
- **A subdomain or a domain per language.** More to set up, nothing gained for
  a small site.

## Not decided here

- A content type with nothing translated into a language has no list there
  (ADR 0054), so uhlaka.org's Romanian menu has "Documentație" but not
  "Decisions". Whether such a list may show the main language's entries is a
  separate question.
