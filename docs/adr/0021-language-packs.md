# ADR 0021 — Language packs

- **Status:** Accepted (owner, 2026-11-19: "limba romana trebuie sa fie un pachet de limba ca si oricare alt pachet de limba", then "da, merg pe recomandarile tale")
- **Date:** 2026-11-19
- **Builds on:** ADR 0001 d3 (words are data), ADR 0020 (language packs are MIT)

Until now the admin's words were English only, and the site's few words came
in English and Romanian, with Romanian written into the code. The owner asked
for Romanian to be a language pack like any other. Zveltio keeps its words in
inlang's message format, one flat JSON file per language, and that format
fits here too.

## Decisions

### d1. One flat JSON file a language, for the admin and the site

`languages/ro.json`:

```json
{
  "$language": "ro",
  "$name": "Română",
  "site.menu": "Meniu",
  "admin.design.heading": "Pagina fiecărei intrări: {singular}",
  "admin.ctypes.entries": { "one": "1 intrare", "few": "{count} intrări", "other": "{count} de intrări" }
}
```

- The keys are the paths of the English words: `admin.*` for the admin
  (`src/admin/messages.ts`) and `site.*` for what the site says to a visitor
  (`src/blocks/words.ts`). One file covers both, so a translator works in one
  place.
- A message fills in its places by name, `{singular}`.
- A message that depends on a number gives the forms its language needs, by
  the rules every browser and Bun already know (`Intl.PluralRules`: zero, one,
  two, few, many, other), and it always gives `other`. Romanian needs three
  forms, English two, and some languages six. A plain `n === 1` check could
  not say Romanian correctly.
- The format is the same as Zveltio's flat keys with `{name}` places, so
  translators and tools that know one know the other.

### d2. English is built in and is what every pack is checked against

English stays in the code as typed data, so a component cannot use a word
that does not exist. Every pack is checked against it before any of it is
used (`parsePack`):

- a key English does not have is left out;
- a message whose places are not English's is left out;
- a plural form where English has plain text, or the other way round, is left out;
- a plural form without `other`, or with a form that is not a CLDR form, is left out;
- control characters are taken out, and a message is cut to 2,000 characters.

What is left out is named once on the console when the program starts. What a
pack leaves out is said in English, so a half-finished pack still works. The
admin shows how much of English each pack covers.

### d3. Packs are files the installation reads when it starts

The packs in `languages/` ship with thecms. A folder named in
`THECMS_LANGUAGES` adds more, or replaces a shipped pack with its own. Adding
a language means adding a file: nothing is compiled, and the file is data, as
a theme is.

Uploading a pack from the admin is not part of this decision. Packs belong to
the installation, while the admin edits one site, and an installation may
later hold many sites (ADR 0001 d4). When accounts and hosting arrive, the
owner of an installation will be able to upload one there.

### d4. The site speaks its language; the admin can speak another

- The site's words come from the pack of the site's language (`ro`, or `ro`
  for `ro-MD`), and are in English without one.
- The admin speaks the language set in its settings, or the site's when none
  is set. The server puts that pack's words into the admin's page, and they
  are read before the admin starts. Choosing another language saves it and
  opens the admin again.
- Dates are written by `Intl.DateTimeFormat` in the site's language, with no
  pack needed.

### d5. Every shipped pack is complete

A test fails when a pack in `languages/` does not say everything English says.
A new English message is translated in the same change, so Romanian never
drifts behind. A pack added through `THECMS_LANGUAGES` does not have to be
complete.

## Not decided here

- Content in several languages (a page in English and in Romanian) is the next
  item in the plan, and is separate from the words the program says.
- A right-to-left language needs the layout to follow `dir`; no such pack ships yet.
