# ADR 0073 — "Add a block" in groups, with a search

- **Status:** Accepted (Liviu asked for it on 2026-11-24, after a review of the admin; "in rest, poti face merge la tot. Ai acordul meu si al lui David", Liviu, the same day)
- **Date:** 2026-11-24
- **Builds on:** ADR 0017 (blocks), ADR 0033 (sections), ADR 0062 d6 (blocks from extensions), ADR 0072 (the review of the admin)

The builder offered every block in one grid of 22 buttons, in the order the
code declares them, with no groups and no search. Long names broke over
three lines ("Video, song or map from another site"), blocks that look alike
(Video and the video from another site, Contact and Contact form, Section and
Group) said nothing of how they differ, and the order did not follow the way
a page is built.

## Decisions

### d1. Groups, in the order a page is built

Text (Text, Buttons, Table, Code); Pictures and media (Image, Gallery, Video,
Sound, Documents, from another site); Ready-made sections (Hero, Services,
Prices, Testimonials, FAQ, Contact); Forms and search; Lists (latest entries,
by month, and the entry's parts on a type's own page); Layout (Group, a
reusable section); and one group for the blocks extensions add. Each group
folds. The groups are the admin's way of listing blocks, kept beside it
(`src/admin/blockGroups.ts`); a block is the same wherever it is listed, and a
test holds that every block is in exactly one group.

### d2. A search over the blocks

A box over the groups finds a block by its name, its description, or other
words people look for ("YouTube", "map", "FAQ", "poze"), in English and
Romanian, without the marks over letters. A search that finds nothing says so.

### d3. Short names on one line, the description under the pointer

In this list only, a block whose name does not fit on a line has a shorter one
("FAQ", "YouTube, map…", "Reusable"); everywhere else it keeps its name. Each
block says what it is in a sentence shown under the pointer.

## Not now

An icon and a small preview for each block, and "used recently" at the top,
come when the blocks get their pictures.
