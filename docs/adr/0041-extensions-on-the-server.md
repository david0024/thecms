# ADR 0041 — Extensions on the server: routes, jobs and events

- **Status:** Accepted (owner, 2026-11-20: "mergem pe propunerile tale", on ADR 0037, whose d3 sets this and whose stage 1 names it)
- **Date:** 2026-11-20
- **Builds on:** ADR 0026 (extensions), ADR 0037 d3, ADR 0038 (the runtime), ADR 0039 (the site's clock)

An extension of ADR 0026 could only act when someone in the editor asked it
to. A payment provider confirms a payment by calling an address; stock is
synced every quarter of an hour; a comment may need checking the moment it
arrives. None of these has a person in the editor.

## Decisions

### d1. The format `thecms.extension/2`

A package in the second format may declare, besides what the first holds:

- **routes**: `{ "path": "stripe/confirm", "action": "confirm", "methods": ["POST"] }`.
  The path is up to four lower case words joined by `/`; the methods are GET
  and POST, POST when none is said.
- **jobs**: `{ "action": "sync", "everyMinutes": 15 }`, from 1 minute to a week.
- **events**: `{ "on": "comment.created", "action": "check" }`, one of
  `page.published`, `entry.published`, `comment.created`, `comment.approved`
  and `message.received`.

Each names one of its actions, and one the editor does not offer on a block or
a page: what it is given is not a page. The first format is still read; a
package in it has none of these. Packages are written in the second.

The owner is shown, before installing, each address it answers at, each job
and how often, and what it is told.

### d2. A route is answered by the runtime

`/_/x/<extension>/<path>` on the site's runtime (ADR 0038). The action is
given the method, the query, the headers except the session cookie and the
editor's key, and the body as text, at most 64 KB. It answers with a text,
or `{ status, headers, body }`; of the headers, only `content-type`,
`location` and `cache-control` are kept, and a body that is not text is sent
as JSON. An extension that is off, or a path it did not declare, is a 404.
An action that fails is a 502, and the runtime's log says why.

### d3. A job is done by the site's clock

At each look (ADR 0039), the clock does the jobs that are due. A job is
claimed in the database before it runs, so two clocks on one database run it
once. One that fails is said in the log and tried again at its next time.
The first run is at the first look after the extension is installed.

### d4. An event is told to the extensions that listen

The process that made the change tells them, once: the editor, the runtime or
the form service. The action is given `{ event, ...what happened }`: the
page's or entry's address and title, or the comment's or message's name and
words. Never a visitor's address. A listener that fails is said in the log;
what happened has happened.

### d5. The isolation is the same

Every one of these runs the extension's action in its process of its own
(ADR 0026 d4), with what it declared and nothing else. On a server that is a
process under a user of its own, with no network but its declared hosts.

## Not yet

- **Waiting on an extension's answer** before the change is made (an event
  that can refuse a comment, a filter on a page's words). Events are told
  after; a hook that decides comes with the shop's needs (stage 2).
- **Workers.** Each extension as a Worker bound to the runtime comes with
  stage 3 (ADR 0037 d4).
- **More events**: an order paid, a member signed up, as the shop and the
  accounts arrive.
