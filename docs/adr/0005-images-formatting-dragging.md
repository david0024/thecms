# ADR 0005 — Images, formatting and dragging

- **Status:** Accepted. d8 added 2026-11-20 (owner: "da", to: the browser makes 3–4 widths at upload, no image library, so the program stays one file; the export writes srcset and sizes that follow the layout and the block's width; the pictures already stored are redone once, in the browser)
- **Date:** 2026-11-16
- **Builds on:** ADR 0001 d7 (content is data, never markup), d9 (a site is one
  file), ADR 0003 (the editor works on the real page).

The three things ADR 0003 listed as missing for an author who is not technical:
putting a picture on a page without knowing an address, making a heading or a
list without knowing a shortcut, and moving a block by taking hold of it.

## Decisions

### d1. Images live in the site's file

An uploaded image is a row in the site's SQLite file, beside the pages that
show it. Copying that one file is still the whole backup (ADR 0001 d9); there
is no uploads folder to forget.

An image is named by the hash of its bytes: `/media/<hash>.<format>`. So the
same picture uploaded twice is stored once, a name never comes to mean another
picture, and a page that points at a stored image cannot be made to point at
anything else by guessing a path.

### d2. A file is what its bytes say

The server reads the first bytes and takes PNG, JPEG, GIF, WebP and AVIF, up to
10 MB. The file's name and the type the browser claims are not consulted.

**SVG is refused.** An SVG is a document that can carry script, and a stored
image is served from the site's own address. Drawing one safely needs a
sanitiser, which is a decision of its own.

### d3. A photograph is made fit for the web before it leaves the browser

A phone's photo is several megabytes, several thousand pixels wide, and often
carries where it was taken. The admin draws a JPEG again before uploading it:
at most 2400 pixels on its long edge, as WebP, with nothing of the original's
metadata. PNG and WebP are drawn again only when they are larger than that.
GIF and AVIF are sent as they are, because drawing an animation again would
keep its first frame only.

This runs in the browser because the server has no image library, and adding a
native one would break "one binary, runs anywhere". It is a convenience, not a
guarantee: a file sent straight to the API is stored as it came.

### d4. An image in use cannot be deleted

Deleting an image that a page shows, in its draft or in what is published, is
refused, and the answer names the pages. An export that meets a published page
pointing at an image the site does not have stops and says which page, rather
than publishing a broken picture.

The export carries only the images published pages show. An image used only in
a draft, or in none, stays in the file and out of the public folder.

The words that describe a picture (`alt`) are kept with the block that shows
it, not with the file: the same picture is described differently in different
places.

### d5. The formatting bar uses the browser, and trusts none of it

While the caret is in a rich text area, a bar offers paragraph, two heading
levels, quote, bulleted and numbered list, bold, italic and link. The browser
carries out each command on its own markup. Then the area is read back as a
document (`domToRichText`, which keeps only the node types and marks we have)
and **drawn again from that document**.

So after every command the page shows exactly what was stored. A link to
`javascript:` is made by the browser, dropped by the document, and gone from
the screen in the same moment. Whatever markup one browser produces and another
does not, the author never keeps it.

One exception: while the caret is in an empty paragraph, the browser's markup
is left alone, because an empty paragraph is not in the document and drawing
again would take the line away from under the caret.

### d6. A block is dragged by a handle; the page only says where it fell

The selected block's bar has a handle. Dragging the whole block would fight
with selecting text inside it, which is the more common thing to do with a
mouse on a page of text.

The canvas works out a place — which container, at which position among the
blocks already there — and reports it. The admin moves the block in the
document with the core's `moveTo`, by id (ADR 0002). The middle of a group is
inside it; a strip along its top and bottom edge is beside it.

A new block can be dragged from the list in the admin onto the page the same
way.

### d7. A move that would lose content is refused

Blocks nest four deep. Cleaning on save drops what lies deeper, so a group
dragged too deep would silently lose what it holds. `moveTo` refuses such a
move, the editor says why, and the same check now guards adding a block into a
group (which had this fault before).

### d8. Each picture at the size that fits

A phone was sent the same 2400-pixel picture as a wide screen. Now:

- **The server knows how large a picture is.** It reads the width and height
  from the bytes (PNG, JPEG, GIF, WebP, AVIF), as it reads the format (d2),
  and keeps them beside the picture. A picture stored before this has its
  size read the first time the site lists its images.
- **The browser makes the smaller copies**, as it makes the photo lighter
  (d3), for the same reason: the server has no image library, and the
  program stays one file. When a picture is uploaded, the admin draws it
  again 480, 960 and 1600 pixels wide (the ones narrower than the picture)
  as WebP, or as JPEG in a browser that cannot write WebP, and sends each
  one. The server reads each copy's bytes and keeps it only when it is a
  WebP or a JPEG, at one of those widths, in the picture's proportions.
  A copy is named after its picture: `/media/<hash>-<width>.<format>`.
- **The pictures already stored are redone once**, the first time the media
  screen opens, with the count shown while it runs. A copy that could not be
  made leaves a button there to try again. GIF and AVIF keep one size, for
  the reason in d3.
- **The export offers them.** Each picture on a page gets `width` and
  `height`, so the page does not jump while it loads, and, when it has
  copies, a `srcset` that names them and the picture itself, and a `sizes`
  that follows where it is drawn: the width the layout gives the content
  (ADR 0035), or the block's own width when it sets one; half of it for the
  picture beside a hero's words; a card's width in a gallery and in a list of
  entries; a small one for a testimonial's photo. The copies are exported
  beside the picture. The editor shows the picture itself, as before.

## Not yet

- **Sizes of a picture in a sidebar** follow the content's width, not the
  sidebar's: a browser picks a copy larger than it needs there, never a
  smaller one.
- **The logo** keeps one size; it is drawn small.
- **Dropping a file onto the page** to upload it; upload is from the panel.
- **SVG**, and replacing an image everywhere it is used.
- **Location data is removed only by the admin** (d3), not by the server.
- **Formatting is tested in Chromium only.** d5 is what makes other browsers
  safe; it does not make them tested.
- **Dragging on a touch screen**: the browser's drag does not start from a
  finger. The up and down buttons remain.
- A link's address is typed; there is no list of the site's pages to pick from.

## Verification

`e2e/editor.cjs` formats text with the bar, uploads a photograph and a file
that only claims to be an image, drags blocks into, within and out of a group,
and checks each by the stored document and then by the exported files.
`test/image-sizes.test.ts` reads the size of each format, refuses copies
that are not what they claim, and finds the srcset and sizes in the export,
in a narrow layout and for a block with its own width; `e2e/editor.cjs`
checks that an uploaded photo gets its three copies from the browser, that
the media screen makes those a picture lacks, and that the export carries them.
`test/media.test.ts` holds the rules of d2, d4 and d7 without a browser; the
depth check and the export's image check were each removed once to see their
tests fail.
