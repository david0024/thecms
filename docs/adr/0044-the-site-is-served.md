# ADR 0044 — The site is served

- **Status:** Accepted (owner, 2026-11-21: "oare nu ar fi bine sa renuntam la servirea statica? … nu este o abordare hibrida in sensul in care sa asigure si functionalitate completa"; on the proposal that follows: "da"; on Valkey installed by default on a server: "da")
- **Date:** 2026-11-21
- **Supersedes:** ADR 0037 d2 (static where it can be, a server where it must) where it makes static files the main way a site is published; ADR 0038's "optional" runtime; ADR 0001 d9 where it says the public pages are static files on any host
- **Builds on:** ADR 0037 (anything WordPress does), ADR 0038 (the runtime), ADR 0039 (the site's clock), ADR 0023 (installation)

ADR 0037 kept the published pages as static files and put whatever could not
be static in a runtime beside them. Each feature that followed (comments,
search, password pages, extension routes) then had two answers: one on the
runtime, and a weaker one, or none, on a static host. The editor drew a form
or a search field only when the site said where a runtime was; without that,
the block showed a hint and the visitor saw nothing. The owner asked whether
this was a hybrid that gives the whole of what WordPress gives. It was not:
every feature WordPress has without asking had a condition here.

## Decisions

### d1. A site is served, as a WordPress site is

The way to run a site is a server: `thecms` (the editor and the site), or
`thecms run` (the site alone). It serves the published pages, its own
`/_/` addresses (forms, comments, search, unlock, extension routes) and its
media from one address. Every feature works there always, with nothing to
set. No block, form or field disappears because a setting is empty.

- The editor serves the site at its own address and the admin beside it, at
  `/admin/`, as WordPress does. `/` is the home page, not a redirect to the
  admin. The canvas's stylesheet, which is the theme as it is being built,
  moved to `/admin/site.css`, so `/assets/site.css` is the published one.
- `admin` is a reserved address; no page may take it.
- The site the editor serves uses the editor's own extension host, so an
  event is delivered once.
- A form's address is `/_` unless a form service is set in Site settings,
  for a site that is exported (d3).

### d2. Pages are built again only when what visitors see changed

Each change that a visitor can see (publishing a page, an entry, a theme or
a section; moving or deleting one; settings, redirects, a lock, media, an
approved comment) writes a new **site version** to the database. The runtime
keeps the built site in memory and asks for the version at most once a
second (`FRESH_MS`); when it changed, it builds again. A save that is not
published changes nothing. Several processes on one database (the editor and
a `thecms run`, two runtimes behind a balancer) see each other's changes the
same way, within a second.

### d3. A static export stays, for a simple site, and says what it loses

`thecms export` still writes the site as files for any static host. It is an
option, not the way. The site check (in the admin, and the export's own
lines) says what only the site's server does, in words the owner reads:

- contact forms and comments have nowhere to send, unless a form service is
  set (then `thecms forms` answers them where it runs);
- the search field finds nothing;
- pages behind a password cannot be opened (the export never holds them);
- the addresses extensions answer at, under `/_/x/`, do not exist.

A site that uses none of these loses nothing, and is told nothing.

### d4. Valkey on a server, with a fallback that always works

On a server, the one-command installation (`install.sh --server`) installs
Valkey and starts it, listening only on the machine (`127.0.0.1`), as Zveltio
does. thecms uses it for:

- the page cache of d2, shared by every process;
- the queue of jobs, and the lock that lets one process only run a job that
  must run once (today a claim in the database, ADR 0039 and 0041);
- sessions;
- the counters that limit tries (forms, comments, unlock).

All of it goes through one layer, with a fallback in memory and on disk. The
fallback is what runs on Cloudflare Workers, in development, and when Valkey
is down. In the last case nothing stops: the site is served from the
fallback, and the admin shows a warning until Valkey answers again.

Valkey is set by `THECMS_VALKEY_URL` or the configuration file, and in
**Settings → Performance**, which has **Test connection**. Without one, the
fallback is used and nothing warns: that is the normal state of a laptop.

## What this changes

- The README presents the site as served, and the export as an option.
- `install.sh --server` serves the site and the admin at the public address;
  the web server in front only holds the certificate.
- The hints in the editor for a form or a search with no runtime are gone,
  and so is the condition behind them.

## Order of work

d1 to d3 come first, in one change. d4 follows in its own: the layer and its
fallback, Valkey in the installer, the setting and its test, the warning.
