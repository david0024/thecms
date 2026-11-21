# ADR 0049 — Forms, built on a screen of their own

- **Status:** Accepted (owner, 2026-11-21: "Ecran separat Formulare", on the proposal of the fields, the messages and the protection against robots)
- **Date:** 2026-11-21
- **Builds on:** ADR 0019 (the contact form and the form service), ADR 0037 d4 (stage 2: a form builder), ADR 0032 (translation by field), ADR 0033 (sections: written once, shown by a block)
- **Changes:** ADR 0019 d1 (the form's fields were fixed: a name, an address, the message)

A WordPress site gets its forms from a plugin: a quote request, a booking
enquiry, a sign-up for a course. thecms had one form, the contact form, with
three fixed fields. Two ways were weighed: a form written in the page, field
by field, as a block; or forms built on a screen of their own and placed in
pages by a block. The owner chose the second. A form is then written once and
shown on as many pages as need it, its messages are found by its name, and
the page builder stays as simple as it was.

## Decisions

### d1. A form is kept by the site, under "Forms"

The admin has a screen "Forms". A form has a name (`contact`, `quote`), a
title the admin shows, its fields in order, the consent the visitor ticks,
the button's words, and what the page says when it was sent and when it was
not. A form is used as soon as it is saved: like the site's settings, it has
no draft. A site exported as files shows the change with its next export.

A new form starts from one that is ready: **Contact** (a name, an address,
the message), or an empty one. A site always starts with Contact; the
contact form a site already had becomes it, with the words its owner wrote.

A form a page shows is not deleted; the reason says where it is shown.
Forms are the owner's to change, as messages are; an editor places them.

### d2. The fields

Each field has a label, is required or not, and is one of: a short text, a
long text, an e-mail address, a phone number, a number, a date, a list to
choose one from, choices of which one is ticked (radio), or boxes of which
any are ticked. The last three have their options, one per line. A form has
at most 30 fields; a list at most 30 options.

The consent is not a field the owner may leave out: every form has it, it
must be ticked, and its words are kept with each message exactly as the
page showed them (ADR 0001 d3, ADR 0019 d2).

### d3. A page shows a form with the "Form" block

The block names one form, and may add a title and a few words above it. The
form is drawn as plain HTML, posted to the site's own server or to the form
service, and comes back to the page with `#…-sent` or `#…-failed`, as in
ADR 0019. No script.

The form's words are translated on its screen, language by language, as a
page's are by field (ADR 0032): the labels, the options, the consent, the
button and the two notes. A word not translated shows the main language's.
A choice is sent as its main-language words, so the messages of every
language read alike.

### d4. The server checks each field as the form says

Only a form on a published page is answered. Each field is checked by its
kind: a required one is filled, an address is an address, a date is a date, a
choice is one of the options. A message failing any of it is not kept.

What a robot sends is caught as before: the hidden field a person never
fills, and five messages from one visitor in ten minutes. No captcha: it
would ask every visitor to prove themselves, and most captchas send the
visitor to a third party.

### d5. Messages, by form

Each message keeps what the visitor sent field by field, with each field's
label as it was then, so a form changed later does not change what was
sent. The "Messages" screen shows them by form, newest first; a form's
messages are downloaded as a CSV file, one column per field, for a
spreadsheet. The owner is told of each by e-mail, as before, with every
field written out and the visitor's address to answer when the form asks
for one.

The rest of ADR 0019 d4 stays: messages are deleted after the days the site
keeps them, and a visitor's request to see or erase what they sent covers
every form.

## Not yet

- **Files** sent with a form, and **forms in several steps**.
- **Where a message goes** by form (another address than the owner's), and
  an answer sent to the visitor.
- **Conditions** (a field shown only when another is ticked).
