# ADR 0031 — An extension's screens are data: `thecms.view/1`

- **Status:** Accepted (owner, 2026-11-20: "exact așa vreau să implementăm", on describing extension screens as semantic JSON on the Zveltio model, with no SDK and no other renderer for now)
- **Date:** 2026-11-20
- **Builds on:** ADR 0026 (extensions), ADR 0027 (the AI extension)
- **Replaces:** the `views` of ADR 0026 d2 (a collection as a list with a form)
- **Follows:** Zveltio's `zveltio.view/2`, its ADR 0042 and its `docs/extensions/ui-model.md`

ADR 0026 gave an extension one kind of screen: a collection as a table, with
a form to add and change its rows. That was enough for settings, and not for
anything an extension does with its rows: a key made and shown once, a log
that is read and never written by hand, a button on a row that only some rows
have. The way to add these is not to let an extension ship its own screens in
code, which would run its code in the owner's browser, and would tie every
extension to this admin's framework. It is to say what a screen shows and
does, as data, and let each front end draw it.

## Decisions

### d1. A screen is a `thecms.view/1` document

An extension's `views` is a list of documents, each starting with
`"spec": "thecms.view/1"`, an `id` (`ai.providers`) and a `title`. A view is
one of three kinds:

- **list**: rows of a collection, as a table. It names the fields shown (a
  field may be a badge, with a tone for each value), a filter, a sort, whether
  the collection's own form adds, changes and removes rows, buttons for each
  row and buttons for the whole list.
- **form**: either the collection's one row (`"singleton": true`, for
  settings), or an action's questions with a button that runs it.
- **tabs**: two or more views with titles, one shown at a time.

A button either runs one of the extension's actions, with an `input` read from
the row (`{"$record": "id"}`) or the date (`{"$today": true}`), questions to
ask first (`prompt`, from what the action asks), a confirmation and a tone;
or opens another view by its id (`navigate`). A row button may have a `when`:
conditions on the row (`eq`, `neq`, `lt`, `lte`, `gt`, `gte`, `in`, `not_in`,
`null`, `not_null`).

An action's answer may ask something of the screen: `{"reveal": text}` is
shown once, for a key that is never shown again; `{"view": id}` opens that
view. Anything else is taken as done.

### d2. Semantic and closed

A view names collections, fields and actions the extension declares, and
nothing else: no address, HTTP verb, CSS class, icon or expression. Every
object is closed: a key the vocabulary does not have is refused, not ignored,
so `"url"` or `"class"` cannot creep in as something a front end might honour.

### d3. Checked where the extension is read

`src/view/` checks a list of views against the vocabulary and against the
collections and actions the extension declares: each field, each action, each
question, each `navigate` target, each id once. It is called where an
extension is read (`parseExtension`), so the packer refuses a screen that is
wrong before the file exists, and installing refuses it again. Every problem
is said with where it is (`views[0].rowActions[1]: "rotate" asks nothing
called "other"`).

An action the editor runs (on a block or a page) is not run from a screen.

### d4. A separate module, under MIT

`src/view/` is the format's types, its checker and what every front end does
the same way (which fields, which rows in what order, which buttons for a
row, what a button sends, what an answer asks). It imports nothing from the
program, and is MIT, unlike the rest of thecms, so that a tool that writes
views or another front end can take it as it is. Within `thecms.view/1`,
additions are new optional keys or kinds; removing or narrowing anything is
`thecms.view/2`.

### d5. The Svelte admin is the only front end

The admin draws every view (`ViewPart.svelte`). There is no SDK and no React
or Vue renderer; one is written when someone needs it, from the same module.

### d6. An extension works without a screen

Everything a screen does goes through the program: rows through the rows of
the data API, everything else through the extension's actions. The rows of a
collection can be written by hand only as far as a screen offers it: a list
with `"create": false` is read, never added to; a collection no screen shows
is not served at all. A screen adds no power the actions do not have; it only
puts them in front of the owner.

### d7. No old format kept

No extension had been published in the old format: the AI extension and the
test extension move to the new one, and the old `views` is refused.

## Consequences

- The AI extension's screens are a list of providers (the service as a badge)
  and a list of usage that is read and removed, never written by hand.
- A screen with a key shown once, a log, a row button only for some rows, or
  a form that runs an action needs no code in the browser.
- A screen the vocabulary cannot say is a request for a new kind or key in
  `thecms.view/1`, not code in the extension.
