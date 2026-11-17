# ADR 0009 — Importing a WordPress site

- **Status:** Accepted
- **Date:** 2026-11-17
- **Builds on:** ADR 0001 (blocks as data, no stored HTML), ADR 0005 (images
  are kept with the site), ADR 0007 (the blog), ADR 0008 (the menu).

The product is for people who have a WordPress site. Until they can bring it
with them, everything else is a demo.

## Decisions

### d1. The source is the export file, not the database or the live site

WordPress writes its content to one XML file (Tools, Export, All content).
Every owner can make that file, on any host, with no plugin and no password
given to anyone. Reading the database would need access most owners do not
have; reading the live pages would import the theme's markup along with the
words.

The file is read by a small XML reader written for it (`src/import/xml.ts`).
It does not resolve entities the file declares, which is how an XML file is
made to read other files.

### d2. A plan first, then the work

`planImport` reads the file and returns everything the site would get: pages,
posts, menu, settings, the images to fetch, the old addresses to keep, and
notes. It touches no database and no network, so it can be tested whole, and a
file that is not an export creates nothing. `runImport` carries the plan out.

### d3. Meaning comes over; appearance does not

Content is HTML. It is read into a tree and converted to blocks: paragraphs,
headings, quotes, lists, links, bold, italic, code, images with captions.
Classes, inline styles, fonts, colours and column layouts are left behind,
because here they belong to the theme (ADR 0001). The imported site looks like
its new theme from the first minute, not like a damaged copy of the old one.

No HTML is stored (ADR 0001 d3), so there is nothing to sanitise: the
converter keeps text and a short list of meanings, and the site's own cleaning
checks every address as it does for anything typed in the editor.

A page gets a block with its title at the top, because WordPress has the theme
print the title and here a page says its own.

### d4. What cannot come over is said, not hidden

Forms, scripts, embedded players, shortcodes, blocks WordPress fills in by
itself (latest posts, a search box), comments, tags, private pages, custom
post types: each is counted and named in the report, with the pages it was
on. A table keeps its text, one line a row. An embedded video keeps a link.

A quiet import that drops a contact form is worse than a loud one.

### d5. Images are copied; other files are not

Each image the content shows that lived on the old site is fetched and stored
like an uploaded image (ADR 0005): named by its contents, checked by its
bytes. Where the content showed a resized copy (`photo-300x200.jpg`) the
picture it was made from is fetched instead.

Only addresses on the old site, or listed in the file as its attachments, are
fetched. An image on someone else's site stays there. An image that cannot be
fetched keeps its old address and is listed. `--no-images` skips copying.

PDFs and other downloads are not copied, because the site stores only images
today. Links to them keep pointing at the old site, and the report says so.

### d6. Links inside the old site lead to the new addresses

Every page and post is known by its old address and its number (`?p=12`), so
a link written either way, with or without `www.`, `http` or `https`, is
rewritten to the new path.

### d7. Old addresses keep working, as files

Posts move from `/2024/01/hello/` to `/blog/hello/`, and pages that sat under
other pages move to the top level. Search engines and other sites still point
at the old addresses.

The site keeps a list of old addresses (`redirects`). The export writes a
small page at each one that sends the visitor on (`meta refresh`, with a
canonical link and `noindex`). It works on any static host with no
configuration, which is the promise of the export (ADR 0001 d9). An old
address never replaces a real page, and one that leads to something
unpublished is not written.

### d8. The menu comes over

Classic menus (`nav_menu_item`) and block-theme menus (`wp_navigation`) are
both read into the menu document (ADR 0008). Where the old site had several,
the largest is taken. The empty page WordPress uses to list posts becomes the
blog item.

### d9. An import replaces nothing

Into a new file, the site takes the old name, language, address and menu.
Into an existing site, settings are left alone and a page or post whose
address is taken is skipped and named. Running an import twice changes
nothing the second time.

## Dropped, and why

- **Authors, comments, tags.** The site has none of them yet.
- **Featured images on pages, sticky posts, post formats.** No place to put
  them.
- **Front page shows latest posts.** There is no latest-posts block yet; such
  a site gets a simple home page that links to the blog.

## Known gaps

- Import runs from the command line only; the editor has no upload for it.
- Large JPEGs are stored as they are; the editor's shrinking (ADR 0005) runs
  in a browser.
- Old addresses with non-Latin letters or a query (`?p=12`) get no redirect.
- Elementor, Divi and other page builders store layouts the export shows as
  shortcodes or nothing; their text is recovered where it is in the content.
- Checked against a hand-made fixture and the public WordPress theme unit
  test file. Fetching images was checked against a local server only.
