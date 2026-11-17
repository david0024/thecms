# ADR 0012 — Importing from the admin

- **Status:** Accepted
- **Date:** 2026-11-17
- **Builds on:** ADR 0009 (importing a WordPress site), ADR 0010 (content types).

The import ran from the command line only. The people it is for are WordPress
users, and most of them have never opened a terminal. An import that is the
first thing a newcomer does has to be a screen.

## Decisions

### d1. The same plan, the same runner

The screen adds no second importer. The file goes to the editing server, which
calls `planImport` and `runImport` exactly as the command line does. What a
file becomes does not depend on where the import was started.

### d2. Look first, then write

Choosing a file writes nothing. The server reads it and answers with a
preview: how many pages, posts and images, which old addresses will lead to
new ones, and every note about what will be changed or left out. The owner
reads the losses before the import, when they can still decide not to run it,
instead of after.

The call is stateless: the file is sent once to be looked at and again to be
run. The server keeps no uploaded file between the two, so there is nothing
to clean up and nothing stale to run by mistake.

### d3. Kinds of entry a plugin added are offered, not guessed

The file cannot say which custom post types are content and which are a
plugin's own records (ADR 0009 d10). The command line asks for their names.
The screen lists the ones the file holds, each with its count, as checkboxes.
Ticking one asks for the preview again, so the counts and notes shown are
always the ones the import would produce.

### d4. A site that exists keeps its settings unless asked

From the command line an import usually makes a new site, and the site takes
the old name, language, address and menu. In the admin the site always exists
already, so the default is the other one: content is added, and the name and
menu stay. A checkbox takes the settings from the old site for the owner who
has just begun and wants them.

### d5. The import outlives its request

Copying images takes minutes. The call that starts the import answers at
once; the work goes on in the server, and the screen asks how far it is.
Leaving the screen does not stop it, and coming back shows the progress or
the report. One import runs at a time; a second is refused while the first
is running.

The state is in memory. If the editor is stopped mid-import, what was written
stays, and running the same file again finishes the job, because an import
replaces nothing (ADR 0009).

### d6. A content type the site cannot take does not stop the rest

Content types are added before any entry. If the site refuses one (a page
already lives at its address), that type and its entries are left out and
named in the report, and the pages and posts still come. Before this, the
refusal arrived half way through an import.

## Security

- The calls sit behind the same token, host and origin checks as every other
  call of the editing server. An export file is at most 64 MB.
- The file is parsed by the reader of ADR 0009, which resolves no entities
  and fetches nothing while reading.
- Copying images makes the server fetch addresses named in the file. Only
  `http` and `https` addresses on the old site's host or among its
  attachments are fetched, and what comes back is stored only if its bytes
  are an image. A crafted file can still make the owner's computer request an
  address it names; the answer is never shown, only whether it was an image.
  This is the same reach the command line has. It matters more on a hosted
  server, which must refuse private addresses before this screen is offered
  there.

## Known gaps

- The screen takes one file. A large WordPress site exports in several; each
  is imported in turn.
- An import cannot be stopped from the screen once started.
- Progress counts images only; writing the pages is one step.
