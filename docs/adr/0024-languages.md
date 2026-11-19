# ADR 0024 — The same page in more than one language

- **Status:** Accepted (owner agreed to the plan and its order: multilingual content after installation)
- **Date:** 2026-11-19
- **Builds on:** ADR 0008 (the menu), ADR 0021 (language packs)

A small business in Romania often wants its site in Romanian and English.
Language packs (ADR 0021) translate what the site says by itself. This ADR is
about what the owner writes: the same page in another language.

## Decisions

### d1. A main language, and up to nine others

`Site.language` stays the main language. `Site.languages` lists the others.
The main language's pages live where they always did, so a site that adds a
language changes no address it already has.

### d2. A translation lives under its language, and its address says what it translates

The Romanian `about` is the page `ro/about`, served at `/ro/about/`. The
Romanian home page is `ro`, at `/ro/`. `pt-BR` is `/pt-br/`.

Nothing else links a page to its translation. There is no table to keep in
step and no id to lose on import, and the store, the export and the editor
needed no new column. The cost is that a translation keeps the main page's
address after its prefix: `/ro/about/`, not `/ro/despre/`. Translated
addresses can come later as an alias that leads to the same page.

- A language's prefix is taken as an address. A language whose prefix a
  page already has cannot be added until that page moves.
- A language that still has pages cannot be removed.
- A page cannot live under a prefix that is not one of the site's languages.

### d3. Translating starts from a copy

In the list of pages, each page shows its translations. Each one that is
missing shows "+ ro", which makes a copy of the page under the language and
opens it in the builder, to be written over. The layout is copied with the
words, because a translation usually keeps the layout.

### d4. A page in another language is drawn in it

- The site's own words come from that language's pack, and the page says
  `lang="ro"`.
- The footer text and the header's button are written for each language in
  the settings. The footer links are the main ones until the owner gives
  others, because a privacy page or a profile is often the same.
- The menu is the main menu with each page swapped for its translation. A page
  with no translation is left out, and so are the lists of posts and entries.
  The owner arranges one menu, not one per language.

### d5. Every page says where it is in the other languages

- The header shows a switcher with each language's name in that language
  ("Română", "English"). It leads to this page's translation, or to that
  language's home page where there is none.
- With the site's address set, the head lists each translation as
  `<link rel="alternate" hreflang>` for search engines. Only real
  translations are listed, never a home page standing in.
- Posts and lists lead to each language's home page.

## Not decided here

- Posts and entries in more than one language. They stay in the main
  language for now.
- Translated addresses (`/ro/despre/`).
- A language chosen from the visitor's browser. The site is static and sends
  nobody anywhere without a click.
