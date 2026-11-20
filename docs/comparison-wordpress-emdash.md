# thecms next to WordPress and EmDash

- **Date:** 2026-11-19
- **Status:** Analysis, for discussion. It decides nothing; each item it
  recommends gets its own ADR when its work begins.
- **Compared:** thecms at `main` (ADR 0001 to 0016; ADR 0017 open as a pull
  request), **WordPress 7.0** (released 2026-05-20) and **EmDash 1.0**, the CMS
  Cloudflare announced on 2026-04-01 and released as stable on 2026-09-28.
- **Also answers:** whether thecms should be framework-agnostic through an SDK,
  and whether the admin should be a client of it (asked by the owner the same
  day).
- **Out of scope here:** language packs for the admin and tags, which have their
  own thread, and modules and AI, designed in ADR 0014's thread. Those are only
  cross-referenced below.

## The three in one paragraph each

**WordPress 7.0** is PHP and MySQL, rendered on every request, with the block
editor (Gutenberg) storing blocks as HTML with comments. Its strengths are
everything around the editor: accounts and roles, revisions (in 7.0 a visual
timeline inside the editor), scheduling, comments, a REST API, a translated
admin, privacy tools (export and erase personal data) in core, and, new in 7.0,
an AI client, a Connectors screen for API keys, the Abilities API and editor
notes. Real-time collaboration was cut from 7.0. Plugins run with full access
to everything, which is its oldest weakness.

**EmDash** is TypeScript on Astro 6, MIT, built to run on Cloudflare (D1, R2,
Workers) or on Node with SQLite or Postgres. Content is Portable Text (JSON),
edited with TipTap. Content types are created in the admin and become real SQL
tables, with TypeScript types generated from them. It has drafts, revisions,
scheduled publishing, full-text search (SQLite FTS5), passkey login with
magic-link and OAuth fallback, four WordPress-like roles, content translations
grouped per entry with `hreflang` in the sitemap, a redirect manager, basic SEO
fields, an MCP server, a CLI with JSON output, and a WordPress import from WXR,
the REST API or WordPress.com. Plugins run sandboxed (Dynamic Workers, or a
`workerd` process on Node), declare capabilities, and draw their admin screens
from a JSON schema. 1.0 added a signed, decentralised plugin registry on AT
Protocol. Its themes are Astro projects, which means code, and it has no
point-and-click site builder.

**thecms** is Svelte 5 on Bun, GPL-3.0-or-later, on SQLite, Postgres or MySQL.
Pages are block trees saved as data, edited visually on the real page. A block
keeps content and style apart, and style binds to theme tokens. A theme is a
data document with a visual builder and contains no code. The site is
published as static files. Content types are made in the admin, and a WordPress
export comes over with a plan shown first, images, links rewritten, old
addresses kept alive and a report of what did not come.

## Where thecms is already ahead

These are worth protecting. None of the other two has all of them.

| | thecms | WordPress 7.0 | EmDash 1.0 |
|---|---|---|---|
| Visual editing on the real page, for non-developers | yes | yes | inline text editing; no site builder |
| Content and style kept apart, style bound to tokens | yes, by rule (ADR 0001 d7) | partly: `theme.json` presets, but free values and custom CSS live in the block | not a CMS concern; styling is in Astro code |
| A theme is data, built visually, with no code | yes | block themes are mostly data, but PHP is still allowed | no: a theme is an Astro project |
| Published as static files, any host, nothing to break into | yes, the main path | no (plugins exist) | no: rendered on request (Live Collections) |
| Raw HTML and CSS refused in core | yes | no: 7.0 adds per-block custom CSS and an HTML block with JS | Portable Text, so mostly yes |
| WordPress import that shows its plan first and reports what it drops | yes | n/a | wizard, no plan-first report described |
| Old addresses kept alive after import, as files | yes | n/a | redirect manager |
| No vendor platform behind it | yes | yes | in practice Cloudflare is the polished path; Mullenweg's critique, and Joost de Valk's, both note it |

The positioning that follows: **WordPress's ease, without WordPress's attack
surface, and without being tied to one cloud.** EmDash is the closest
competitor in spirit, but it is aimed at developers (Astro themes, code-first
templates). thecms is aimed at the people who use WordPress without writing
code, and that gap is real.

## What they have and thecms lacks

Grouped by what a WordPress user notices first. "Take" means worth taking;
"adapt" means take the idea, not the shape.

### Running a site with more than one person

