# ADR 0035 — Theme, layout, page, section, site: who decides what

- **Status:** Accepted (owner, 2026-11-20: "vreau să știm sigur care este limita, ce face fiecare… atât de simplu de folosit încât și un copil mic sau un bătrân să își poată face propriul site"; "să vină gata făcute cele implicite dar să existe constructor pentru fiecare"; the details left to the project)
- **Date:** 2026-11-20
- **Builds on:** ADR 0001 d7–d8 (content and style apart; a theme is data), ADR 0006 (the header and footer), ADR 0010 and 0015 (content types and their page), ADR 0033 (sections)

The owner asked for one thing above all: that it be certain where each part
stops. Someone who has never made a site should touch only pages, and still
get a good one. Someone who wants more should find a builder for each part,
each with ready-made defaults, and never wonder which one to open. WordPress
puts most of this in the theme. Here each part stands alone.

## Decisions

### d1. Five parts, each with one question

| Part | Answers | Holds | Never holds | Where it is made |
| --- | --- | --- | --- | --- |
| **Theme** | How does it look? | Colours, type, spacing, corners; each block type's look and variants; how the header and footer are arranged (ADR 0006 d2) | Any word, any picture, whether a page has a header | The theme builder |
| **Layout** | How is a page arranged? | Header yes or no, footer yes or no, how wide the content runs, a sidebar (none, left, right), and which section shows in the sidebar, above the blocks and below them | Any colour or size (the theme's), any word (the sections') | The layout builder |
| **Page** | What does it say? | Its address, title, description, blocks, translations, and the name of its layout | How anything looks, what the header says | The block editor |
| **Section** | What is said on many pages at once? | Blocks and their translations, written once (ADR 0033) | An address, a layout, a look | The block editor |
| **Site settings** | Who is this, and how is it found? | The name, logo, header button, footer words and links, the menu, the languages, the address | How they look (the theme's), where on a page they go (the layout's) | Menu and settings |

The test of a boundary: changing one part never changes another. A new
theme leaves every page, layout and word as it was. A new layout leaves the
words and the look. A changed footer text shows under every theme and in
every layout that has a footer.

The theme's own "layout" of ADR 0006 is the arrangement of the header's and
footer's insides (the name beside the menu, or above it). It is a look, and
stays in the theme. Whether a page has a header at all is the layout's.

### d2. A layout is a few closed choices

No grid to draw, no rules of which page gets what. Exactly these:

- header: yes or no;
- footer: yes or no;
- width of the content: narrow, normal, wide, full screen. A block's own
  width, set in the editor, still wins;
- sidebar: none, left, right. On a narrow screen it goes under the blocks;
- above the blocks, in the sidebar, below the blocks: a section, or nothing.

What shows in those places is a section, written in the block editor like
any other, translated by field, and drawn in the page's language. So a layout
holds no blocks of its own, and the block editor is the only place words are
written.

### d3. Ready-made, and each one changeable

A site starts with four: **Standard** (header, footer, normal width),
**Landing page** (no header, no footer, full screen), **With a sidebar**
(sidebar on the right) and **Article** (narrow). Until the owner changes one,
the site keeps none of them: they come from the program, in the admin's
language. Changing one, or making a new one, keeps the list with the site.
Standard is always there, and cannot be deleted: it is what every page falls
back to.

### d4. A page picks a layout; a content type gives one to its entries

A new page is made with a title and, beside it, a list of layouts, set to
Standard. The page's inspector changes it at any time. A translation is drawn
in its page's layout: the arrangement is structure, the same in every
language (ADR 0032).

A content type has a layout for its entries and its lists (ADR 0010), set in
the type's form. A page that names a layout the site no longer has is drawn
in Standard.

### d5. What is in use stays

A layout a page or a content type is drawn in is not deleted: the owner is
told which one, and gives it another layout first. A section a layout shows
is listed as shown there, and is not deleted while it is (ADR 0033 d4).

### d6. The export writes it out

A layout is drawn into the HTML of each page, its sections filled in like a
page's own section blocks: the exported site stays static, and a header that
a layout leaves out is not in the file at all. The pictures a layout's
sections show are exported with the site.

## For the beginner

A beginner opens Pages, makes a page, writes. Every other part has a ready
answer. The theme looks good as it is, Standard has a header and a footer,
and the site's name is the one given at the start. Nothing else needs to be
opened to have a site.

## Not yet

- **A sidebar for one page only.** The sidebar shows the layout's section. A
  page that wants another one uses another layout.
- **The link check of sections a layout shows.** It reads the exported files,
  so their links are checked with the pages that show them, but the report
  names the page, not the layout.
- **A layout for the lists of a content type apart from its entries.**
