# thecms

**A website builder you own.** Open source, for any kind of site: a business
card, a portfolio, a blog, a catalogue, and soon a shop, memberships and courses.
You build it by arranging blocks on the real page, and change its look without
ever breaking it.

> thecms is in **alpha**. It stays in alpha until everything planned for it is
> built, then goes to beta for testing, and only then to a stable release
> ([ADR 0045](docs/adr/0045-versions.md)). Try it, and expect changes.

## Why thecms

- **You edit the page itself.** No form next to a preview: you click on the
  text and type, drag blocks where you want them, and see the page as it will
  be on a phone, a tablet or a wide screen.
- **Free to change the look, without breaking the theme.** A block's content
  and its style are kept apart. A style either follows the theme or is your
  own, and your own can always be reset.
- **A theme is a document, not code.** You make one in the theme builder
  (colours, typefaces, spacing, how each block looks), save it as a file and
  share it.
- **Everything works from the start.** Forms, comments, search and pages behind
  a password are answered by the site itself, with nothing to set up. Pages are
  built again only when something changes, so they load as fast as plain files.
- **Extensions cannot take the site down.** Each one says what it needs before
  you accept it, and runs apart from the site.
- **Your site is yours.** One program, on your server or your computer, with
  your database. Take its content with you in one open file, let apps read
  its pages as JSON, or download it as static files whenever you like.

## What you can make with it today

**Pages and design**
- Blocks for headings, text, images, galleries, services, prices, testimonials,
  questions and answers, buttons, tables, video, sound, documents, and players
  from YouTube, Vimeo, Spotify, SoundCloud, Google Maps and OpenStreetMap,
  made from the address you paste.
- A header, a footer and menus (with sub-menus and wide menus), from the site's
  settings and the theme.
- Sections written once and shown on many pages.

**Content**
- Your own kinds of content: a blog, projects, a team, events, each with its
  fields, its address, its list page and its look, designed in the same builder.
- Fields of text, dates, numbers, yes or no, a choice from a list, pictures,
  links and files; and links between entries (a project's client, a recipe's
  ingredients), shown on both sides.
- Categories, tags, paged lists and feeds; a block that lists the latest entries
  anywhere.
- Publish now or at a set hour; the last twenty publications kept, to bring one
  back.
- A check before publishing: links that lead nowhere, pictures without a
  description.

**Media**
- Images, offered at the size each screen needs; documents (PDF, Word, Excel,
  PowerPoint, OpenDocument), sound and video, in one library.

**Visitors**
- Forms you build yourself (contact, a quote request, a booking): text, email,
  phone, number, date, lists and boxes to tick, with consent; messages by form,
  sent to you by email and downloaded as CSV.
- Comments, held for your approval.
- Search in every word, without minding case or accents.
- Pages behind a password.
- Data for search engines (schema.org), a sitemap, and old addresses kept alive
  with redirects.

**Languages**
- The editor in English and Romanian, and more through language packs.
- The same page in more than one language, with its own menu, a language
  switcher, and the tags search engines need.
- Posts and entries in more than one language too: each type with its own name
  and address in each language, and in each language only what is translated.

**People**
- An owner, and editors the owner invites. An editor writes and publishes
  content; the rest stays with the owner.

**Extensions and AI**
- Extensions as a single file, accepted for what they ask, with their own
  screens, pages, scheduled jobs and events.
- AI writing as an extension, with your own key (Claude, OpenAI or Ollama): a
  block written or rewritten, a page translated, a description suggested. Each
  comes back as a change for you to accept.

**Backups**
- The whole site in one file, made by itself every night (or every week), the
  last seven kept on the server and a copy sent to any S3 storage. One click
  downloads one or puts it back, after a backup of what is there now; it also
  moves a site to another server or another database.

**People who write**
- Invite others as owners, editors, authors or contributors. An author writes
  and publishes their own posts; a contributor sends theirs for review, and an
  editor publishes them or sends them back with a note. Each post shows who
  wrote it, with a few words about them and their picture.
