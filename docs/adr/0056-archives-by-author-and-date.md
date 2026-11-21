# ADR 0056 — Archives by author and by date

- **Status:** Accepted (owner, 2026-11-21: agreed to the direction as proposed, and "nu aș lăsa nimic pe mai târziu": the picture of each person, the archive by day, one page of each person across every type and the authors of a WordPress import are part of it; every address is the type's own, "/blog/" being only an example)
- **Date:** 2026-11-21
- **Builds on:** ADR 0010 (content types), ADR 0018 (tags), ADR 0036 (redirects), ADR 0050 (search engines), ADR 0054 (entries in more than one language), ADR 0055 (authors and contributors), ADR 0037 d4 (stage 2)

Since ADR 0055 every post names who wrote it. A reader who liked it wants the
rest of what that person wrote; a reader who comes back after a month wants
what was written in November. WordPress has both, as author and date
archives, and its blogs link to them from every post.

An example. Ana Pop writes on a firm's blog and on its news. Under each of her
posts it says "by Ana Pop", and her name leads to `/blog/author/ana-pop/`: her
picture, her few words, and her posts, newest first, in pages. A reader who
wants what was written in November opens `/blog/2026/11/`, headed
"November 2026", or the whole year at `/blog/2026/`; the home page carries an
"Archive" block that lists the months, "November 2026 (4)". Everything Ana
wrote, in the blog and in the news, is at `/author/ana-pop/`. In Romanian the
same lists are at `/ro/jurnal/author/ana-pop/` and `/ro/jurnal/2026/11/`,
headed "noiembrie 2026", with only what is translated.

## Decisions

### d1. A dated type has a page for each person who wrote in it

At `/<type>/author/<person>/`, paged like a category: their name, their
picture and their few words above their entries of that type. Only a dated
type has one: it is where the byline shows (ADR 0055 d3), and the byline's name
leads there. A type without dates (a team, the products) lists by title and
names nobody.

A person's address is made from their name; the second Ana Pop to join is
`ana-pop-2`. Someone without a name has no page, as they have no byline. A new
name moves the pages to the new address, and each old address leads to the new
one as a redirect (ADR 0036), on the owner's list with the others.

### d2. A picture of each person

On "Me", beside the name and the few words, each person chooses a picture
from the media library or uploads one. It is shown with their words at the
end of each post and on their pages, and given to search engines. A picture
from another site is not taken: the site keeps what it shows. Someone removed
takes their picture with them.

### d3. One page of each person across every dated type

At `/author/<person>/`, and `/<language>/author/<person>/` in another
language: everything they wrote in every dated type of that language, newest
first. `author` is therefore an address of the site itself, which no page
and no type may take.

### d4. Years, months and days, and an archive block

Each dated type has `/<type>/2026/`, `/<type>/2026/11/` and
`/<type>/2026/11/21/`, paged, headed with the year, the month or the day as
the language writes them. These lists only repeat entries that are already in
the type's list, so they are kept out of search engines (`noindex`) and out
of the sitemap, as Yoast does by default. A person's pages are in the sitemap,
as a profile (schema.org `ProfilePage`); a post's author points at their page.

The "Archive" block lists a dated type's months, newest first, each with how
many entries it holds, or its years; placed on any page, in the page's
language.

### d5. An entry may not take an archive's address

An address of digits alone (`2026`) is a year's, and `author` is the people's,
so a dated entry may not take either, in any language; the editor says so. A
WordPress post with such an address comes as `post-2026`.

### d6. The import brings the people, and the old archives lead here

Whoever wrote the posts and entries brought from WordPress comes too: as a
person with the author role and no access, with their name, so their posts keep
their byline. One whose email address someone here already has is that
person. The owner invites them from People if they should write here again.
The old `/author/<login>/` leads to that person's page, and the old
`/2024/`, `/2024/01/` and `/2024/01/15/` to the blog's, as do links to them in
the content.

### d7. Built with the site, in every way it is published

These lists are built with the rest of the site, served by the runtime and
written by the export, with no setting. A new name or picture shows at once,
without publishing anything again.