| Feature | WordPress | EmDash | thecms today | Verdict |
|---|---|---|---|---|
| Accounts and login | yes | passkeys first, magic link, OAuth | the editor is local, opened with a key (ADR 0003 d5) | **take**, passkeys first |
| Roles | 5 (Admin, Editor, Author, Contributor, Subscriber) | 4 | none | **take** the four EmDash keeps; the names are the ones WordPress users know |
| Revisions and restore | yes, visual in 7.0 | yes | none; undo covers a page's blocks in one session | **take** |
| Scheduled publishing | yes | yes | none | **take**, adapted to static export (below) |
| Preview link for a draft | yes | yes | the editor shows the draft | **take**: a private, expiring address |
| Notes on a block for co-workers | yes, 7.0 | no | none | later |
| Audit log | plugin | first-party plugin | none | later, as a module |
| Real-time co-editing | dropped from 7.0 | no | none | not now |

### Content

| Feature | WordPress | EmDash | thecms today | Verdict |
|---|---|---|---|---|
| Tags, authors, author pages | yes | yes | categories only | tags: other thread. **take** authors |
| Comments | yes | "comment-ready" template | none (ADR 0007) | **adapt**: as a moderated form, or left to a module; do not build WordPress comments |
| Translated content (one page in several languages) | plugin (WPML, Polylang) | core: translation groups, per-locale slug and status, `hreflang` | promised (ADR 0001 d9), not built | **take** EmDash's model; it is the right one |
| Reusable sections (synced patterns, with overrides) | yes | no | none | **take** |
| Page templates (landing without header, sidebar) | yes | in code | named as missing (ADR 0006) | **take** |
| Full-text search | yes | FTS5 | none | **adapt**: an index written at export, searched in the browser, no third party |
| Forms | plugin | first-party plugin | none; promised in core (ADR 0001 d9) | **take**: one contact form with consent, posted to the managed host or a module |
| Embeds (YouTube, maps) | yes | plugin | none | **adapt**: click to load, nothing fetched before consent |
| Typed API for content | REST | REST, generated TypeScript types, MCP | none | **adapt**: a read-only JSON export next to the HTML, so the site can also be used headless |

### Look and media

| Feature | WordPress | EmDash | thecms today | Verdict |
|---|---|---|---|---|
| Responsive images (`srcset`, `width`/`height`, AVIF/WebP) | yes | via Astro | named as missing (ADR 0005) | **take**, at export |
| Crop and focal point | yes, new editor in 7.0 | no | none | **take** focal point; crop later |
| Self-hosted web fonts (a Fonts page in 7.0) | yes | via Astro | device fonts (ADR 0002 d3) | **take**: fonts copied into the site, never fetched from Google |
| Dark mode, values per screen size, hide on phone | yes (7.0 viewport visibility) | dark/light templates | named as missing (ADR 0004) | **take** |
| Breadcrumbs, icons | 7.0 blocks | no | none | breadcrumbs: take; icons: later |
| Command palette (Ctrl+K) | 7.0 | no | none | later, cheap |

### Being found

| Feature | WordPress | EmDash | thecms today | Verdict |
|---|---|---|---|---|
| SEO title, description, share image | plugin (Yoast and others) | core fields | description, Open Graph, canonical, sitemap, robots | **take**: per-entry SEO title and `noindex` |
| Structured data (`BlogPosting`, `BreadcrumbList`) | plugin | plugin | named as missing (ADR 0007) | **take** |
| Redirect manager in the admin | plugin | core | redirects only from an import | **take**, and a redirect left when an address changes (ADR 0010 gap) |
| Import of SEO metadata from Yoast or Rank Math | n/a | not described | not imported | **take**; most imported sites have it |

### Moving in and out

| Feature | WordPress | EmDash | thecms today | Verdict |
|---|---|---|---|---|
| Import from a live site (REST API) and WordPress.com | n/a | yes | export file only (ADR 0009 d1, on purpose) | **take** as a second source, keeping the plan-first rule |
| Gutenberg blocks mapped to own blocks | n/a | to Portable Text | meaning only (ADR 0009 d3) | **take** the common ones: columns, group, cover, gallery, buttons, quote |
| Featured images, sticky posts | yes | yes | dropped (ADR 0009) | **take** featured images |
| A site export that imports back | WXR | not described | the SQLite file is the backup; no open format | **take**: one JSON file, the same documents the store holds |

### Extensions and AI

WordPress 7.0 adds an AI client, a Connectors screen for keys and the
Abilities API; EmDash ships an MCP server, a CLI, Agent Skills, sandboxed
plugins with capability manifests, admin screens as JSON, and a signed plugin
registry. All of this belongs to ADR 0014's thread. Three things from EmDash
seem worth that thread's attention: a plugin's admin screen described as data,
which matches thecms's own rule that nothing typed becomes markup; signed
releases checked against the bundle before install; and an MCP server that
goes through the same permissions as a person.

## Framework-agnostic, and the admin as an SDK client

