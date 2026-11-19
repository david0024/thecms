# ADR 0026 — Extensions, on the model of Zveltio's third-party extensions

- **Status:** Accepted (owner, 2026-11-19: "aș implementa sistemul de extensii de la zveltio chiar de la bun început … ar trebui să mergem doar pe modelul third party"; asked whether a CMS needs first-party at all, agreed it does not)
- **Date:** 2026-11-19
- **Builds on:** ADR 0022 (accounts), ADR 0023 (installation), ADR 0025 (content types are the owner's)

thecms has a slim core and grows by extensions. The model is Zveltio's: an
extension declares what it keeps and what it does, the program does the rest,
and who may do what is the program's rule, never the extension's. Unlike
Zveltio, every extension is third-party, ours included.

## Decisions

### d1. Only third-party

Zveltio runs its own extensions inside the engine ("first-party"), because
there the official extensions are the product and some need the engine from
inside. A CMS does not: what would need it (a cart and payments) belongs in
the core, a new block can be described as data, and a script on the public
site can be declared and accepted. WordPress runs every plugin with full
trust, and pays for it; Shopify and Wix run only apps that work through an
API, and their ecosystems include shops. So every extension here, the AI one
too, runs apart from the program and reaches only what it declared. A
signature on our own packages may come later, as a mark of who published it,
never as more rights.

### d2. One file

A package is one JSON file, `<name>-<version>.thecms-extension`, in the format
`thecms.extension/1`: the manifest, and the code as one ES module.
`bun tools/pack-extension.ts <folder>` makes it from a folder with
`manifest.json` and `index.ts`, and checks it as the program will.

The manifest declares:

- **collections**, each with typed fields (text, longtext, number, boolean,
  choice, secret, url). The program keeps their rows (`extension_rows`) on
  every database; there is no SQL and no migration in an extension.
- **actions**, its only code: each names the collections it reads and writes,
  how long it may take (1 to 300 seconds) and where it shows: on the block
  being edited, on the page, or on its own screen. An action may ask questions
  first (a text, one of the site's languages).
- **egress**: the hosts its code may call, `api.example.com` or
  `*.example.com`.
- **views**: a collection as a list with a form, drawn by the admin. No code
  of the extension runs in a browser.
- **messages**: its words in other languages.

### d3. The owner accepts the exact file

Installing shows what the package asks for: what it keeps, the secrets it
holds, the hosts it calls, where it shows in the editor, and its SHA-256. The
install sends that SHA-256 back, and any other file is refused. A package that
needs a newer program says so. From the command line,
`thecms extension <site> install <file>` prints the same and installs only
with `--yes`.

### d4. Its code runs in a process of its own

Each extension gets a process, started when an action is first run and
stopped after five minutes without use, when it is turned off, or when an
action does not answer in time. The process has an empty environment: no
database address, no key, no setting. It asks the program for everything, as
messages:

- its collections, only those the running action declared;
- a call to a host it declared, made by the program, over https (http only to
  this machine, for a model served locally), with redirects not followed and
  answers up to 5 MB;
- the site's name and languages.

On one's own computer this is a process boundary, not a sandbox: the code can
read what that person can. On a server (`install.sh --server`) systemd starts
it for each connection to a socket only the service may open, under a user
made for that run, with no network and no way into the site's folder or its
settings (`thecms-extensions.socket`, `THECMS_EXTENSION_RUNNER`). That is the
same promise Zveltio makes for community extensions: an operating-system
boundary, not an adversarially tested sandbox.

### d5. What it gives back is checked, and is a change, not a write

An action on a block gets the block, the page's language, the answers and the
site's name and languages, and gives back a block. The program cleans it by
the same rules as any block, keeps its id, and the editor puts it in place as
one step to undo. An action on a page does the same with the page's title,
description and blocks. Nothing an extension says is saved or published until
the person does it.

### d6. Who may do what

Installing, turning on and off, removing, an extension's screens and the
actions of those screens are the owner's. Editors use what the extensions
that are turned on offer in the editor. A secret is never sent back to the
admin; left empty in the form, it stays as it was. Removing an extension
removes what it kept.

## Not decided here

- The AI extension, the first one: ADR to follow.
- Where extensions are found. For now, a file from wherever its author
  publishes it; ours in this repository's releases.
- Blocks drawn on the public site from an extension, as data with a template,
  and scripts on the public site declared and accepted (a map, a chat).
- Jobs that run after a request, on a schedule.
