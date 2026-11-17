# ADR 0008 — The menu

- **Status:** Accepted
- **Date:** 2026-11-17
- **Builds on:** ADR 0001 d9 (a published page runs no script), ADR 0006 (what
  the header says is the site's, how it looks is the theme's).

The menu was the list of pages in the order they were made. An owner could not
reorder it, rename an item, link somewhere else, or group items. And on a phone
it wrapped onto as many lines as it took.

## Decisions

### d1. The menu is content, arranged by the owner

The same split as the rest of the header (ADR 0006 d1). The menu is a document
in the site's settings: it survives a change of theme. The theme styles the
panel a menu item opens, and nothing more.

It is not part of the theme builder, because a theme that carried a menu would
replace the owner's pages with someone else's.

### d2. Until it is arranged, the site makes it

A site starts with no menu document. Then the menu is what it was: the pages
that asked to be in it, in order, and the blog once it has a post. A new site
needs no setup.

"Arrange the menu myself" turns that list into a document the owner edits.
From then on a page's "show in the menu" switch has no effect, and the editor
says so. "Back to the automatic menu" discards the document.

### d3. An item points at a page by name, not by address

An item's target is a page, the blog, another address, or nothing (a heading
that only opens what is under it).

Pointing at a page by name gives two things. The item's label can be left
empty and follows the page's title. And an item whose page is not there is not
drawn: in the export that means a page not yet published; in the editor, one
that was deleted (the builder marks the item). The blog item appears when the
blog does. **A menu never leads to a page that is not there.**

### d4. Three levels, and the shape decides the kind of menu

Top items, the items under one, and the links under those.

- An item with nothing under it is a link.
- An item with items under it opens a small menu.
- An item whose sub-items have links of their own opens a **wide menu**: each
  sub-item is a column, its links the column's entries.

There is no "mega menu" switch to set. The owner builds the tree they mean and
gets the menu that fits it.

### d5. No script

A published page runs no script (ADR 0001 d9), and a menu is not a reason to
start.

- **An item that opens** is a `<details>`. The browser opens and closes it on a
  click, a tap, Enter or Space, and tells assistive technology which it is.
  The items share a `name`, so opening one closes the other.
- **A click elsewhere closes it.** While an item is open, its summary lays an
  unseen sheet over the page; a click anywhere lands on the summary. This is
  CSS, not script.
- **On a narrow screen** the menu folds behind a labelled checkbox drawn as a
  button, and an item opens in place instead of hanging over the page.

An item that both leads to a page and holds others cannot be both a link and a
switch. Its own page is the first link inside what it opens.

What this costs: Escape does not close an open item, and the phone's menu
button is announced as a checkbox. Both are named under "Not yet".

### d6. A heading is never wider than the screen

Found by the test that opens the exported site at a phone's width: a large
heading with one long word pushed the page sideways. Headings now shrink with
the screen and long words break. This is in the shared structure, so it holds
under every theme.

## Not yet

- **Escape to close, and a real button for the phone menu.** Both need a few
  lines of script. If the site ever ships one small script, these are its first
  job; until then the menu works without.
- **Dragging items** in the builder. They move with up and down, within their
  level.
- **Pictures or text in a wide menu's columns**, and an item that opens on
  hover.
- **A second menu** for the footer. The footer has its list of links.
- **Posts and categories as targets by name.** They can be linked by address.
- **The width at which the menu folds** is fixed at 48rem. CSS cannot read it
  from a theme token.

## Verification

`e2e/editor.cjs` builds a wide menu in the builder, then serves the exported
site to a browser **with scripts switched off**: it opens the panel with a
click, closes it with a click elsewhere, checks the wide panel spans the
header, then narrows the window to a phone's and checks the menu is folded, the
button unfolds it, an item opens in place, and nothing is wider than the
screen. `test/menu.test.ts` holds d2 to d4 and the markup of d5; the rule of d3
was removed once to see its tests fail.
