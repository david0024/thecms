# ADR 0060 — Stage 3: what is in the program, what is an extension, and in what order

- **Status:** Accepted (owner, 2026-11-22: "facem cum propui", on the proposal below, after asking whether a shop in the program costs the sites that do not sell, and how Zveltio's first-party model would compare)
- **Date:** 2026-11-22
- **Changed by:** ADR 0076 (subscriptions are an extension; the format gains more before Stripe; parts)
- **Builds on:** ADR 0037 (direction; d4 stage 3, d5), ADR 0026 (extensions), ADR 0041 (extensions on the server), ADR 0043 (pages behind a password), ADR 0044 (the site is served), ADR 0053 (statistics)

Stage 3 of ADR 0037 d4 is commerce and members: visitor accounts, the shop,
payment extensions, couriers, e-Factura, memberships and subscriptions,
bookings, newsletters and the runtime on Workers. Before any of it is built,
this record says which part lives in the program and which is an extension,
what the extension format must gain first, and the order. Each step still
gets its own record when its work begins.

## Decisions

### d1. In the program

What several features share, and what most sites of the kind need alike:

- **Visitor accounts**: signing up, signing in, a forgotten password, the
  visitor's own page. Apart from the admin's accounts, never reaching
  `/admin` (ADR 0037 d2).
- **Members**: levels of access, and pages for members only (the "private"
  that ADR 0043 d4 left for this stage).
- **E-mail to visitors**: messages from templates, through the site's own
  mail server (ADR 0019 d3), in the visitor's language.
- **The shop**: products, stock, cart, checkout, orders, VAT, coupons, the
  order's e-mails. ADR 0037 d5 already put it here; this record keeps it.
- **Subscriptions**: a product that renews and gives a member level. The
  charge itself is made by the payment provider's extension.
- **The runtime on Cloudflare Workers**, with the Cloudflare step of the
  installer (ADR 0048).

### d2. As extensions

What depends on a provider, or what a site of one kind needs and others do
not: **Stripe**, **Netopia**, the **couriers** (Fan Courier, Sameday,
Cargus), **e-Factura**, **bookings** and the **newsletter**. A new provider
is added without touching the program.

The shop was weighed as an extension and stays in the program. Payments,
couriers, invoicing, subscriptions and bookings all hang on orders; a shop
outside the program would need extensions that depend on one another and an
extension that draws the public pages, the cart and checkout, which would be
close to a second program.

### d3. A part that is off costs nothing

The shop, visitor accounts, members and subscriptions are each off until the
owner turns them on. While one is off:

1. **Its code is not loaded.** It is a module of its own, imported the first
   time the part is turned on, and at start only when it is on.
2. **Its tables do not exist.** They are made the first time the part is
   turned on; before that there is no table and no query.
3. **Its addresses do not exist.** `/_/cart`, `/_/checkout` and the others
   answer 404, as an unknown address does, without touching the database.
4. **The admin does not show it**: no menu, no price field.
5. **A test guards the rule**: a site with the part off loads none of its
   module and has none of its tables.

Pages are built once at publication and served from that build (ADR 0044),
so a visit runs nothing of the shop even when it is on. A product's page is
built HTML; price and stock are checked at checkout. What stays is the code
on disk, a few hundred KB.

### d4. Not Zveltio's first-party model

Zveltio runs its official extensions inside the engine, with every right,
and so needs signatures, a registry and a check of every file at each load.
For the shop that would give the same speed as d3, no isolation, and a second
kind of extension with an internal interface that can no longer change
freely. ADR 0026 d1 stays: every extension is third-party. A module of the
program loaded only when it is on is what a first-party extension would be,
without that cost.

### d5. What the extension format gains first (`thecms.extension/3`)

Today an extension reaches only its own collections, hears five events, and
a route answers with text. Before the extensions of d2:

1. **More events**: an order made, paid, refunded and sent; an account made;
   a subscription renewed and ended; a page served (for statistics).
2. **Providers the program asks and waits for**: a payment ("where is the
   customer sent?", then its confirmation), a delivery ("what does this cart
   cost to send?"), an invoice ("issue it"). This is the hook that decides,
   which ADR 0041 left for the shop's needs.
3. **Declared access to the program's data**, shown to the owner at install
   like collections and hosts: an order (read it, mark it paid or refunded,
   set its tracking number), a visitor's member level, an e-mail sent to a
   visitor through the site's templates, an order made (for a booking).
4. **The signed-in visitor on a route**: the action is told the visitor's id,
   never the session cookie.
5. **Public blocks as data** (a booking form, a newsletter sign-up), drawn
   with the site's theme and posting to the extension's route, and a route
   that answers a page drawn in the site's layout instead of bare text.
6. **New kinds of screen**: a chart and a calendar (ADR 0031).
7. **Each extension as a Worker** of its own on Cloudflare, bound to the
   runtime by a service binding only (ADR 0037 d3).

The isolation of ADR 0026 d4 does not change.

### d6. The order

1. The extension format gains d5 points 1 to 6, and the statistics move into
   an extension, as ADR 0053 d4 planned, to prove it.
2. Visitor accounts, members and e-mail to visitors.
3. The shop.
4. Stripe and Netopia.
5. The couriers and e-Factura.
6. Subscriptions.
7. Bookings.
8. The newsletter.
9. The runtime on Cloudflare Workers, with d5 point 7, and the Cloudflare
   step of the installer.

Nothing of stage 3 is left for later.

## What changes in the earlier records

ADR 0037 d4 stage 3 and ADR 0053 d4 point here. ADR 0041's "Not yet" is
answered by d5.
