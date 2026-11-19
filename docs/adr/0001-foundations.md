# ADR 0001 — Foundations: who it is for, what a page is, how it is licensed

- **Status:** Accepted 2026-11-16 (owner: "mergem pe ceea ce propui tu")
- **Date:** 2026-11-16
- **Deciders:** project owner + engineering
- **Inputs:** the starting brief of 2026-11-16, the owner's answers in the
  project thread the same day, and a read-only study of Zveltio
  (`zveltio-devs/zveltio`, `zveltio-devs/zveltio-extensions`) at that date.

This is the first decision record. It fixes what the project is before any code
exists, so later decisions have something to be measured against. Every decision
carries its reason, so it can be challenged with arguments.

## Context

The brief describes a modern CMS for content sites: visual control, content
stored as data, plugins that cannot break the site, hosting for 0 to 3 EUR. It
left four questions open (audience, market, business model, editor framework).
The owner answered all four, and reading Zveltio corrected two assumptions of
the brief. Both are recorded here.

## Decisions

### d1. The audience is any WordPress user

Site owners, freelancers and agencies alike. What they share is where they come
from and what they already know.

Consequences:

- **WordPress import is the front door, not a late feature.** It moves from
  phase 3 of the brief to the prototype (pages and posts first; media, menus,
  URL preservation and SEO metadata follow).
- **The blog is part of the core:** posts, categories, tags, an RSS feed.
  Without them an import loses half of a typical site.
- **WordPress vocabulary is kept where it fits:** pages, posts, media, menus,
  "Publish".

### d2. Content sites only; no commerce in the core

No shops, memberships, courses or forums. WordPress itself does not cover these;
they arrive through plugins. Sites that need them are served by other platforms
(Zveltio among them).

*Why:* competing on that ground is competing on ecosystem, which the brief rules
out in its first paragraph.

### d3. International from day one; EU rules are the default behaviour

- The interface ships in English only at first. Every string is data from the
  first commit, so a language is a pack, not a code change. Romanian is the
  first such pack.
- Nothing country-specific lives in the core. Country blocks (legal footers,
  consumer-protection badges, an Impressum) are modules.
- EU rules are how the product behaves, not a setting: cookie consent included,
  no third-party request out of the box (fonts are self-hosted, no external
  analytics by default), forms record consent, personal data can be exported
  and erased.

### d4. Open-source core, complete; revenue from managed hosting

- The core is complete. No basic function sits behind a payment.
- Revenue comes from managed hosting: an account, a button, the site is online,
  with backups, a domain and updates.
- Premium themes and modules are a possible second source, later. Nothing is
  built for them now except keeping the theme and module formats clean enough
  to distribute.

Consequence for the code: the same core runs as one self-hosted site and as a
service holding many sites. With SQLite that is one file per site, and it is
kept in mind from the first line.

### d5. Licence: GPL-3.0-or-later for the core

> **Superseded by ADR 0020** (2026-11-19): the core is AGPL-3.0-or-later.
> Themes, language packs and the client/SDK are MIT. The text below is kept as
> the earlier reasoning.

*Why GPL:* the audience comes from a GPL world and reads it as a sign of trust.
The owner judged that AGPL would make part of that audience refuse the platform
outright. The accepted cost: others may host the product without contributing
back.

*Why version 3:* it combines cleanly with Apache-2.0 dependencies, which are
common in the JavaScript ecosystem.

Packages shared with Zveltio's SDK stay MIT, which is GPL-compatible. (Corrected 2026-11-19: Zveltio itself is AGPL-3.0 and only its SDK is MIT, so code from this core can also go into Zveltio; only code meant for the SDK must be MIT.) Themes are data
and modules run isolated behind a contract, so neither is a derived work: they
may carry any licence, commercial ones included.

### d6. The editor and the public renderer are Svelte 5