The owner asked two questions on 2026-11-19: can thecms be framework-agnostic
like Zveltio, with Svelte what we ship but React or Vue possible through an
SDK; and should the admin be a client of that SDK, as Zveltio's Studio is. And:
the Zveltio model may be too much, so consider lighter options.

### What Zveltio does

Read at `zveltio-devs/zveltio` on 2026-11-19, read-only.

- `@zveltio/sdk` is a large public package: a data client, real-time,
  offline sync, RPC, code generation, extension and view types, publishing and
  build tools, as eleven subpath exports, declared API-stable. `@zveltio/react`
  and `@zveltio/vue` are thin bindings over it (about 1,100 lines together).
- Studio goes through the engine's public HTTP API, with no private path into
  the server. It uses the SDK for view and extension types, but its data calls
  go through its own client (`packages/studio/src/lib/api.ts`) and through
  `fetch` in about a dozen files. So the rule Zveltio really keeps is "the admin
  uses only the public API", more than "the admin is built on the SDK package".
- The UI model (ADR 0042) makes screens data, so each front end draws them in
  its own framework.

That fits Zveltio, which is an application platform: its users build their own
front ends over their data, so many clients are the point. **thecms is
different in one way that changes the answer.** Its visitors receive static
HTML and CSS. The markup of a block is the same under every theme (ADR 0006
d3), and the theme is a stylesheet made from tokens. For a visitor the site is
already framework-agnostic: no Svelte reaches the browser.

### Where a framework could matter

1. **Someone wants their own front end** (Next, Nuxt, Astro) and uses thecms
   only for content. They need the content, in a stable shape. They do not need
   Svelte, and they do not need our block components, if they can take the
   block's HTML or its JSON.
2. **Someone wants to draw the blocks in React or Vue.** That means every block
   type written again in each framework, kept in step with ours. Zveltio paid
   for exactly this: four lists of block types drifted apart and pages showed
   "Unsupported block" for three months (ADR 0001). It also breaks ADR 0003 d1:
   the editor's canvas is the public renderer, so a page drawn by another
   renderer is not what the editor shows.
3. **The admin.** Today it calls the local editing server through a typed file
   (`src/admin/api.ts`, 118 lines) over `/api/` routes (`src/site/server.ts`,
   420 lines). There is no second, hidden way in, but the routes are shaped for
   the admin, unversioned and undocumented.

### Three levels, from light to heavy

| Level | What it is | Cost | Gives |
|---|---|---|---|
| **A. Content as files** | The export writes, next to each page's HTML, its document as JSON, plus an index per content type and the theme's CSS. Same rules: only what is published. | Small. No server, no API to keep stable beyond the document format, which `src/core` already defines and validates. | Any framework can read the site at build time, from any static host. Headless use, and the open export of P2, almost free. |
| **B. One documented API, and the admin uses only it** | The `/api/` routes become the public, versioned API (read and write, behind the accounts of P0). `src/admin/api.ts` becomes a small typed client over it, published as a pure TypeScript package with no framework. The admin, the CLI and later the MCP server of ADR 0014 all use it; no route exists only for the admin. | Medium, and mostly work P0 forces anyway: once there are accounts, every route needs authentication, permissions and a stable shape. Adds a promise to keep: versioning and deprecation. | Whatever the admin can do, an integration or an agent can do, through the same checks. Bugs in the API show up in our own admin first. |
| **C. Zveltio's model** | The SDK above plus `@thecms/react` and `@thecms/vue`, block components per framework, real-time and offline. | Large and permanent: each block type × each framework, a contract test per renderer, two more packages to release, and a visual editor that cannot show those renderers. | Developers who want our blocks inside their React or Vue app. Today nobody is asking. |

### Recommendation

- **Take A and B. Do not take C now.** Zveltio's model is right for Zveltio and
  too much for thecms; the owner's doubt is justified.
- **B goes with accounts (P0, item 1)**, because that is when every route is
  touched anyway. The rule to write in its ADR: the admin talks to the server
  only through the public API, and a test fails if a route has no entry in
  the API's description.
- **A goes with the open export (P2, item 12)**, moved earlier if a first user
  wants a headless site.
- **For other frameworks, publish the contract, not the components.** A
  fixture set (block JSON in, expected HTML out) and the theme's CSS let anyone
  write a React or Vue renderer and prove it matches. If one is ever official,
  it is held by the same contract test as ours. Until then, a framework app can
  insert the block HTML the API or the export gives, which is safe because the
  renderer already escapes everything an author typed (README rule 2).
- **The client package's licence is the owner's decision.** If it is to be used
  inside closed front ends, it should be MIT, as Zveltio's SDKs and the shared
  packages of ADR 0001 d5 are, while the core stays GPL-3.0-or-later.

## What thecms should not take

- **Code in themes** (EmDash's Astro themes, WordPress's PHP). Themes as data is
  thecms's best idea.
