# ADR 0040 — Comments, with moderation

- **Status:** Accepted (owner, 2026-11-20: "mergem pe propunerile tale", on ADR 0037, which puts comments in the core, in stage 1)
- **Date:** 2026-11-20
- **Builds on:** ADR 0037 d4 (stage 1), ADR 0038 (the runtime), ADR 0019 (forms and consent), ADR 0010 (content types)

A WordPress blog takes comments, holds the first one from a stranger for the
owner, and shows it once approved. A thecms site could not: its pages are
static, and nothing took what a visitor wrote except the contact form.

## Decisions

### d1. A type takes comments, or does not

Comments are a choice of a content type, like its feed: "Visitors may comment
on entries". None takes them until the owner says so. Pages do not: a page is
what the owner says, not a conversation.

### d2. The form is plain HTML, sent to the site's form service

Under an entry of such a type the site draws the approved comments, oldest
first, then a form: name, email, the comment, and a consent the visitor ticks.
It posts to the same service as the contact form (ADR 0019), at `/comment`
(`/_/comment` through the runtime, ADR 0038), and comes back to the entry at
`#comment-sent` or `#comment-failed`, which the stylesheet shows. No script.

The service keeps a comment only on a published entry of a type that takes
comments, from this site's pages, within the same limit a visitor has for
messages, and never from the robot that fills the hidden field. A comment is
at most 3000 characters.

Without a form service there is nowhere to send, so no form is drawn; what
was approved is still shown.

### d3. The owner approves what is shown

A new comment waits. The owner is told by email, when the site sends email,
and finds it in the admin under Comments, those waiting first: approve, or
delete. Editors moderate too; it is content work.

One from an address that already has an approved comment is shown at once,
as WordPress does by default: someone the owner let speak is not held again.

What is approved reaches the site with the next export, and within five
seconds on the runtime.

### d4. The address is never shown, and the visitor's rights cover comments

The site shows a comment's name, day and words. Its email is kept to answer
the writer and is shown only in the admin. The consent the visitor ticked is
kept with it, in the site's language.

Asked by a visitor, the owner downloads everything one address sent, messages
and comments in one file, or erases it all at once. A comment nobody approved
is forgotten when messages are (ADR 0019). An entry that is deleted takes its
comments with it.

## Not yet

- **Replies to a comment**, and the owner answering under it.
- **Telling the writer** when their comment is approved.
- **A filter for spam** beyond the hidden field, the limit per visitor and
  moderation: a list of words, or a service, as an extension (ADR 0037 d3).
- **Comments in other languages** of an entry: entries are in the main language
  (ADR 0024), and so are their comments.
