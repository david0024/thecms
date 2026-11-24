# ADR 0076 — What stays in the program, and what an extension needs to take the rest

- **Status:** Proposed (for the owner; asked by Liviu, 2026-11-24: "toate acestea ar trebui să stea în extensii astfel încât core-ul să rămână slim")
- **Date:** 2026-11-24
- **Builds on:** ADR 0026 (extensions), ADR 0041 (extensions on the server), ADR 0060 (stage 3: core and extensions), ADR 0062 (extensions 3), ADR 0064 (visitor accounts), ADR 0065 (the shop)
- **Changes, if accepted:** ADR 0060 d1 (subscriptions leave the program), d5 and d6 (the format gains what is below before Stripe)

Before payments are built, Liviu asked whether the large features (payments,
couriers, e-Factura, the shop, subscriptions, bookings, newsletters, courses,
a forum) should all be extensions, on Zveltio's model, so the program stays
slim. This record compares the two models as they stand today and proposes
where each feature lives.

## The two models today

Zveltio (`zveltio-devs/zveltio`, RFC "extension model v3", accepted
2026-10-17 and amended 2026-11-16; its ADR 0042 for screens):

- an extension declares **collections** (the engine makes real tables, with
  indexes, relations, grants and audit; no SQL), **actions** (synchronous,
  in the request's transaction, no network), **jobs** (asynchronous, queued
  in an outbox at commit, retried, optionally on a cron), **routes** (few,
  fail-closed) and **views as data**;
- `host` is its only way in: collections with declarative filters,
  `host.enqueue`, `host.actions.run` for another extension's action with the
  dependency declared;
- only Zveltio's own code runs inline; every third party runs on a separate
  runner under a user of its own, jobs in Deno with no network (the engine
  fetches for them); packages are signed and checked at every load.

Its shop (`ecommerce/store`) and its Stripe billing (`billing`) are
extensions, but first-party ones, inline, with write access to the data.
Zveltio's v3 record counts what running third parties with a first-party
reach cost it: about 4,400 lines of bridge and half of the extensions'
commits in fixes, and it moved every third party to one isolated contract.

Uhlaka (ADR 0026, 0041, 0062) already has that contract, stricter: every
extension is third-party, ours too. It has declared collections, actions,
routes under `/_/x/`, jobs at an interval, events, questions the program
waits for (`comment.check`), the program's data lent by name (`published`,
`members`, `mail`, `orders`), screens and public blocks as data, the
signed-in visitor on a route, and a process of its own with an empty
environment. It lacks dependencies between extensions, signatures, queued
jobs and collections that can be searched.

## Decisions (proposed)

### d1. The model stays ADR 0026's

Every extension is third-party and isolated; none runs inside the program.
Zveltio reached the same rule for everyone but itself, and the program has
no "own" extensions that would need more.

### d2. In the program

What other features hang on, each off until the owner turns it on, at no cost
while off (ADR 0060 d3):

- content, pages, themes, media, forms, comments, search;
- visitor accounts, members, the mail queue;
- **the shop's base**: products as entries that sell, stock, cart, checkout,
  orders, VAT, coupons (ADR 0065).

The shop's base was weighed as an extension again. Isolated, it would need
the program to lend it the public cart and checkout in the theme, a cookie,
fields of its own on entries, stock taken in the order's transaction, data
for search engines, pages built again, backup and export; and the payment
extensions would then depend on it. That is most of the program behind
`host`, which is the bridge Zveltio paid for. Off, it costs nothing.

### d3. As extensions

Stripe, Netopia, the couriers, e-Factura, **subscriptions** (out of the
program: an extension keeps its plans, offers a public block, sends the buyer
to the provider in subscription mode, and gives or takes a member level by
`members`), bookings, the newsletter, courses (LMS) and a forum.

### d4. The format `uhlaka.extension/4`

Before the first of d3, the format gains, each shown on Stripe or a courier:

1. **Questions at checkout.** `checkout.payment`: the methods it offers, then
   where the buyer is sent to pay; the confirmation arrives at its route and
   marks the order paid by `orders.paid`. `checkout.delivery`: the options and
   prices for a cart and an address, and pick-up points where there are some.
2. **Actions on an order**, offered in the Orders screen (an AWB, an invoice,
   a refund), as actions are offered on a block or a page.
3. **Jobs queued once**: `host.later(action, input, minutes)`, kept in the
   database, retried with a growing wait, said in the log when they give up
   (an invoice's status at ANAF, an AWB that failed).
4. **Files of an extension**: an invoice's PDF, a label; kept by the program,
   downloaded by the owner, the invoice shown to the buyer on the order's page.
5. **Collections that can be searched**: a filter on fields, an order, a
   limit and a count, and a field declared unique; the program writes every
   query.
6. **Take if enough is left**: `host.take(collection, id, { field: n })`, in
   one step, refused when it would go below zero (seats, numbers in a series).

Dependencies between extensions are not added: with the shop's base in the
program, each provider talks to the program only.

### d5. The order

1. The format of d4.
2. Stripe, then Netopia.
3. The couriers.
4. e-Factura.
5. Subscriptions.
6. Bookings and the newsletter; then courses and a forum.
7. Later: a publisher's signature on packages and a list of extensions on
   uhlaka.org (ADR 0026 "Not decided here").

### d6. The parts made visible in the code

The shop's and the visitor accounts' code moves under `src/parts/shop/` and
`src/parts/visitors/`, each reaching the rest of the program by one module.
What is the program and what is an optional part can then be read from the
tree, and a part could leave for an extension later without finding its
edges first.

## Weighed and not proposed

- **The shop's base as an extension now**: see d2. To revisit if a second
  shop (another model of selling) is ever wanted beside ours.
- **First-party extensions inline**, as Zveltio's own: refused by ADR 0026
  d1 and ADR 0060 d4, and nothing here needs them.
- **Rules as expressions (CEL)**: nothing in d3 needs them.
