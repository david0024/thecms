# ADR 0034 — Actions on translations, and in every language

- **Status:** Accepted (owner, 2026-11-20: "„Tradu” din extensia AI lucrează pe câmpuri și poate traduce în toate limbile"; the details left to the project)
- **Date:** 2026-11-20
- **Builds on:** ADR 0026 (extensions), ADR 0027 (the AI extension), ADR 0032 (translation by field), ADR 0033 (sections)

Since ADR 0032 a translation is words over the main page: its layout, its
pictures, its prices and its addresses exist once. An extension's action
(ADR 0026) gives back a whole block or a whole page. "Translate this page"
of the AI extension (ADR 0027) gave back every text it found, a price and an
email address too, and the translation could then not be saved: its blocks
were no longer the main page's. And a site in four languages was translated
four times, one page at a time.

## Decisions

### d1. On a translation, an action changes only words

When the editor runs an action on a block or a page of a translation that is
not split, it says so, and the program keeps from the answer only the places
a translation has (ADR 0032 d1): the texts that are not common, rich text, a
picture's description, a link's words. Everything else comes from the page
as it was: blocks added or removed, a picture's file, a price, an email
address, a link's target. Nothing in the extension has to know which field
is which; the rule is the program's, like the rest of what an extension may
do. A split translation is its own page, and an action changes it as it
changes any page.

### d2. An action may run for each language

A page action may say `"each": "language"` in its manifest. On a page or a
section of the main language, on a site with other languages, the editor
then offers it as "Translate this page, in every language". The page is
saved, then for each of the site's other languages, in order:

- the translation is started when the page has none (ADR 0032 d5);
- the action runs on the page as it is in that language, and is told the
  language;
- what it gives back fills in only what that translation does not say yet
  (ADR 0032 d6): its title, its description and each place still in the main
  language's words. Words a person already wrote stay as they are;
- a language the page is split for is left as it is, and named.

The result is kept as the drafts of the translations, never published: the
owner reads each one in the builder, changes it, and publishes it as any
change. On a translation, the same action is an action like any other: its
answer is shown as a change to look at, undo or save.

`"each"` is allowed only on a page action. A section's translations are the
owner's, as the rest of a section (ADR 0033); a page's are anyone's who may
write pages.

### d3. The AI extension translates in every language

"Translate this page" says `"each": "language"`, version 1.1.0. It still
sends every text of the page to the model, prices included, and tells it
never to invent prices; the program keeps only the words (d1), so a model that
translates "€100 a month" into "100 € pe lună" does not change the price.

## Not yet

- Entries (posts, projects) are not translated by field yet (ADR 0032), so
  an action for each language is offered only on pages and sections.
- Sending only the places that are translated, to spend fewer tokens, needs
  the extension to be told which places those are. It waits until the cost
  is felt.
