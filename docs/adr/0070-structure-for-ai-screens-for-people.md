# ADR 0070 — One structure, made for AI to write; screens over it, made for people

- **Status:** Proposed (Liviu, 2026-11-24: "ar trebui gandita structura pentru a facilita crearea cu ajutorul ai-ului iar pentru utilizatorul uman sa avem un ui/ux corect peste aceasta structura"; waiting for David)
- **Date:** 2026-11-24
- **Builds on:** ADR 0001 d7 (one list of blocks) and d8 (a theme is data), ADR 0057 (a complete export), ADR 0062 d6–d7 (an extension's blocks and screens as data), ADR 0069 (a contract for AI: AGENTS.md and the schema)

More and more sites will be started by someone asking an AI for one, and
finished by a person who clicks. Uhlaka can serve both only if both work on
the same thing. ADR 0069 gave an agent the schema of a content file and an
example; the admin's review on the same day (PR #93 and what follows it)
found screens organised the way the data is stored, not the way an owner
thinks. The two findings are one rule seen from two sides, and this record
writes the rule down so that every later change keeps to it.

## Decisions

### d1. One model, two faces

A site is one structure: the data in `src/core/` (pages of blocks, entries,
forms, sections, menus, the theme, the settings), cleaned by the core's
`normalize*` functions. It has two faces and no third:

- **For a machine:** the content file and its schema (ADR 0069), the
  commands (`uhlaka import`, `export`, `edit`) and the admin's API.
- **For a person:** the admin and the editor on the page.

The admin has **no model of its own**. It may group, order, hide, name and
explain; it may not keep anything the structure does not hold, nor hold a
thing in a shape the file cannot carry. What a person makes in the admin, an
agent can write in a file, and the reverse.

The check: a site exported to a content file and imported into a new site is
the same site. A test holds the example site (ADR 0069 d2) and a site made
through the admin's API to that, and grows with every part the export carries.

### d2. The structure is written for the one who writes it without seeing it

An agent does not see the screen, so the structure says everything itself.
For every new part of the core, and for the old ones as they are touched:

- **Names that say what a thing is,** in English, whole words (`subtitle`,
  `secondaryAction`, not `sub`, `cta2`). A name is not changed once
  published; a better one comes with the old one still read, as ADR 0066 did
  for `thecms.*`.
- **Closed choices are lists,** never free text: a block's `variant`, a
  field's `kind`, a layout. The schema lists them; the program refuses the
  rest.
- **Every limit is in the declaration** (a length, a number of items, a
  range), so the schema, the cleaning and the admin's forms read the same
  number.
- **Words, not looks** (ADR 0069 d3): content holds what it says; the look
  belongs to the theme.
- **One sentence per block type and per field that says what it is for,**
  kept beside its declaration in the core, in English. The schema writes it
  as `description`; the admin shows it, translated by the language packs, as
  the hint under a field and in the panel that adds a block. One sentence
  serves an agent choosing between `services` and `pricing` and a person
  doing the same.
- **A group per block type** (text, media, lists, forms, from the site, from
  an extension), declared in the same place, for the same two readers: the
  schema orders by it, the admin's "Add a block" panel shows it.

### d3. The admin is designed for tasks, not for tables

Over that structure, the admin is made the way an owner works, not the way
the data is stored:

- **By task:** the menu says what one does (Content, Customers, Look,
  Extensions, Settings), not what is kept. Which grouping, and when, is
  decided with David in its own record (see the handoff of the admin review).
- **Few choices at a time:** the common choice is shown, the rest is one
  click further; defaults are the theme's.
- **Every screen has an address,** so a person can come back to it, share it
  or press Back (PR #93); the same address is what an agent links to.
- **The words are the owner's,** in the language packs (ADR 0021), never the
  names of the code.
- **Shown where it is used:** a picture's alternative text lives on the file
  in Media and is offered to every block that uses it; a page opens from the
  list on the page itself.

A screen may be made easier at any time without a record, as long as it
changes nothing in d1: a new screen that keeps something new needs that
thing in the structure first.

### d4. Extensions follow the same rule

An extension already describes its blocks, collections and screens as data
(ADR 0062 d6–d7), drawn by the admin. That stays the only way: **no screen
of an extension is code that runs in the admin.** An agent can then write an
extension's screens as it writes a page, and a person sees them in the
admin's look, in their language.

An extension's collections and blocks are described in its manifest with the
same rules as d2 (names, lists, limits, one sentence each), and a tool will
write their schema as `tools/content-schema.ts` does for the core.

### d5. Every change answers three questions

A pull request that adds something to what a site can do says, in its
description:

1. **Where it is in the structure** (the core's declaration, the schema).
2. **How an agent makes it** (the content file, a command, the API).
3. **How a person makes it** (the screen, and the words on it).

A part with an answer to only one of them is not finished. AGENTS.md says
this under "Working on Uhlaka's code".

### d6. It is written in the documentation

The rule is explained to the people who use Uhlaka, not only to those who
write it: a guide on uhlaka.org ("Made for AI and for people", in English and
Romanian) says what it means for them, how to have an AI start a site, and
what they then do in the admin.

## Not decided here

These follow from the rule and are each a decision for David:

- **The schema at a fixed public address** on uhlaka.org, with its version in
  the name (already named in ADR 0069), and an `llms.txt` there that points
  an agent to it and to AGENTS.md.
- **An MCP server for Uhlaka:** the admin's API offered to an agent as tools
  (read the site, add a page, import a file), with the same accounts and
  rights as a person; it would be the third way in of d1's machine face, not
  a new model.
- **An assistant in the admin** that writes such changes for the owner: a
  part of the AI extension (ADR 0027), with its own record.
- **The grouping of the admin's menu, the admin bar on the site and the admin
  on a phone,** from the admin review.

## What changes now, if it is accepted

- `src/core/blocks.ts`: a `purpose` sentence and a `group` for every block
  type, a `purpose` for every field; `tools/content-schema.ts` writes them;
  the admin's "Add a block" panel shows the groups and the sentences
  (translated in `languages/`).
- `test/`: the round trip of d1 (export, import into a new site, compare).
- `AGENTS.md`: the three questions of d5.
- uhlaka-website: the guide of d6.
