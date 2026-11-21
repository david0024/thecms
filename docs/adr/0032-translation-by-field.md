# ADR 0032 — A page is translated field by field

- **Status:** Accepted (owner, 2026-11-20: left the choice of model to the project; translation by field as the rule, a separate copy as the exception); entries follow it in ADR 0054
- **Date:** 2026-11-20
- **Builds on:** ADR 0024 (the same page in more than one language), ADR 0028 (versions), ADR 0029 (the check before publishing)
- **Replaces:** ADR 0024 d2 and d3 (a translation is a copy under the language's prefix)

ADR 0024 made a page's translation a copy of the page under the language's
prefix. A copy is simple, and it drifts: a picture changed on the main page
stays old in Romanian, a block added in English is missing in German, and
every language is one more copy of the layout to keep in step. Modern
systems that hold many languages (Contentful, Payload; Storyblok and Sanity
offer it beside copies) translate by field: the layout, the pictures and the
prices exist once, and each piece of text has a value in each language.

## Decisions

### d1. Each field is translated, or common

A block type's fields (ADR 0001 d7) say which are text in a language and
which are the same in every language.

- **Translated:** every text, rich text, a picture's description, a link's
  words.
- **Common:** the blocks themselves, their order, style and variant; a
  picture; a link's address; a number; where a list of entries comes from;
  and the fields marked `common`: an e-mail address, a phone number, a price.

### d2. A page holds its translations

A page keeps, for each other language it is translated into:

- its address in that language (`despre` for `about`, served at
  `/ro/despre/`), or none for the main page's address;
- its title and description;
- each translated field's value, by where it is: the block's id and the
  field's path (`b_1a2b.title`, `b_1a2b.items.2.text`, `b_1a2b.image.alt`).

The page is drawn in that language by putting these values over the main
page. A field with no value there shows the main language's: a page half
translated is still a whole page.

A page is in a language once someone starts translating it ("+ ro"). The
menu, the language switcher and `hreflang` work as in ADR 0024, through the
page each translation is of rather than through the address.

### d3. Writing a translation does not change the layout

A translation is opened in the builder like any page, at its own address,
with the main page's blocks and its own words. Saving it keeps only the
words: a block added, moved or removed, or a picture changed, is refused
with the reason. The layout is changed on the main page, and every language
follows it.

A value that is the same as the main language's is not kept as a
translation of it.

### d4. The exception: a page split for one language

When a page really differs in one language, the owner splits it for that
language: the translation becomes a copy of its own, with its own blocks,
as in ADR 0024, and stops following the main page. It keeps its address and
its place in the menu and switcher.

### d5. One page, one draft, one publication

A translation is part of its page: it is saved into the page's draft,
published with it, kept in its versions and brought back with them.
Publishing the Romanian page publishes the page.

### d6. The check before publishing says what is not translated

The check (ADR 0029) lists, for each published page and language, how many
texts show the main language's words. It warns; it does not stop
publishing, because a missing translation still makes a whole page.

### d7. Translations made as copies become fields

A site made under ADR 0024 keeps its translations as pages under a prefix.
When the site is opened, each one whose page exists in the main language
moves into that page: as values by field when it has the same blocks (a
translation began as a copy, so its blocks have the same ids), and as a page
split for its language otherwise. Its draft and its publication move
separately. A page that exists only in another language stays as it is.

### d8. A language with translations is not removed

As with pages under a prefix (ADR 0024), a language cannot be removed while
a page is translated into it.

## Not decided here

- Entries in more than one language: they stay in the main language. Their
  fields will follow the same rule, translated or common.
- A link in a page's words to another page is not changed to that page's
  translation.
