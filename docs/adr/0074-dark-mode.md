# ADR 0074 — Dark mode: a second palette in each theme, and a switch on the site

- **Status:** Proposed (Liviu asked for it on 2026-11-24: dark mode in the themes, "si butonul de comutare cu implicit pe valoarea din calculatorul userului"; the script of d4 and its place in the documentation, "da fa-o, dar trece si in documentatie", Liviu, the same day; waits for David)
- **Date:** 2026-11-24
- **Builds on:** ADR 0002 d2 (tokens; dark mode left for later), ADR 0004 (the theme builder; a check of contrast left for later), ADR 0044 (the site is served, with a cache), ADR 0053 (nothing stored in the visitor's browser without a reason; no banner), ADR 0068 (Atelier), ADR 0071 (the language switcher and its cookie)

Phones and computers can be set to dark, and many people read the web that
way. A site in Uhlaka is always light today (Studio is always dark). ADR 0002
and ADR 0004 left dark mode for later, as an addition to the tokens and not a
change to them. This is that addition.

Blocks already take every colour from the theme's tokens (`base.css` has no
colour of its own), so a second set of values for the same tokens is enough to
turn a whole site dark. No block, page or section changes.

## Decisions

### d1. A theme may have a second palette, for the other scheme

A theme says which scheme its own colours are (`"scheme": "light"`, the
default, or `"dark"`) and may carry the other one:

```json
{
  "spec": "uhlaka.theme/1",
  "name": "Atelier",
  "scheme": "light",
  "tokens": { "color": { "background": "#f7f8fc", "text": "#151a33", "…": "…" } },
  "dark": { "color": { "background": "#0e1330", "text": "#eef0fa", "…": "…" } }
}
```

Only colours change between the two; space, type, radius and widths are the
same. The second palette names only colour tokens the theme already has, and
a token it leaves out keeps its value. A token keeps its role in both:
`on-primary` is what reads on `primary`, in light and in dark. The format stays
`uhlaka.theme/1`, since a theme without the new keys reads as it did; a bad
value in the second palette refuses the theme whole, as any other (ADR 0004).

One new optional colour token, `link`: the colour of links and small accents
on the page's background (`a`, the eyebrow, the current menu item). Where a
theme has no `link`, `primary` is used, as today. It exists because a dark
palette needs a light blue for text and a deep blue behind white text, and
`primary` cannot be both.

### d2. The owner picks one of three, on the Theme screen

**Light only**, **Follow the visitor**, **Dark only** (for Studio: its own
scheme is dark, so "Dark only" is what it is today).

- A new site starts on **Follow the visitor**.
- A site that exists keeps its look: it stays on its theme's own scheme until
  the owner picks. Nothing changes under an owner who did not ask.
- A theme with only one palette offers only its own scheme; the screen says
  why, and offers to make the other palette (d5).

### d3. Following the device needs no script

The stylesheet carries both palettes. The theme's own sits on `:root`; the
other is written under `@media (prefers-color-scheme: dark)` (or `light`), so
a visitor whose device is dark sees the dark site from the first paint, with
no flash and no script. `color-scheme` is set too, so the browser's own parts
(scroll bars, a date picker in a form) follow.

The pages are the same bytes for every visitor, so the HTML cache (ADR 0044)
and a cache in front (Cloudflare) keep working unchanged.

### d4. The switch in the header: the site's first script, and only this one

When the owner picked **Follow the visitor**, the header carries a switch
beside the language switcher (outside the folded menu, so it is there on a
phone too, as ADR 0071 d2): a sun or a moon, read out as "Light theme" or
"Dark theme". It starts on what the visitor's device says, and a click turns
the site the other way at once, with no new page.

It takes a script, and this is the first one on a public page. Every way
without one was weighed (Liviu and the thread, 2026-11-24): a switch made of
CSS alone turns at once but forgets the choice on the next page; a link to
the server remembers but costs a new page on each click, needs one more
request on every page, and cannot work on an exported site; pages made in a
light and a dark copy break the cache. Tailwind and the like do it with a
script too. The rule "no script on the site" (ADR 0002, kept since by forms,
statistics and the language switcher) gets one exception, written here, and
only this one:

- **One file, from the site itself**: `/assets/scheme.js`, under 1 KB, linked
  in the page's head only when the switch is on. No inline script, so the CSP
  stays as it is (`script-src` is `'self'` through `default-src`); nothing
  from another host.
