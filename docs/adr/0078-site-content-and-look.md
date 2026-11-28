# ADR 0078 — Site content and Look: two panels named by what they hold

- **Status:** Accepted (Liviu, 2026-11-25, with David's agreement passed on by Liviu: "da"). d1 and d2 replaced by [ADR 0082](0082-design-and-settings.md) (2026-11-28); d3 stays.
- **Date:** 2026-11-25
- **Builds on:** ADR 0006 (header and footer), ADR 0072 (an address for each screen of the admin)

Liviu, using the admin, could not tell "Menu and settings" from "Theme": both
open the editor with a panel on the right, and both touch the header. They do
different things, but their names did not say which.

## Decisions

### d1. The names say what each panel holds

- **Site content (menu, logo, SEO)**, Romanian *Conținutul site-ului (meniu,
  logo, SEO)*: what the site says on every page — its name, logo, menu,
  language, and what search engines and shared links show. Formerly "Menu and
  settings" in the navigation and "Site settings" on its button and in
  messages.
- **Look (colours, fonts, header)**, Romanian *Aspect (culori, fonturi,
  antet)*: how the whole site looks — colours, fonts, spacing and how the
  header and footer are laid out. Formerly "Theme". A *theme* stays the name
  of the thing chosen and published (the theme picker in the top bar,
  "Publish theme"): the Look panel edits the current theme.

### d2. Each panel starts with one line saying what it holds, and where the other half is

The header shows up in both: what it says is Site content, how it is laid out
is Look. Each panel's first line names the other, so a person in the wrong
one is sent to the right one.

### d3. Saving in Look is said, not guessed (uhlaka#108)

Changes in Look are kept at once as a draft; the panel says so, and carries
"Publish theme" when there is something to publish. While the panel is open
the canvas shows a sticky header as the site will.

## Not changed

The panels, their contents, the addresses of the admin (`#at=settings`,
`#at=theme`) and the format of themes and sites stay as they were.
