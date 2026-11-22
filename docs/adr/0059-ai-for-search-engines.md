# ADR 0059 — AI for search engines: titles, and pictures described from the pictures

- **Status:** Accepted (owner, 2026-11-22: "Da, toate, în ordinea asta", on the five SEO stages of ADR 0058; this is the second)
- **Date:** 2026-11-22
- **Builds on:** ADR 0027 (AI writing, as an extension), ADR 0026 (extensions), ADR 0058 (what the site writes for search engines by itself)

ADR 0058 made the site write a description and a picture's words by itself,
from the words and the file names it has. A model writes them better, and
the AI extension already writes a page's description. Two things were
missing: the title for search engines, and words for a picture that come
from the picture itself. ADR 0027 had left the second undecided, because no
extension could see the site's pictures.

## Decisions

### d1. "Write the title for search engines", on a page

Beside "Write the description", the AI extension writes the title search
engines show in place of the page's own: at most 60 letters, in the page's
language, in the words a person would search for. It comes back as a change,
to look at, undo or save, like everything the extension writes. Only the
title for search engines is taken from what comes back with it: never the
picture for sharing, never the choice to hide the page.

### d2. "Describe the pictures", on a block

On a block with pictures of the site's library (an image, a gallery, a hero,
any block whose picture has words of its own), the extension shows the
model the pictures and the block's other words, and writes each picture's
words: at most 125 letters, saying what it shows that matters on the page.
It describes the pictures that have no words; when every one has some, it
describes them all again. At most twelve at once.

A picture on another site is not described: the program gives an extension
only the site's own. A picture the model cannot look at (an AVIF without a
smaller copy) is said so.

### d3. An extension may see the site's pictures, if it says so

An action may declare `"pictures": true`. It is then given
`host.picture(src)`: a picture of the library, by its address, as its type
and its bytes, at most 5 MB, at the widest smaller copy up to 1600 pixels
when one is kept. An action that did not declare it is refused, as it is for
a collection it did not declare. Before installing, the owner reads "see the
site's pictures, for: Describe the pictures" among what the extension asks.

This changes ADR 0027 d4 in one place: what is sent to a model is still
only words, except the pictures of a block, when the owner asks for them to
be described.

### d4. Filling in a whole site at once is in stage 5

A button that writes the titles and descriptions of every page without them
belongs to the table of stage 5, where every page's title and description
are seen and corrected together. It is built there.

## What this does not change

- The extension runs as before: in a process of its own, calling only the
  hosts it declared, its cost written in "AI usage".
- Nothing is published by the model.
