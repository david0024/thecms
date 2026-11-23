# ADR 0067 — A block of code

- **Status:** Accepted (the plan for uhlaka.org, approved by Liviu and David on 2026-11-23, named the code block as one of the things the program lacked for its own documentation)
- **Date:** 2026-11-23
- **Builds on:** ADR 0001 d7 (one list of block types), ADR 0009 (content written as HTML, as blocks), ADR 0032 (translation by field), ADR 0047 (blocks closing stage 1)

uhlaka.org is made with Uhlaka, and its documentation tells people what to
type: an install command, a line for `/etc/uhlaka/env`. Until now the program
had `code` only as a mark inside a line of text, and an imported `<pre>` came
over as one paragraph a line, its indentation lost and its blank lines gone.
WordPress has a code block and a preformatted block without a plugin.

## Decisions

### d1. A new type: code

A title, the code, its language and a caption. The code keeps every line and
space as written, up to 20,000 characters; only blank lines before and after
it are dropped, and Windows line ends become `\n`. It is drawn in a
`<pre><code>`, in a fixed-width font on the theme's surface colour, and a long
line scrolls sideways inside the block, never the page. On the page it is typed
like any other text, Enter starting a new line; in the panel it has a wide
field in the same font.

### d2. The language names it, nothing more

The language (`sh`, `ts`, `json`) is written as `class="language-<name>"`,
the convention Markdown, WordPress and highlighters share, and only when it
could be a class name. The site does not colour code: that would mean a
script or a large table of rules for every language, for something a reader
can do without. A theme or a later decision may add it from that class.

### d3. Code is the same in every language, and is not words

The code and its language are common fields (ADR 0032): a translation keeps
them as the main page has them, and changing them is done there. The title and
caption are translated. Code is left out of the description and the excerpt
the site writes by itself (ADR 0058 d1); the site's search still finds it,
since it reads the page as drawn.

### d4. `<pre>` is imported as a code block

The HTML import (WordPress, and the Markdown of uhlaka.org's documentation,
made HTML first) makes each `<pre>` a code block, its language read from a
`language-…` or `lang-…` class on the `<pre>` or the `<code>` inside it. A
`<br>` is a line. An empty `<pre>` is left out. The import no longer reports
preformatted text as something that did not come over.
