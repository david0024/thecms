# ADR 0003 — The editor works on the real page

- **Status:** Accepted 2026-11-16 (owner: "mergem pe ce propui tu")
- **Date:** 2026-11-16
- **Builds on:** ADR 0001 d6 (Svelte 5), d7 (content and style apart), ADR 0002
  d6 (the editor will show the real page).

## Decisions

### d1. The canvas is the page, drawn by the public renderer

The editor's middle pane is a frame holding the page as the server draws it for
visitors, with one difference: text that can be typed is marked (`data-edit`),
and a field that is still empty is drawn so there is somewhere to type. Those
marks come from the same components (`src/blocks/editing.ts`); on the public
site they are absent, and a test holds that.

*Why:* an editor with its own rendering shows an approximation, and every
difference between the two is a surprise after publishing. Here there is one
renderer, so there is nothing to keep in step.

### d2. The canvas never changes content; it reports

The script in the frame (`src/admin/frame.ts`) sends up what the author did:
selected a block, typed in a field, pressed a button on a block's bar. The
admin changes the document with the core's tree operations and asks the server
to draw it again. Text typed on the page is not redrawn, because the page
already shows it.

*Why:* one place changes the document, so undo, saving and validation each
have one path. (This is how MYCMS's editor works, and it held up there.)

### d3. Rich text typed on the page is read back as a document

A rich text area is editable in the browser, and what the browser holds
afterwards is read into our node types (`src/admin/richdom.ts`). Nothing of the
browser's markup is kept: a pasted `<span style>` or `<script>` contributes its
words only. The server cleans the result again when it is saved.

### d4. The style panel offers the theme first

For each property the choices are the theme's default, then the theme's tokens
by name, then "my own value". A free value is marked wherever it appears, a
block and a page each say how many they hold, and each has "reset to theme".
A value that is not valid is refused where it is typed and never applied.

### d5. The editing server is local, and still not open

`thecms edit site.db` listens on 127.0.0.1. Any web page open in the same
browser can send requests there, so every API call must carry a token printed
with the address, name this server as its host, and not come from another
origin. The token travels in the address's fragment, which browsers do not send
to servers or write to logs.

*Why now:* the brief's rule is that nothing escapes the rules and a bypass is a
bug. An unauthenticated local API is the bypass that would have been easiest
to leave "for later". Accounts and sign-in come with the hosted server; this
is what stands in for them until then.

### d6. The admin's words are data from the first commit

Every string is in `src/admin/messages.ts` (ADR 0001 d3). A language is another
object of that shape.

### d7. The admin is built by Bun when the editor starts

`Bun.build` with a small Svelte plugin compiles the admin and the canvas script
in memory at start-up; there is no separate build step and no extra build
tool. This is also the path to a single binary later.

## Not yet

Stated so nobody assumes otherwise:

- ~~Moving blocks is by buttons, rich text has no toolbar, images are given by
  address.~~ Done in ADR 0005.
- **A page's address is fixed when it is created.**
- ~~The theme can be chosen, not built.~~ Done in ADR 0004.

## Verification

`e2e/editor.cjs` drives the editor in a real browser from the first click to
the exported files, and checks each step by what it left behind: the typed
title and paragraphs are in the export as text, the block carries its token and
its free value and nothing else, a refused value never reached the page, and
nothing of the editor is in the export. CI runs it.
