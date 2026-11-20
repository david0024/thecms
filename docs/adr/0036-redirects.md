# ADR 0036 — Old addresses: moved pages and redirects written by hand

- **Status:** Accepted (owner, 2026-11-20: "da", to: the CMS makes the redirect itself when a page's address changes; a "From"/"To" list in the settings; the check before publishing names loops and redirects to pages that do not exist; the export writes them for Cloudflare, Netlify and Apache, and a page for any other server)
- **Date:** 2026-11-20
- **Builds on:** ADR 0009 (old addresses from a WordPress import), ADR 0024 and 0032 (translations and their addresses), ADR 0029 (the check before publishing)

ADR 0009 kept a list of old addresses, filled only by an import. A page's
own address could not be changed at all, and a translation's could, with
nothing to catch the visitors who knew the old one. Links from other sites
and from search engines then lead to "Page not found".

## Decisions

### d1. A page can move, and takes everything with it

The page's inspector has its address. Changed, the page moves at once: its
draft, what is published, its versions, its translations (whose address
follows the main page's unless they have their own) and the menu items that
name it. The home page stays at `/`, a page stays under its language, and an
address another page or translation has is refused, saying whose it is.

### d2. Every address visitors knew leads to the new one

An address is known to visitors once it is published. When a page moves,
each of its published addresses (the page's own and each translation's) gets
a redirect to where it is now. When a translation is published at a new
address, its old one gets one too. A page that was never published leaves
nothing behind.

The list never makes a visitor hop: what led to the old address now leads
straight to the new one. And an address that is answered again (a page moved
back) drops the redirect that led away from it.

### d3. The owner writes them too

The site settings list the old addresses, "From" and "To", whether they came
from an import, a move or the owner. One can be added or removed there. Both
sides are addresses on this site; one that leads to itself, or is not an
address, is not kept, and the owner is told.

### d4. The check before publishing names what will not work

Read against the pages the export writes (ADR 0029), a redirect is named
when it:

- comes back to itself (a loop);
- leads to another old address (a chain), so it should point at the new one;
- leads to an address the site does not have;
- is never followed, because a page lives at the old address.

These are said, not stopped: the export leaves out what cannot work, and
the site is published.

### d5. Written for the host, and for any host

The export still writes a small page at each old address, with
`<meta http-equiv="refresh">` and the canonical address (ADR 0009): any
server serves it. Next to it, for the hosts that read a list and answer with
a real `301`:

- `_redirects`, one `from to 301` a line, read by Cloudflare Pages and
  Netlify;
- `.htaccess`, one `Redirect 301 from to` a line, read by Apache.

Only redirects whose target is published and whose old address no page has
are written, in all three forms. Netlify serves a file that exists before
its list, so there the small page answers; Cloudflare and Apache answer with
the `301`.

## Not yet

- Entries (posts, projects) keep their address; moving one waits for the
  same field in the entry's inspector.
- Links inside the site's own pages to the old address are not rewritten:
  they keep working through the redirect.