- **Per-block custom CSS and an HTML block with script** (WordPress 7.0). ADR
  0001 d7 refuses them in core for a security reason, and that still holds.
- **Rendering on every request as the default.** Static output is cheaper,
  faster and safer, and it is what makes 0 to 3 EUR hosting possible.
- **One cloud's primitives in core** (D1, R2, Dynamic Workers). The managed
  hosting may use any cloud, but self-hosting must stay first class.
- **x402 pay-per-crawl** (EmDash). Interesting, but it is a payment rail, and
  ADR 0001 d2 keeps commerce out of core.

## What a modern CMS should have, beyond copying

- **Privacy that needs no banner.** If the site sets no cookie and calls no
  third party, the law asks for no consent banner. Make that the state of a new
  site, and show the banner only when a module or an embed adds something that
  needs it. This is a stronger EU default than "cookie consent included".
- **Accessibility as a gate, not a hope.** The European Accessibility Act
  applies since June 2025. Check contrast in the theme builder (already named in
  ADR 0004), require alt text or an explicit "decorative" on every image, keep a
  heading order, and run an automated WCAG 2.2 AA check in the end-to-end test.
- **Performance budgets on the export.** A page over a size or with layout
  shift fails the build, so a theme cannot make the site slow without someone
  noticing.
- **A say over AI crawlers.** A machine-readable opt-out of text and data
  mining (the EU copyright directive, Article 4) and an `llms.txt`, both set in
  one place in the settings.
- **Content that leaves easily.** An open export, the JSON next to the HTML, and
  an import that reads it back. This is what WordPress users most fear losing.
- **Publishing as a pipeline.** Publish, schedule and the static export are one
  step: what is published is exported, only what changed is written, and the
  result goes to a target (a folder, S3-compatible storage, the managed host).
  Scheduling then is a time on that step, which a static site otherwise cannot
  have.

## Recommendation, in order

Ordered by what blocks real use first. P0 is what is needed before anyone other
than the owner can run a site on it, which is also what the managed hosting of
ADR 0001 d4 needs.

**P0: so that a site can be run by real people**

1. **Accounts, passkey login and the four roles**, with the single-use setup
   link of ADR 0001 d9. Everything else in this list assumes it. With it,
   **one documented API that the admin uses and nothing else bypasses**
   (level B above).
2. **Revisions and restore** for pages, entries and the theme; autosave.
3. **Publishing as a pipeline**: incremental export, scheduled publishing, and
   at least two targets (a folder and S3-compatible storage).
4. **Responsive images and self-hosted fonts**, because they decide the first
   speed test a WordPress user runs.
5. **SEO completeness**: per-entry SEO title and `noindex`, structured data,
   a redirect manager, and a redirect left when an address changes.

**P1: so that a typical WordPress site comes over whole**

6. **Translated content** on EmDash's model (translation groups, per-locale
   address and status, `hreflang`). This is separate from the admin's language
   packs.
7. **Authors and featured images**, and their import; Yoast and Rank Math
   metadata on import.
8. **One contact form with consent**, and **search** from an index written at
   export.
9. **Reusable sections and page templates.**
10. **The privacy and accessibility gates** above: no banner by default,
    click-to-load embeds, alt text required, contrast checked, WCAG run in CI.

**P2: to be better, not only equal**

11. Import from a live WordPress site and from WordPress.com; mapping of the
    common Gutenberg blocks.
12. An open site export that imports back; the JSON next to the HTML (level A
    above), and the block fixtures that let others write a renderer.
13. Dark mode and values per screen size in the theme.
14. Performance budgets on the export, and the AI-crawler settings.
15. Editor notes, a command palette, an audit log (the last as a module).

Modules, the MCP server, AI help in the editor and a plugin registry follow
ADR 0014 and are not ranked here.

## Sources

- WordPress 7.0: [Gutenberg Times, "WordPress 7.0 Source of Truth"](https://gutenbergtimes.com/wordpress-7-0-source-of-truth/)
- EmDash: [README](https://cdn.jsdelivr.net/gh/emdash-cms/emdash@HEAD/README.md),
  [Cloudflare blog, EmDash 1.0](https://blog.cloudflare.com/emdash-cms-plugin-registry/),
  [CMSWire on 1.0](https://www.cmswire.com/digital-experience/cloudflare-releases-emdash-1-0-cms-with-decentralized-plugin-registry/),
  [InfoQ](https://infoq.com/news/2026/04/cloudflare-emdash-wordpress),
  [Joost de Valk's review](https://joost.blog/emdash-cms/),
  [internationalization guide](https://emdashcmseverything.pages.dev/official-docs/guides/internationalization)
- thecms: `README.md` and `docs/adr/`, read at `main` on 2026-11-19.
