# ADR 0019 — The contact form and the site's form service

- **Status:** Accepted (owner, 2026-11-19: "Server mic al nostru")
- **Date:** 2026-11-19
- **Builds on:** ADR 0001 d3 (EU rules are the default: no third party, forms record consent, data can be exported and erased) and d9 (only forms and search need a small backend).

A static site cannot receive what a visitor writes. Three ways were weighed: a
small service of our own, an outside form service the owner signs up to, or a
link that opens the visitor's mail program. The owner chose the first: it
keeps every message on the owner's side, with no third party, as ADR 0001 d3
asks, and the same small server is where accounts and managed hosting will
later live.

## Decisions

### d1. The form is plain HTML on the static page

A "Contact form" block: a name, an email address, the message, and a consent
box that must be ticked, with words the owner writes. It posts to the site's
form service. The service sends the visitor back to the same page at
`#f-<form>-sent` (or `-failed`), and the stylesheet shows the matching words
with `:target`. No script on the site, in the form or after it.

Without a form service set in the site's settings the form is not drawn on the
site, and the editor says so in its place.

### d2. A small service: `thecms forms <site>`

It opens the same database as the editor and answers one address, `/send`. It
keeps a message only when it comes from a form that is on a published page
(the form's id is looked up), from a page of this site (the browser's
`Origin`), with every field valid and the consent ticked. A robot that fills
the hidden field is told it worked and nothing is kept. One visitor may send
five messages in ten minutes.

With each message it keeps the consent words exactly as the page showed them,
so what the visitor agreed to can always be shown.

### d3. The owner is told by email, through their own mail server

`THECMS_SMTP=smtps://user:password@mail.example.com` and `THECMS_MAIL_TO`. The
service speaks SMTP itself (TLS from the start), so no library and no outside
sending service is needed. A plain `smtp://` server is refused unless it is on
the same machine, because the password would cross the network in the clear.
What a visitor typed never reaches a mail header unescaped. If the email
cannot be sent, the message is still kept and the failure is logged.

### d4. Kept for a time, readable, exportable, erasable

Messages are shown in the admin under "Messages", newest first, with the
address to answer. Each is deleted after the number of days set in the site's
settings (180 by default). When a visitor asks to see or erase what they sent,
the owner gives their address: everything sent from it is downloaded as a file,
or erased at once.

## Not done here

- Fields the owner chooses (a phone number, a subject, a file).
- A notice in the admin of unread messages.
- Running the form service inside the editor's process for one-machine setups.
