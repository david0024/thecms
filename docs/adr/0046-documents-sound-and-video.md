# ADR 0046 — Documents, sound and video in the media library

- **Status:** Accepted (stage 1 of ADR 0037 d4, "PDFs and documents in the media library", which the owner accepted with the plan)
- **Date:** 2026-11-21
- **Builds on:** ADR 0005 (images stored with the site), ADR 0029 (the check before publishing), ADR 0044 (the site is served)

The library held images only. A WordPress site keeps a menu as a PDF, a price
list as a spreadsheet, a podcast episode, a short film, and links to them from
its pages. The blocks that play sound and video and list files (the next
record) need them in the library first.

## Decisions

### d1. What it takes, read from the bytes

As with images, a file is what its bytes say, never its name or what the
browser claims:

- **documents:** PDF; Word, Excel and PowerPoint (`docx`, `xlsx`, `pptx`);
  OpenDocument (`odt`, `ods`, `odp`); a ZIP archive of anything else;
- **sound:** MP3, M4A, OGG, WAV;
- **video:** MP4 and WebM, the two every browser plays.

Nothing that a browser would run as the site's own page is taken: no HTML,
no SVG, no plain text (which a browser may read as a page), no program. An
office file is a ZIP, told apart by the names of its first entries.

### d2. Served as what it is

- A document is offered under the name it was uploaded with
  (`Content-Disposition`), cleaned of anything that would end the header.
- A PDF opens in the browser; every other document is downloaded.
- The browser's own PDF reader does not open under the site's strict content
  policy, so a PDF is served without it. A PDF is drawn by that reader, never
  as one of the site's pages.
- Sound and video are served in the parts a player asks for (`Range`), so a
  visitor can start in the middle and Safari plays them at all.

### d3. How heavy

The files live in the site's database, like images. Each kind has its limit:
an image 10 MB (as before), a document 25 MB, sound 50 MB, a video 100 MB. A
longer film belongs on a video service; the video block (next record) shows
it from there with a link. The admin says this beside the upload button.

### d4. A page needs the files it links to

A link to `/media/<file>`, in a link field (a button) or in rich text, counts
as a use, as a picture does:

- the export carries the file, and a published page linking to a file the
  site no longer has stops it, naming the page;
- a file a page links to cannot be deleted, and the admin says where it is
  used.

### d5. The served site does not load them to build itself

The site builds its pages into memory when something is published (ADR 0044).
Documents, sound and video are only checked to be there then; the runtime
reads each from the library when a visitor asks for it. A file nothing
published uses is not served by the site.

### d6. In the admin

**Media** (it was "Images" in Romanian) uploads any of them, shows each kind
as itself (a picture, a player, or the file's kind in letters), and filters by
kind once there is more than one. An image field still offers only images.
The WordPress import still brings images only.

## Not done here

- The blocks that use them (video, sound, a list of files): the next record.
- Smaller copies or a poster frame of a video, made in the browser.
- Storing large files outside the database (a folder, an object store).
