# ADR 0050 — Search engines and sharing: complete SEO

- **Status:** Accepted (owner, 2026-11-21: "da", on the proposal of a folded panel per page, a picture for the whole site, noindex everywhere and breadcrumbs the owner may show or hide)
- **Date:** 2026-11-21
- **Builds on:** ADR 0037 d4 (stage 2: complete SEO), ADR 0030 (data for search engines), ADR 0029 (the site check), ADR 0032 (translation by field), ADR 0036 (redirects)

A WordPress site gets its SEO from a plugin, most often Yoast. thecms already
wrote a description, a canonical address, the Open Graph basics, a sitemap,
`robots.txt`, `hreflang` and schema.org data. What the plugin adds besides,
and what a site of any kind expects, is: a title for search engines other
than the page's own, a picture for link previews, a page kept out of search
engines, and breadcrumbs. These are added here, in words a beginner reads
without knowing the terms.

What Yoast is also known for, a score per page against a chosen keyword (the
red, amber and green light), is left out on purpose: its rules are
mechanical, search engines do not use them, and beginners bend their writing
to turn it green. The owner agreed.

## Decisions

### d1. A folded panel "Search and sharing" on each page and entry

Under the description, in the inspector of a page or an entry, a panel that
is closed until opened holds:

- **A title for search engines.** Empty: the page's own title, as before. When
  written, it is the whole title of the browser tab and of the result, and
  the title of a link preview; the site's name is not added to it. At most
  70 letters are kept.
- **A picture for sharing.** Picked like any picture. Empty: an entry's
  cover, then the site's picture (d2).
- **"Hide from search engines".** Ticked: d3.

The panel shows what a search result and a link preview would look like,
from the title, the description and the picture as they are now, so that
the owner sees the effect without knowing the words.

A section has no panel: it is never a page of its own. In a translation, the
panel holds only the title for search engines, written for that language; a
translation that has its own title and no title for search engines uses its
own title. The picture and the choice to hide are the main page's, in every
language, as its pictures are (ADR 0032).

### d2. A picture for the whole site

Site settings have a picture for sharing, used by every page that has none
of its own: the home page, a page, a list of entries. With a picture, a link
preview says `twitter:card` `summary_large_image`; without one, `summary`.

### d3. Hidden from search engines means hidden everywhere

A hidden page or entry says `<meta name="robots" content="noindex">`, is not
in the sitemap, and is not found by the site's own search. It stays public:
whoever has its address opens it, and the menu still shows it if it is in
the menu.

### d4. Breadcrumbs, made by the site, shown or hidden by the owner

An entry's breadcrumbs are made from where it is, never written: Home, its
type's list, its first category when its type has categories, then the entry.
A list of entries has Home, the type's list, and the category or tag.

They are always in the data for search engines, as a schema.org
`BreadcrumbList`, when the site has its address. They are shown on the page,
above the entry or the list, unless the owner turns them off in Site
settings ("Show the breadcrumbs"), which is on by default.

A page has none: pages have no parents, so its breadcrumbs would only say
"Home › Page", which helps neither a visitor nor a search engine, and would
stand above a page's first block, often a picture across the page.

### d5. The site check says what would hurt in search engines

The site check (ADR 0029) adds three warnings, said and not stopped: a title
longer than 60 letters (search engines cut it), two pages with the same title
(the later pages of a list are not counted), and a home page hidden from
search engines.

### d6. An imported WordPress site keeps its SEO

A WordPress export read by the importer gives each page and post the title
for search engines and the choice to hide that Yoast, Rank Math, All in One
SEO or SEOPress kept, as it already gave the description. A title written
as the plugin's formula (`%%title%%`) is the plugin's, not words, and is not
taken.

## What this does not change

- Everything here is written into the page's HTML, so a site exported to a
  static host keeps all of it.
- Redirects when an address changes stay as ADR 0036 made them.