- Each person has a page of what they wrote, in each type and across them, and
  each dated type has its years, months and days; an archive block lists the
  months on any page.

**Statistics**
- Who reads the site, which pages, where readers come from and on what device,
  counted by the site's own server: no cookie, no script, no consent banner,
  and nothing kept that names a visitor.

**Moving from another CMS**
- Bring a WordPress site from its export file: pages, posts, images, menu and
  categories, with links rewritten and old addresses still working. You see
  what would come over before anything is written.
- Take the content of a thecms site to another in one file, from Export to
  Import: pages, entries, sections, forms, pictures, the theme and settings.

Part by part, with what is still missing: [docs/status.md](docs/status.md).

## Install

The installer asks, one step at a time, where the site will live: only this
computer, a server of yours, Docker, or a ready platform (Railway, Render,
Fly.io) ([ADR 0048](docs/adr/0048-the-installer-in-steps.md)).

On Linux or macOS:

```sh
curl -fsSL https://github.com/david0024/thecms/releases/download/v0.1.0-alpha.2/install.sh | sh
```

On Windows, in PowerShell, for this computer:

```powershell
irm https://github.com/david0024/thecms/releases/download/v0.1.0-alpha.2/install.ps1 | iex
```

- **This computer:** in a folder for your site, run `thecms`. It makes a sample
  site and opens it, with its editor at `/admin/`.
- **A server** (Linux with systemd, as root): it installs the database you
  choose (SQLite, PostgreSQL, MySQL or MariaDB), or connects to one of yours
  after testing it, installs Valkey, and runs the site as a service behind the
  web server that holds the certificate.
- **Docker:** a folder with `compose.yaml`, the database and Valkey beside the
  site.
- **A ready platform:** [docs/install/platforms.md](docs/install/platforms.md).

Then open the link it prints: on that first page you name the site, choose its
language and make your account. Every question also has an option, for
scripts:

```sh
curl -fsSL https://github.com/david0024/thecms/releases/download/v0.1.0-alpha.2/install.sh \
  | sh -s -- --host=server --database=postgres --public=https://cms.example.com
```

`thecms update`, or the installer run again, brings the newest release and
leaves the site as it is.

## What comes next

Four stages, each ending with something you can use
([ADR 0037](docs/adr/0037-direction.md#d4-the-order)):

1. **The foundation:** the site served, scheduled publishing, comments, search,
   pages behind a password, media and new blocks. *Done.*
2. **What almost every site needs:** a form builder (*done*), complete SEO (*done*), scheduled
   backups (*done*), relations between entries (*done*), statistics without cookies (*done*), entries in
   more than one language (*done*), authors and contributors (*done*), archives by author and date (*done*), a complete export (*done*). *Done.*
3. **Commerce and members:** visitor accounts, a shop (products, cart, orders,
   VAT), payments (Stripe and Netopia first), couriers, e-invoicing,
   memberships and subscriptions, bookings, newsletters, and running on
   Cloudflare.
4. **Further:** courses, a forum, and several sites from one installation.

## For developers

thecms is TypeScript on [Bun](https://bun.sh), with Svelte 5 for the blocks and
the editor. A site lives in SQLite, PostgreSQL or MySQL, chosen by its address,
and the program ships as a single file for each platform.

```sh
bun install
bun run cms init site.db      # a sample site, in one file
bun run cms edit site.db      # the site and its editor; open the address it prints
bun run check                 # types, then tests
```

More: [working from the sources](docs/development.md), the
[decisions behind thecms](docs/adr/README.md), each with its reason, and
[how to contribute](CONTRIBUTING.md).

## Licence

The core is [AGPL-3.0-or-later](LICENSE) ([ADR 0020](docs/adr/0020-licence-agpl.md)).
Themes, language packs and the client SDK are MIT; your themes, extensions and
the sites you build may carry any licence. Contributions come under a simple
[CLA](CLA.md).
