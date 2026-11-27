# ADR 0069 — A contract for AI: AGENTS.md and the schema of a content file

- **Status:** Accepted (Liviu asked for it on 2026-11-24, after reading a list of product ideas; David confirmed it the same day)
- **Date:** 2026-11-24
- **Builds on:** ADR 0001 d8 (a theme is data), ADR 0017 (blocks), ADR 0033 (sections), ADR 0049 (forms), ADR 0057 (a complete export)

An AI asked to "make a site" writes HTML that nobody can edit a month later.
Uhlaka already holds a whole site as data, and already takes one in from a
single file (ADR 0057 d2). What is missing is the description an agent needs
to write that file without guessing: which blocks exist, what each holds, how
long a title may be. Today it would have to read the TypeScript.

## Decisions

### d1. The schema is made from the core, never written by hand

`docs/content-schema.json` is a JSON Schema of the content file
(`uhlaka.content/1`). Its blocks are made from the core's own list of block
types and their fields (`BLOCKS` in src/core/blocks.ts) by
`tools/content-schema.ts`; a test fails while the file in docs/ is behind the
core. A block type or a field added to the core is in the schema the next time
the tool runs.

The schema is strict where an agent makes mistakes (a block's type, the
fields it holds, their lengths, rich text as nodes and not HTML) and loose
where the program already cleans and the agent rarely writes (layouts, menus,
styles, themes, which are copied from a file in themes/).

It describes; it does not guard. Everything in a file is cleaned again by the
program when it comes in, as before, and what the schema forbids is dropped
there. A file the program writes keeps to the schema; a test holds it to that.

### d2. An example that is a whole site

`docs/examples/dental-clinic.uhlaka.json` is a small site written by hand to
the schema: settings, three pages, a form, a post. A test imports it into a new
site and checks that nothing is dropped and everything is published. An agent
starts from it.

### d3. AGENTS.md at the root

One file for any agent (Claude, Cursor, Codex and the others read it): how to
build a site with Uhlaka (write the file, `uhlaka import`, look at it with
`uhlaka edit`), and the rules for working on Uhlaka's own code (ADRs first,
`bun run check`, no new dependency without a decision, nothing from a third
party in the page). It points to the files that say more, and repeats nothing
they hold.

### d4. The admin is not for search engines

Not a matter of AI, but found in the same review: the admin's addresses
(`/admin`, `/admin/…`, `/preview`, `/api/…`) now answer with
`X-Robots-Tag: noindex, nofollow`, whatever they answer. The site's pages and
media are left as they were.

## Not decided here

- **Industry packs** (a theme and a content file for a clinic, a guesthouse):
  they are a content file each, and can follow this record. Whether they are
  free or sold is David's to decide.
- **The schema at a public address** (uhlaka.org/schema/…), with a version in
  its name, once the format changes for the first time.
- **An assistant in the admin** that writes such changes for the owner: a part
  of the AI extension (ADR 0027), with its own record.
