# ADR 0037 — What thecms is for: anything WordPress does, with its plugins

- **Status:** Accepted (owner, 2026-11-20: "dar nu facem doar site de prezentare… thecms trebuie sa fie un cms. nu exista limita… trebuie sa poata face orice poate face wordpress ca atare dar si wordpress cu extensii"; on the plan that follows from it: "mergem pe propunerile tale")
- **Date:** 2026-11-20
- **Superseded in part by:** ADR 0044 (the site is served; d2 no longer makes static files the main way)
- **Supersedes:** ADR 0001 d2 (content sites only; no commerce in the core) and the line of ADR 0001 d9 that only forms and search need a backend
- **Builds on:** ADR 0019 (the site's form service), ADR 0026 (extensions), ADR 0035 (who decides what)

Several records were written as if thecms were for presentation sites:
ADR 0001 d2 left shops, memberships and courses to other platforms, ADR 0010
called content types "for presentation sites", and the README called the
whole program "a CMS for content sites". The owner had settled otherwise, and
says it again here: a presentation site can be written in plain HTML and needs
no CMS. thecms is a CMS for any site, smaller than Zveltio, but with no limit
of the kind "only a presentation site".

## Decisions

### d1. The measure is WordPress, with its plugins

A site WordPress can make, alone or with its large plugin families, thecms
can make: comments, search, scheduling, private pages, roles, forms, SEO,
backups, a shop, memberships and subscriptions, bookings, newsletters,
courses. What WordPress has without plugins comes with the program. What the
plugin families bring comes with the program where most sites of that kind
need the same thing (a cart, orders, visitor accounts), and as an extension
where it depends on a provider (a payment service, a courier, an invoicing
system).

Zveltio stays the platform for data applications; thecms does not grow into
one. What separates them is the owner of the site, not the size of the site.

### d2. Static where it can be, a server where it must

The public pages are still static files, on any host (ADR 0001 d9). What
cannot be static (a comment, a search across many entries, a visitor's
account, a cart, a payment, a booking, a scheduled publication) runs in **the
site's runtime**, an optional third part beside the editor and the export.

- It answers the site's addresses under `/_/` (`/_/comments`, `/_/cart`,
  `/_/account`). The host sends them to it: one line in `_redirects` on
  Cloudflare Pages and Netlify, a `location` in nginx.
- It grows out of the form service (ADR 0019), which becomes its first route.
- It runs first on a server, `thecms run <site>`: the same program, the same
  database as the editor. Then on Cloudflare Workers, as a package the export
  writes, with D1 as its database.
- A site that uses nothing dynamic needs no runtime and stays as it is.

Its rules:

- **Static whenever it can be.** A product's page is static; its price and
  stock are checked by the runtime at checkout. A small site's search is an
  index written by the export.
- **No script on the page where a form will do.** A comment, a cart and an
  account work with plain HTML forms, as the contact form does. A small script
  only where a form cannot do it, declared and accepted.
- **The same look.** The pages the runtime draws (the cart, the account,
  checkout) are drawn with the same components, theme and layout.
- **Visitors are not editors.** A visitor's account (a customer, a member, a
  student) lives apart from the admin's accounts and never reaches `/admin`.
- **No card passes through the site.** Payment happens at the provider; the
  runtime receives only its confirmation, through that provider's extension.
- **The site's clock.** The runtime runs jobs: a publication at a set hour
  (followed by a new export and publication), backups, forgetting old
  messages, a recurring payment.

### d3. Extensions bring server functions, under the same isolation

The extension format gains, in `thecms.extension/2`:

- **routes**: public addresses under `/_/x/<extension>/`, such as a payment
  provider's confirmation;
- **jobs**: work at an interval, such as syncing stock;
- **events**: what it listens to from the core, such as `order.paid` or
  `comment.created`.

Isolation stays as ADR 0026 d4 sets it. An extension's code runs apart from
the runtime and reaches only the collections and the hosts it declared; the
owner accepts the exact file. On a server: a process for each extension,
under a user of its own, started by systemd, with no network but its declared
hosts. On Workers: a Worker for each extension, bound to the runtime by a
service binding only, with no access to the database. No extension runs
inside the runtime's process: there is no back door to make convenient.

### d4. The order

Four stages, each ending with something an owner can use, each part with its
own record:

1. **The dynamic foundation, and what WordPress has alone.** The runtime on a
   server, with the form service moved into it; extensions 2 (routes, jobs,
   events); scheduled publication; comments with moderation; search; private
   and password-protected pages; blocks for embeds, tables, buttons, video,
   audio and files; PDFs and documents in the media library.
2. **What almost every site needs.** A form builder; complete SEO (an SEO
   title, an Open Graph image, noindex, breadcrumbs); scheduled backups;
   relations between entries and more kinds of field; statistics without a
   cookie; entries in more than one language; the author and contributor
   roles; archives by author and date; the site's data as JSON in the export
   and a complete export of the site.
3. **Commerce and members.** Visitor accounts; the shop (products, cart,
   orders, VAT, emails); payment extensions (Stripe and Netopia first),
   couriers, e-Factura; memberships and subscriptions; bookings; newsletters;
   the runtime on Workers. What is in the program and what is an extension,
   and the order within the stage: ADR 0060.
4. **Further.** Courses; a forum, as an extension; several sites from one
   installation, for managed hosting.

### d5. Decided with the owner

- The shop's core (products, cart, orders, VAT) is in the program;
  payments, couriers and invoicing are extensions (as ADR 0026 d1 already
  said of a cart and payments).
- The first payment providers are Stripe and Netopia.
- Comments are in the program, in stage 1.
- The runtime runs on a server first; Workers follows in stage 3.

## What changes in the earlier records

ADR 0001 d2 and the backend line of d9, ADR 0010 d4's "for presentation
sites", and the opening lines of ADR 0013 and ADR 0017 carry a note that
points here. Their text is kept, as the earlier reasoning.

## Not decided here

Each part of stage 1 gets its own record when its work begins: the runtime's
routes and how a host is set up for them, the comment's shape and its
moderation, how search indexes a site too large for one file.
