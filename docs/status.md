# Where thecms stands

thecms is in **alpha** (ADR 0045). What is built, part by part; what comes
next, in four stages, is in [ADR 0037 d4](adr/0037-direction.md#d4-the-order)
and in the README.

| | |
|---|---|
| Page model, block types, themes as data | done |
| Blocks: hero, text, image, services, contact details, gallery, questions and answers, testimonials, prices, a list of entries, groups | done |
| SQLite store, draft and published kept apart | done |
| The same site on Postgres or MySQL, chosen by the address | done |
| Static export with sitemap and robots.txt, for a simple site; it says what only the server does | done |
| Visual editor: add, move, remove, type on the page, style with theme tokens | done |
| Theme builder: tokens, block defaults and variants, themes as files | done |
| Images uploaded and kept with the site, each offered at the size that fits a phone or a wide screen (srcset made in the browser); headings, lists and links from a bar on the page; blocks moved by dragging | done |
| Header and footer: logo, button and links from the site, layout from the theme | done |
| Content types the owner defines (a blog is only an example): entries at `/<type>/<entry>/`, categories, tags, paged lists, Atom feed | done |
| Admin with sections: pages, posts, media, menu and settings, theme | done |
| Menu builder: sub-menus, wide menus with columns, a folded menu on phones, all without script | done |
| Content types: the owner adds kinds of entry (projects, team, events) with their own fields, list and address; posts are one of them | done |
| A block that lists entries of a type on any page (latest posts, a few projects) | done |
| Each content type's page designed in the builder, with the entry's parts placed in it | done |
| WordPress import: pages, posts, images, menu, links rewritten, old addresses kept alive, a report of what did not come over | done |
| Import from the admin: choose the file, see what would come over and what would not, then run it | done |
| A WordPress category kept as a section of its own: its posts become entries of a new content type | done |
| Contact form with consent, a small form service of the site's own, email to the owner, messages kept for a set time, exported or erased on request | done |
| Forms built on a screen of their own and placed by a block: short and long text, email, phone, number, date, list, choices and boxes, each required or not, consent always; translated by field; each field checked by the server; messages by form, as CSV | done (files and steps: later) |
| Search and sharing per page and entry: a title for search engines, a picture for previews, hidden from search engines (sitemap and search too); a picture for the whole site; breadcrumbs shown or hidden, always said to search engines; the check warns of long or shared titles; Yoast and others imported | done |
| Backups: the whole site in one file, made by the editor's clock every day or week, the last ones kept on the server and sent to an S3 storage; downloaded, deleted, or put back after a backup of what is there, from the admin or `thecms restore`; a backup from one database goes back into another | done (encryption, email on failure: later) |
| Relations between entries: a field that links to entries of another type (or its own), picked by title, drawn on both sides; fields for a number, yes or no, a choice from a list and a file | done (filtering and ordering lists by a field: later) |
| Statistics without a cookie: pages counted by the server as it sends them, a visitor told apart by a fingerprint whose key changes daily, only the day's totals kept; visitors, pages, sources, devices and searches on a Statistics screen for the owner and editors | done (time on page, country: not without a script or an extension) |
| Language packs: the admin and the site's words in one JSON file a language, checked against English; Romanian ships complete | done |
| Accounts for a served editor: the first owner from a one-time link, editors invited by the owner, an editor writes content and nothing else | done |
| Installed with one command: one file a platform from GitHub Releases, checked by its checksum; a server with systemd in one more option; `thecms update` | done |
| The installer asks, step by step: this computer, a server (the database and Valkey installed, or a database of yours, tested), Docker with compose, or a ready platform; the site named and its language chosen on the first page | done (Cloudflare: with stage 3) |
| Extensions on the model of Zveltio's third-party ones: one file, accepted by the owner for what it asks; collections, actions on a block or a page, screens as data; code in a process of its own, on a server under a user of its own with no network | done |
| Extensions on the server (`thecms.extension/2`): public addresses under `/_/x/`, jobs the site's clock runs at an interval, events from the site (a page published, a comment, a message) | done |
| Pages in more than one language: each translated from the list of pages, at /ro/…, with the header, footer and menu of its language, a switcher and hreflang | done (posts and entries: planned) |
| AI writing, as an extension with the owner's key (Claude, OpenAI or Ollama): a block written or rewritten as asked, a page translated into its language, a page's description; each comes back as a change to look at | done (image descriptions: planned) |
| The last twenty publications of each page and entry kept, and one brought back into the editor as a change | done |
| Publish later: a page or an entry set for an hour, published then by the editor or the runtime | done |
| Pages behind a password, asked by the runtime; left out of the sitemap, the search and any export | done (members-only pages: with stage 2) |
| Search on the site: a block placed anywhere, answered by the runtime with a page of the site's own; every word, without minding case or accents | done |
| Comments on the entries of a type that takes them: a plain form, held for the owner's approval, shown without the writer's address, given or erased on request | done |
| A check before publishing: a link that leads nowhere stops the export, a picture with no description is listed; in the admin under the pages | done |
| The canvas shown as on a phone, a tablet or a wide screen | done |
| Data for search engines (schema.org): the site and its business on the home page, an article for each dated entry | done |
| The site is served (`thecms`, or `thecms run` without the editor): pages, forms, comments, search and old addresses as real 301s from one address, built again only when something is published; a cart and accounts arrive under `/_/` | started |
| Valkey on a server for built pages, the clock's lock, sessions and the counters that limit tries, with a fallback in memory and on disk; Settings → Performance tests it | done |
| Documents (PDF, Word, Excel, PowerPoint, OpenDocument, ZIP), sound and video in the media library, read from their bytes; a page that links to one exports it and keeps it from being deleted | done |
| Blocks for buttons, tables, video, sound, documents, and players from YouTube, Vimeo, Spotify, SoundCloud, Google Maps and OpenStreetMap, made from the address an author pastes | done |
