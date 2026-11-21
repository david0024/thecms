# ADR 0047 — Buttons, tables, players, video, sound and documents

- **Status:** Accepted (stage 1 of ADR 0037 d4, "blocks for embeds, tables, buttons, video, audio and files", which the owner accepted with the plan)
- **Date:** 2026-11-21
- **Builds on:** ADR 0001 d7 (one list of block types), ADR 0017 (blocks as lists of plain items), ADR 0032 (translation by field), ADR 0046 (documents, sound and video in the library)

These are the blocks WordPress has without a plugin that thecms still lacked.
With them, stage 1 of ADR 0037 is complete.

## Decisions

### d1. Six new types

- **Buttons:** up to six, in a row. The first stands out, the others are
  quieter (the hero's two kinds of button). A button with no address yet
  shows in the editor and is left out of the site.
- **Table:** a title, the table, a caption. Up to 60 rows and 8 columns,
  plain text in every cell (500 characters), and a choice whether the first
  row holds the headings. On a phone it scrolls sideways inside itself, never
  the page. Each cell is typed on the page or in the panel, where rows and
  columns are added and taken away.
- **From another site** (embed): the address of a video, a song or a map,
  pasted as the author sees it in their browser, with a title for readers who
  cannot see the player and a caption.
- **Video:** a video from the library, played by the browser, with a picture
  shown before it plays; or the address of a YouTube or Vimeo video, played by
  that service.
- **Sound:** a file from the library, played by the browser; or a Spotify or
  SoundCloud address.
- **Documents:** up to 30, each a file from the library (or any address) with
  the words of its link and a line about it. Its kind (PDF, DOCX) is shown
  beside it.

### d2. A player is made from a known address, never from pasted HTML

No block takes HTML, so an embed is not the `<iframe>` code a service offers.
The author pastes the page's address; the program recognises it and makes the
player's address itself:

- YouTube (`watch`, `youtu.be`, `shorts`, with a start time), played from
  `youtube-nocookie.com`, which sets no cookie until the video is played;
- Vimeo (an unlisted video's key kept), with `dnt=1`;
- Spotify (a track, album, playlist, episode, show or artist);
- SoundCloud (a track or a set);
- Google Maps (the address in "Share → Embed a map");
- OpenStreetMap (the address in "Share → HTML").

Anything else draws nothing on the site and a hint in the editor naming the
services. Each part of an address is checked against what that service's
addresses look like, so nothing slips through into the player's address.

### d3. The frame may run the service's script and nothing of the site's

The player is an `iframe` with `sandbox` (scripts, its own origin, popups,
presentation), `loading="lazy"`, and `referrerpolicy` as the site's. The
site's content policy names these six services in `frame-src`, and allows
sound and video from the site itself (`media-src 'self'`). The editor's policy
names them too, so the canvas shows the player.

### d4. A file field

Video, sound and documents are a new kind of field, `file`, which takes:

- from the library, only a file of its kind (a document field refuses a
  video);
- for sound and video, a known service's address of that kind (a Spotify
  link is not a video);
- for a document, any address a link may lead to.

The panel uploads one, picks one already uploaded, or takes an address. A
document's link starts with the name it was uploaded under, which the author
changes. A page needs the files its blocks play or list: they are exported
with it and cannot be deleted while it uses them (ADR 0046 d4).

### d5. In every language

The words of a document's link, and each cell of a table, are translated like
any other words (ADR 0032): the table keeps its shape in every language.
Addresses are the same in every language. Search reads the words of tables
and of document links.

## Not done here

- Captions for a video (a `.vtt` file in the library).
- A gallery of videos, or a playlist of sounds.
- Merged cells, or formatting inside a cell.
- A video's poster made from the video itself.
- Asking the visitor before a service's player loads (a consent banner): the
  player loads lazily and YouTube's is cookie-free until played.