- **What it does, and nothing else**: on load, before the page is painted, it
  reads the visitor's choice and sets `data-scheme="light"` or `"dark"` on
  `<html>` (so there is no flash of the other colours); on a click it turns
  the attribute and keeps the choice. The stylesheet does the rest:
  `:root[data-scheme=dark]` carries the dark palette, and the media query of
  d3 skips a visitor who chose light.
- **Where the choice is kept**: in the visitor's own browser
  (`localStorage`, key `uhlaka-scheme`, `light` or `dark`), never sent to the
  server. It is kept only when the visitor clicks and holds only that, so it
  needs no consent and no banner (ADR 0053, as `uhlaka-lang` in ADR 0071 d2).
  A visitor who turns the site back to what their device says loses the
  choice, and the site follows the device again.
- **The same page for everyone**: the HTML does not change with the choice,
  so the HTML cache and a cache in front (Cloudflare) work as they do.
- **On an exported site too**, since nothing of it needs the server.
- **Without scripts** (blocked, or a reader that has none) the switch is not
  shown, and the colours follow the device, as d3. Nothing breaks.

The test that held "an exported page has no script" now holds that the only
script a page may have is `/assets/scheme.js`, and only with the switch on.

### d5. The builder makes, previews and checks the second palette

- **Make it for me.** On a theme with one palette, a button proposes the other
  from it: the neutrals turned around (background, surface, text, muted,
  border), the brand colours kept and moved in lightness until they read. The
  owner sees it and adjusts any colour by hand.
- **See it.** The theme builder and the page builder get "Light / Dark"
  over the preview, so the owner sees both without changing their computer.
- **A check of contrast** (left open in ADR 0004): in both palettes, the
  pairs a site reads by (text on background and on surface, muted on both,
  link on both, `on-primary` on `primary`, and each block's or the header's
  own pair a theme sets) are measured. A pair under 4.5 : 1 (WCAG AA) is
  marked, with the two colours named. It warns; it does not refuse.
- **Colours picked by hand.** A free colour on a block does not follow a
  theme, so it stays the same in dark. The Theme screen says how many there
  are, beside "reset to theme", as it does now for a theme change.

### d6. Atelier, Plain and Studio ship with both palettes

Each checked by the test of d7 before it ships. Measured for this ADR:

| Theme | Other palette | text / background | muted / background | link / background | on-primary / primary |
|---|---|---|---|---|---|
| Atelier | dark: background `#0e1330`, surface `#161c42`, text `#eef0fa`, primary `#3149c4`, link `#9aabff` | 16.0 | 8.6 | 8.4 | 7.3 |
| Plain | dark: background `#111318`, surface `#1a1d24`, text `#eceef2`, primary `#2f6ae0`, link `#7eaaff` | 16.0 | 7.9 | 8.0 | 4.9 |
| Studio | light: background `#faf7f1`, surface `#f1ece2`, text `#1d1a15`, primary `#f2b84b`, link `#8a5a00` | 16.2 | 6.4 | 5.5 | 10.2 |

Atelier also gets `on-sun` (`#151a33` in both) for the text of its yellow
buttons, which named `text` and would turn light in the dark. Its tints become
deep (`#1d2858`, `#3a3216`, `#16392a`, `#3c291c`, light text on each above
11 : 1). The exact values may move while the screens are looked at; the test
holds the floor.

### d7. Written in the documentation

The documentation on uhlaka.org gets a page for it, with the code: the three
choices and the switch, the second palette and how the builder makes it, the
check of contrast, and that the switch is the one small script a site carries,
what it keeps and where. The README's list of what a site sends a visitor
says so too.

### d8. What is not covered

- **Pictures** stay as they are. A logo drawn for a light background may need
  a second file for the dark; that is a later addition to site settings.
- **Things from other sites** (a map, a video) keep their own colours.
- **The admin** stays light; a dark admin is its own decision.

## Verification

- Unit: a theme with a second palette parses; one naming a token the theme
  lacks, or holding a bad colour, is refused whole; the stylesheet holds the
  other palette under the media query, and nothing of it for "Light only" or
  "Dark only"; a page's HTML is the same bytes under all three choices.
- Unit: the three shipped themes pass the contrast pairs of d5 in both
  palettes.
- Unit: a page carries `/assets/scheme.js` only with "Follow the visitor",
  and no other script; the exported site too.
- Browser (`e2e`): a page under `prefers-color-scheme: dark` paints dark; the
  switch turns it light at once, the choice holds on the next page and after
  a reload, with no flash of the dark colours; with scripts off there is no
  switch and the page follows the device; with "Light only" there is no
  switch, no script, and the page is light on a dark device.
