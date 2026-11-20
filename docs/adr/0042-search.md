# ADR 0042 — Search on the site

- **Status:** Accepted (owner, 2026-11-20: "mergem pe propunerile tale", on ADR 0037, whose stage 1 names site search)
- **Date:** 2026-11-20
- **Builds on:** ADR 0037 d2 and d4, ADR 0038 (the runtime)

A WordPress site has a search field and a page of results. A static thecms
site had neither: a page cannot look through the others without a script,
and the published site has none (ADR 0001).

## Decisions

### d1. A search block, answered by the runtime

The owner places a **Search** block where it should be: on a page, in a
section, in a layout's area. It is a plain HTML form that asks
`/_/search?q=…` with GET. Only the site's runtime (ADR 0038) answers there,
so the block is drawn only when the site's form service is the runtime
(`/_` in Site settings); otherwise the editor says what is missing and the
site shows nothing.

### d2. The results are a page of the site

The runtime answers with the site's own frame (its header, menu, footer and
theme, those of its page for an address that does not exist) holding the
field again and the pages that match, each with its title and the words around
the match. Search engines are asked not to keep it. No script, and nothing is
sent to a service elsewhere.

### d3. What is searched is what is served

The runtime reads the pages it serves, the same files an export writes: each
page and entry, by its title and the words in its `<main>`. Lists of entries,
old addresses, the page for a missing address and what a form says are left
out. A page matches when it has every word of the query, without minding case
or accents (`paduri` finds `păduri`); those with the words in their title
come first, then those that say them most. At most 20 are listed.

The index is made once for each build of the site, so a publication is found
within the runtime's five seconds.

## Not yet

- **Search in a static export.** Without the runtime there is nowhere to ask;
  a script-free static search does not exist.
- **Stemming and ranking by language** (`tables` finding `table`), and a
  search across the site's other languages chosen by the visitor's.
- **A site of many thousands of pages**, for which the index should be kept
  in the database and follow the publications.