*Why:* the reusable work in Zveltio is on the Svelte side (see "What Zveltio
gives us"), and Svelte renders clean static HTML with very little JavaScript,
which is what static export needs. The usual argument for React, its ecosystem,
weighs little here: themes are data and modules run no code in the page, so no
outsider writes components in our framework.

### d7. A page is a tree of blocks; a block keeps content and style apart

```json
{
  "id": "b_01",
  "type": "hero",
  "content": { "title": "…", "subtitle": "…", "action": { "label": "…", "href": "/contact/" } },
  "style": { "background": { "token": "primary" }, "paddingBlock": { "value": "6rem" } }
}
```

- `content` holds what the block says. It never holds a colour, a size, a class
  name or markup that styles.
- `style` holds how this one block departs from the theme. Any property may be
  set: this is full visual freedom.
- A style value is either a **token reference** (`{ "token": "primary" }`) or a
  **free value** (`{ "value": "#0a7" }`). The editor offers the theme's tokens
  first.
- Blocks are addressed by `id`, never by position or path. A path is
  invalidated by the very move that uses it.
- There is **one list of block types**, and a test fails if the editor can add a
  block the renderer cannot draw.

*Why the split:* it is what lets freedom and themes coexist. On a theme change,
everything bound by token follows the new theme. Free values stay as set, are
visibly marked in the editor, and can be reset to the theme per block or for the
whole site. Content is never touched, because style does not live in it.

*What is refused in the core:* raw HTML and raw CSS. They are a security matter,
not a styling one. A module may offer them.

### d8. A theme is a data document, and there is a visual theme builder

A theme holds:

- **tokens:** colours, typography, a spacing scale, radii;
- **block defaults:** the default style of each block type, and its named
  variants;
- **templates:** header, footer and page layouts, themselves block trees.

The theme builder edits this document visually. A theme exports and imports as
one file. A theme never contains code.

*Why:* WordPress users already know the idea (the Site Editor, Global Styles,
`theme.json`). Here it can be cleaner, because nothing but data sits underneath.
Every theme value is validated before it reaches a style attribute.

### d9. Carried over from the brief unchanged

Recorded so this ADR is the single starting point; each gets its own ADR when
its work begins.

- **SQLite, one file per site.** Backup is copying a file.
- **Static export is the main way to publish.** Only forms and search need a
  small backend or a service.
- **Modules declare, run isolated (QuickJS-WASM) and fail alone.** An error
  carries the module's name; the core never falls with it. No easier path
  bypasses the isolation.
- **Included without modules:** SEO, optimised images, a contact form,
  multilingual content, cookie consent, GDPR tools.
- **One binary and a one-click deploy;** the first admin is created through a
  single-use setup link and passes through the same authentication layer as any
  account.

## What Zveltio gives us, and what it does not

Verified by reading the code, not taken from the brief.

| Topic | Finding | What we do |
|---|---|---|
| `view/2` | It describes admin screens over data (list, form, board, …) with a closed vocabulary. Zveltio's own docs place the page builder outside it. | It is **not** our page model. We take its discipline: closed objects, names instead of addresses, validation from one schema. |
| Page model | The `content/pages` extension: `{ id, type, content, style, col_span, motion }`, 14 block types, `container` for nesting. | We take the tree and the id-addressed operations. |
| Block styling | Visual: hex colours inside `content`, pixel paddings, twelfths, raw HTML in `embed`. | We do not take this. d7 separates content from style and binds style to tokens. |
| `@zveltio/ui` | Published on npm, MIT. Block components (Hero, Gallery, Stats, …) and a theme held as validated tokens. Requires Tailwind 4 and daisyUI 5. | First candidate dependency. Whether its blocks fit d7 as they are is decided by the prototype. |
| Tree operations | `block-tree.ts`: 227 lines of pure TypeScript with tests, inside Studio, not published. | Exactly what we need, not available as a dependency today. Extracting it is the Zveltio owners' decision; until then we write our own against the same behaviour. |
| Editor canvas | Inside Studio, bound to the engine's API. | Not reusable. We build our own. |
| Field types | About 50, bound to Postgres column types. | Not shared. We define the dozen a content site needs, with the known traps tested from the start (integers past 2^53, decimals past 15 digits, binary round-trip). |
| Block vocabulary | Four lists once drifted apart; pages rendered as "Unsupported block" for three months. | One list and a contract test from day one (d7). |

This narrows section 4 of the brief: the common root with Zveltio is real, but
smaller than "view/2 and the renderers". Its rules stand: a package is extracted
only when this project needs it, a shared package imports nothing from an engine
or a database, and shared code is a dependency, never a copy.

## Consequences for the plan

- Phase 1 (prototype) gains a minimal WordPress import and loses nothing.
- The prototype must prove d7 and d8 together: change the theme, and a page
  with both token-bound and free styles behaves as described.
- The validation with non-technical people (phase 0 of the brief) still decides
  the shape of the editor.

## Open

- The exact token set and the list of style properties a block may set.
- Rich text: the stored format (a structured document, not HTML) and its editor.
- Whether `@zveltio/ui` blocks are used as they are, wrapped, or replaced.
- The first block list for the prototype.
