# ADR 0027 — AI writing, as an extension

- **Status:** Accepted (owner, 2026-11-19: "facem doar modelul iar extensii, singura pe care am face-o, ar fi ai-ul")
- **Date:** 2026-11-20
- **Builds on:** ADR 0024 (pages in more than one language), ADR 0026 (extensions)

The owner of a small site wants help with words: a block written or made
shorter, a page in a second language, the description search engines show.
That help comes from a model the owner pays for. It is not in the core: it is
the extension `ai`, built and published like any other.

## Decisions

### d1. An extension like any other

The code is in `extensions/ai/` in this repository, but it has no rights an
outside extension would not have. It runs in its own process, reaches the
network only through the program and only to the hosts it declared
(`api.anthropic.com`, `api.openai.com`, `localhost`, `127.0.0.1`), and keeps
its settings in its own collections. The owner installs it from its package,
after seeing what it asks for.

### d2. The owner's provider, the owner's key

The screen "AI providers" keeps one or more: Claude (Anthropic), OpenAI, or a
model on the owner's own machine through Ollama. The one marked "use this
one" is used, or else the first. A key is a secret field: it is never shown
again, and it is given only to the extension's code.

- Claude is called with Anthropic's SDK, whose requests go through the
  program like every other call. The model is `claude-opus-5-5` unless the
  owner writes another. When the model declines to write something, the
  request is run again on the fallback model Anthropic picks, in the same
  call (`fallbacks: "default"`); if that one declines too, the owner is told.
- OpenAI and Ollama are called on their own HTTP APIs, with the model the
  owner names.

### d3. What it does

- **Write with AI**, on a block: the owner says what to write or change
  ("shorter", "for a wedding venue"), and every place in the block is written
  or rewritten, the empty ones too.
- **Translate this page**, on a page: the page is translated into its own
  language. With ADR 0024 a translation starts as a copy under `ro/`; this
  turns the copy into Romanian.
- **Write the description**, on a page: the description for search engines,
  from what the page says.

What comes back is a block or a page, cleaned by the program like anything
the editor sends, and shown as a change: the owner looks at it, undoes it or
saves it. Nothing is published by the model.

### d4. Only words are sent

The model is given the texts of the block or page and the place of each
(`title`, `items.2.answer`), never addresses, files, ids or the block's
kind of fields, and answers with exactly one text for each place, in a
schema the service enforces. An answer with another number of texts is
refused. So a model can change words, never a link, an image or the layout.

### d5. What it costs is written down

Each call adds a row to "AI usage": what was done, with which provider and
model, and the tokens read and written.

### d6. Published apart

A tag `ai-v<version>` publishes the package and its SHA-256 as a release of
its own (`.github/workflows/extension-release.yml`). The program's releases
do not include it.

## Not decided

- **Image descriptions.** Writing an image's text from the image needs the
  extension to read the site's media, which no extension can yet. It will
  come with a way for an extension to ask for media, accepted by the owner.
- **Streaming.** An answer comes whole; a long page takes a while. Showing it
  as it is written needs the runner to pass parts of an answer.
- **Limits on spending.** The usage is recorded, not capped.
