# ADR 0075 — The admin bar over the site

- **Status:** Accepted (Liviu, 2026-11-24: "construieste-o. David este de acord."). Liviu had asked for it before, "o bara superioara in stilul celei din wordpress"; the review of the admin (2026-11-24) left it for David to decide. Signing out, "Not published", the numbers of what waits and the setting in "Me" (d5) were proposed in the thread the same evening and agreed by Liviu ("da, de acord").
- **Date:** 2026-11-24
- **Builds on:** ADR 0022 (accounts and their session), ADR 0044 (the site is served, with a cache of its pages), ADR 0055 (authors and contributors), ADR 0069 d4 (the admin is noindex), ADR 0072 (an address for each screen of the admin), ADR 0074 d4 (one script on a public page, and only that one)

A person who runs a site in WordPress looks at it signed in, and a dark strip
over every page takes them to the admin, to this page in the editor, or to a
new page. Uhlaka has a way from the admin to the site (ADR 0072), but none
back: the owner who sees a mistake on a page has to open the admin, find the
page in the list and open it. For a beginner, who thinks of the site as its
pages, the way from the page is the one that is missing.

## Decisions

### d1. A bar over the site's pages, for whoever is signed in to the admin

On a served site (`uhlaka serve`, accounts of ADR 0022), a person signed in
to the admin sees a bar over each page of the site, the first thing on it:

- **Admin**: the admin.
- **Edit page** (or *Edit post*, *Edit project*, by the type): this page or
  entry, opened in the builder (`/admin/#at=edit/page/about`, ADR 0072).
- **New page** (or *New post*): the list of pages, with the title of the new
  one asked at once (`/admin/#at=new/page`, a new address of the admin).
- **Their name**, on the right: their own screen (`#at=me`).

It shows only what the person may do there (ADR 0055): a page is the owner's
and the editors' to change; an entry also its author's, unless they are a
contributor, whose published entry is an editor's. An author or a contributor
adds a post, not a page. A missing address, a search, a visitor's account page
get the bar without "Edit". It speaks the admin's language.

Four more parts are in d5.

### d2. Added by the server, only for a request with a session

The bar is not in the page that is built and kept (ADR 0044). The server adds
it to the page it answers, after the cache, and only when the request carries
the admin's session cookie and that session signs someone in:

- **A visitor's page is not touched.** Without the cookie nothing is asked of
  the accounts, and the page is the same bytes, with the same headers, as
  before; a cache in front (Cloudflare) keeps working as it does. The cookie
  is the admin's own (`HttpOnly`, `SameSite=Strict`), so a visitor never has
  it; visitor accounts (ADR 0064) have another.
- **A page with the bar is that person's alone**: `Cache-Control: private,
  no-store`, so no cache keeps it or shows it to anyone else.
- **What a page is in the editor** (a page by its address, an entry by its
  type and address, in each language) is noted while the site is built, beside
  its files, and read from there; nothing of it is written in the page.

### d3. No script, and nothing kept in the browser

The bar is links and a few lines of style, in the page's head; the site's
rule of no script (ADR 0074 d4) stands as it is, and its Content Security
Policy does not change. Every rule of its style starts at `#uhlaka-bar`, so
the theme does not reach it and it reaches nothing of the page. It keeps its
own dark colours in light and in dark: it belongs to the admin, which stays
light (ADR 0074 d8), and should not be taken for part of the site. It sits
above the site's header, not over it (not fixed), so a theme's sticky header
works as before; on a phone the person's name gives way to its icon, and the bar
is not printed.

### d4. Where it is not

- **An exported site** has no bar: it has no server to ask who is signed in.
- **`uhlaka edit`** on one's own computer has no accounts (its key is in the
  admin's address, ADR 0022), so no bar either; the builder's "View on the
  site" (ADR 0072) is the way there.
- **The admin's own addresses** (ADR 0069 d4) are unchanged.

### d5. Signing out, what is not published, what waits, and a way to turn it off

- **Sign out**, on the right. A plain form (`POST /admin/sign-out`), so no
  script: the session ends and the person is left on the page they were on, as
  a visitor sees it. A form from another site is refused (its `Origin`, and the
  cookie is `SameSite=Strict` anyway); where it leads is an address of this
  site only.
- **"Not published"** beside "Edit page" when the page or entry has a draft
  that is not what visitors see, so the owner who just changed it and does not
  see the change knows why. A page never changed since it was published says
  nothing.
- **What waits**, as a number with an icon, only above zero, for the owner and
  the editors: comments to approve, entries sent for review (ADR 0055), and,
  with the shop on, orders waiting for payment or paid and not yet prepared
  (for whoever may see orders, ADR 0065). Each leads to its screen and says
  in words what it counts, on hover and to a screen reader. Messages from
  forms are not counted: a message has no "read" yet.
- **"Show the admin bar on the site"** in "Me", on by default, for each person
  alone: turned off, the site is the visitor's page, untouched.

Left out on purpose, from WordPress's bar: updates, "Customize", a search box,
and menus that open on hover, which would take a script.

## Verification

- Unit: the links each role gets on a page and on an entry; the words in the
  admin's language; a name escaped; the bar first in the body and its style in
  the head.
- Served (`test/admin-bar.test.ts`): a visitor, and a cookie that signs nobody
  in, get the page byte for byte with its headers; the owner gets the bar on a
  page, an entry and a missing address, `private, no-store`, and without the
  bar the page is the visitor's; an author edits their own entry and no one
  else's, nor a page; a page and an entry in another language open where the
  editor keeps them; "Not published" only after a change; the numbers for the
  owner and not for an author; signing out ends the session, refuses another
  site's form and leads only to this site; the bar turned off in "Me" gives the
  visitor's page, and on again brings it back.
- Browser (`e2e/admin-bar.cjs`): the bar runs across the top; "Edit page"
  opens the page in the builder; "New page" opens the pages with the title
  asked; on a phone in dark the page does not scroll sideways; turned off in
  "Me" it is gone; a change not published is said; "Sign out" leaves the
  person on the page as a visitor; a visitor has no bar.
