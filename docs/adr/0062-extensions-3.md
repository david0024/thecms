# ADR 0062 — Extensions 3: what the program tells, asks and lends an extension

- **Status:** Accepted (owner, 2026-11-22: chose "Cum propui (toate trei)": the general mechanisms now and the order's in their step, page visits told in batches, the statistics installed with one button)
- **Date:** 2026-11-22
- **Builds on:** ADR 0060 (stage 3; d5 and d6 step 1), ADR 0026 (extensions), ADR 0031 (screens as data), ADR 0041 (extensions on the server), ADR 0049 (forms), ADR 0053 (statistics)

ADR 0060 d5 lists what the extension format must gain before the extensions
of stage 3. This record is its first step: the mechanisms, each shown on
something that exists today. The parts that need orders, visitor accounts or
Workers are added with the step that brings them (d9).

## Decisions

### d1. The format `thecms.extension/3`

Everything `thecms.extension/2` holds, and `answers`, `uses`, `blocks`, the
events of d2, the `date` and `datetime` field kinds and the views of d7. The
first and second formats are still read; a package in them has none of these.

The owner is shown, before installing, each new thing it asks for: the
questions it answers, the program's data it reads, the blocks it adds.

### d2. Page visits and searches, told in batches

Two events join those of ADR 0041: `page.served` and `search.made`. A visit
does not wake an extension. Each of the site's processes gathers them and
tells them every five seconds, as one event with a list:

- `page.served`: `{ items: [{ day, path, source, device, first }] }`;
- `search.made`: `{ items: [{ day, words }] }`.

`day` is the day in the statistics' time zone, `source` and `device` are as
ADR 0053 d1 reads them, and `first` says that it is the visitor's first page
that day. The program tells them apart with the fingerprint of ADR 0053 d2,
under its key of the day, and keeps both. An extension is never given the
visitor's address, the browser's name or the fingerprint. Robots, pages
loaded ahead and people signed in are not told.

A batch holds at most a thousand items; more are told in more batches. If a
listener has not taken the last batch when the next is ready, the next waits
for it, up to ten thousand items, and what is beyond that is dropped and said
in the log. While no extension that is on listens, the program does none of
this work: no fingerprint, no key of the day, no list.

### d3. Questions the program asks and waits for

An extension may answer a question the program asks:

```json
"answers": [{ "question": "comment.check", "action": "check" }]
```

The program waits for its action at most ten seconds. An answer it does not
understand, an action that fails or does not answer in time, is said in the
log, and the program does what it does without that extension.

The first question is **`comment.check`**, asked before a comment is kept. The
action is given the comment's name, words, language and the entry's address
and title, never the writer's e-mail or address, and answers `hold`, `approve`
or `spam`:

- `hold` is what happens today: the comment waits for the owner.
- `approve` publishes it at once, as a comment from a known writer is now.
- `spam` keeps it apart, under Spam in the Comments screen, from where the
  owner can approve it; it is deleted with the old messages.

Several extensions answering: the strictest wins, `spam`, then `hold`, then
`approve`. The questions of payment, delivery and invoice come with the shop.

### d4. The program's data an extension reads

An extension may read some of the program's data, declared:

```json
"uses": ["published"]
```

and each action that reads it says so (`"uses": ["published"]`), as with its
collections. The first is **`published`**: the published pages and entries,
each with its address, title, description, language, type and date, newest
first. Nothing behind a password, nothing in draft, no comment, no message.
Orders, member levels and e-mail to visitors come with their steps.

### d5. A number added to, not written over

`host.add(collection, id, { field: number })` adds to the number fields of a
row, making it when it does not exist, in one step on the database. Two of the
site's processes counting at once lose nothing. It is what the statistics
need, and what stock will need.

### d6. Blocks on the public site, as data

An extension may add blocks the author places on a page, each a form:

```json
"blocks": [{ "name": "signup", "label": "Newsletter sign-up",
  "fields": [{ "key": "email", "label": "E-mail", "kind": "email", "required": true }],
  "submit": "Sign up", "route": "signup" }]
```

The fields are of the kinds of the form builder (ADR 0049): a text, a long
text, an e-mail address, a phone number, a number, a date, a choice and a
consent. The site draws the block as it draws its own forms, with the theme,
with no script, and posts it to the extension's route. The route names one of
its routes that takes POST.

A route may answer with a page: `{ page: { title, blocks } }`. The site draws
it in its layout, header and footer, in the visitor's language, with the
blocks cleaned as any block is, and does not keep it.

### d7. Two kinds of screen

`thecms.view/1` gains two kinds, drawn by the admin:

- **`report`**: numbers, a chart and lists, from what an action answers. The
  view names the action and the ranges it offers (`today`, `7`, `30`, `365`).
  The action is given the range and the time zone, and answers
  `{ totals: [{ label, value }], chart: { labels, series: [{ label, values }] }, lists: [{ title, rows: [{ label, value }] }] }`.
- **`calendar`**: the rows of a collection by month, on a `date` or `datetime`
  field, each named by another field and opening the collection's form.

### d8. The statistics become an extension

`extensions/stats` holds what `src/site/stats.ts` counted and showed: it
listens to `page.served` and `search.made`, keeps each day's totals in its
collection with `host.add`, and shows them in a `report` screen. The program
keeps only what tells a visit: who is counted, the source, the device, the
day and the fingerprint of d2.

The program carries the packed file. On a site without it, the Statistics
screen says that they are an extension now, with one button that shows what
it asks for and installs it, as any extension is accepted (ADR 0026 d3).
Installing it moves the old totals from the `visits` table into its
collection, and the table is then dropped. Until it is installed, nothing is
counted.

### d9. With the step that needs it

From ADR 0060 d5, these come with their steps: the order's, the account's and
the subscription's events, the questions of payment, delivery and invoice, the
access to orders, member levels and e-mail to visitors (the shop and
accounts); the signed-in visitor on a route (accounts); each extension as a
Worker (the runtime on Workers).

## How it is built

One pull request for each: d2 with d5; d3 with d4; d6; d7 with the `date`
kinds; d8. The format's version and the packer follow the first.
