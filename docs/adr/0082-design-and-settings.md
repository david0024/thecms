# ADR 0082 — Design and Settings: one style, the header where you click it

- **Status:** Accepted (David, 2026-11-28: "perfect. asa facem", on the model of one style with ready-made starting points, a Design group and Settings apart)
- **Date:** 2026-11-28
- **Builds on:** ADR 0001 d8 (a theme is a data document), ADR 0004 (the theme builder), ADR 0006 (header and footer), ADR 0035 (theme, layout, page, section, site), ADR 0074 (dark mode)
- **Replaces:** ADR 0078 d1 and d2 (the names "Site content" and "Look", and the line in each panel sending to the other). ADR 0078 d3 stays.

David could not find where to make the menu bar stay at the top of the
screen. A look at the admin found why, and it was not a word:

- A click on the header in the page opened "Site content", which has the
  logo and the menu but not "stays at the top". That was in "Look", in the
  sixth section, closed. The header was split in two panels, and a click sent
  to one of them.
- "Site content (menu, logo, SEO)" held 70 fields in eleven groups: the name,
  languages, address, search engines, the business, the menu, the footer,
  forms, visitor accounts, the shop, e-mail, old addresses, speed. Settings,
  not content: to someone who knows WordPress, content is pages and posts.
- The same thing had three names on one screen: "Look" in the navigation,
  "Theme: Plain" and "Edit the look" in the bar over the page, "Publish
  theme" on its button.
- Choosing another theme in the bar replaced the one changed by hand, without
  a word.

And the question under it all: are there themes, or one theme everyone
shapes? In the code there is one. Atelier, Studio and Plain are the same
document (ADR 0001 d8) with other values: no theme can do what another
cannot. They are starting points.

## Decisions

### d1. One style per site, with ready-made styles to start from

The admin says **style** where it said theme or look. A site has one style:
its colours, typefaces, light and dark, spacing, the look of each block and
of the header and footer. **Ready-made styles** (Atelier, Studio, Plain, and
any that ship later) are shown as cards, each with its own typefaces and
colours; choosing one is where a site starts.

The document and its file do not change: `theme.json`, `themes/`, the
`theme` of a content file and of the API stay as they are (ADR 0001 d8). Only
the words a person reads change.

*Why:* a beginner understands "pick a style, then change what you like" (as
Squarespace's site styles and the style variations of WordPress's site
editor put it), and never needs to know what a theme engine is.

### d2. Design, in one place

The navigation gets a group **Design** with four entries, as the site shows
them:

| Entry | Holds |
| --- | --- |
| **Style** | ready-made styles; colours, typefaces, light and dark; under "More settings": spacing, corners, text sizes, widths, each block's look, the style's name and file |
| **Header and menu** | stays at the top, the logo, the menu, the header button (and in each language), the arrangement, colours and spacing, the menu panel |
| **Footer** | its text and links (and in each language), the arrangement, colours and spacing |
| **Layouts** | how a page is arranged (ADR 0035), unchanged |

Style, Header and menu, and Footer open beside the page being edited, as one
panel with three tabs, so a change is seen as it is made. Layouts stays a
screen of its own. The bar over the page has one button for all of it,
**Design**, where it had three controls; "Publish the style" stays beside it
while there is something to publish.

What is saved where does not change (ADR 0035 d1): the logo, the menu and the
footer's words are the site's; stays at the top, the arrangement and the
colours are the style's. Header and menu shows both, under **What it says**
and **How it looks**.

### d3. Edit where you click

A click on the header in the page opens Header and menu; a click on the
footer opens Footer. "Stays at the top while the page scrolls" is the first
thing in Header and menu, as a switch.

*Why:* the person who wants the menu to stay at the top clicks the menu.
Shopify's theme editor and Squarespace's header editor open what was clicked;
nothing else here asked for a search.

### d4. A ready-made style over a changed one asks first

Each card says whether it is the one in use, and whether it was changed.
Choosing another while the one in use has changes, or is a style of the
site's own, asks first: what is replaced (colours, typefaces, the look of the
header and footer), what stays (pages, menu, words), with **Download my
style** beside **Use …** and **Cancel**. Choosing one over a style that was
not changed needs no question: nothing is lost.

### d5. The navigation in groups

**Content** (pages, each content type, sections, media, forms), **Design**,
**People and messages** (to review, messages, comments, people), **Shop**
(orders, coupons) when the shop is on, and **Tools** (statistics, search
engines, content types, import, export, extensions, backups, Settings). Each
entry is one or two words; no entry carries a list of what it holds in
brackets.

### d6. Settings is a screen

**Settings** holds the site's name, languages and address, what search
engines and shared links are told, the business, forms, visitor accounts,
the shop, e-mail, old addresses and speed: everything that is not seen on the
page. It opens as a screen of its own at reading width, not over the page:
nothing in it is drawn there.

### d7. Addresses

`#at=settings` opens Settings. `#at=design/style`, `#at=design/header` and
`#at=design/footer` open Design at a part; `#at=theme`, from before, leads to
the style.

## Not changed

The format of styles (themes), sites and content files; what each part of
ADR 0035 holds; what the API takes. The words of earlier ADRs keep their
"theme".

## Not yet

- Search engine settings (the codes for Google and Bing, robots.txt, IndexNow,
  the business) could join the Search engines screen; they stay in Settings
  until that screen is looked at on its own.
- A picture of each ready-made style, larger, before choosing it.
