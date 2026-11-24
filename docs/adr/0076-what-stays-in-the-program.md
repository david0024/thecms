# ADR 0076 — What stays in the program, and what an extension needs to take the rest

- **Status:** Accepted (owner, 2026-11-24, by Liviu: "da, este de acord", on the four points: the shop's base stays a part, subscriptions become an extension, the format gains d4 before Stripe, courses and a forum are extensions; asked by Liviu: "toate acestea ar trebui să stea în extensii astfel încât core-ul să rămână slim")
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

### d1b. The rule for what stays in the program

Taken from Zveltio's ADR 0049 ("what stays in the engine", 2026-11-14),
adapted. A feature stays in the program only if at least one holds:

- (a) it decides who may see or do what, or it is the way data is kept and
  served (content, pages, files, accounts and members);
- (b) it must run as the program itself: the database's tables, backups,
  updates, building and serving the site;
- (c) it confines code the program did not write (the extension runner).

Everything else is an extension, and leaves the program only once what it
needs from the program exists; a feature that cannot leave names what it
lacks, and that is the program's work. The shop's base (d2) is held by that
last clause: it stays a part until extensions can draw public pages in the
theme and take stock in one step with an order, not by a rule of its own.

Zveltio's own extensions run inside its engine for one reason its ADR 0056
(2026-11-16) gives: memory on a small server (a process each costs about
60 MB). Its owner's rule there is that an operator's bad code must never take
the instance down, and its failures must name the extension. Uhlaka's
extension processes stop after five minutes unused, so the reason does not
carry over.

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

### d6. Parts: our own code, shipped with the program, turned on like an extension

Zveltio has two kinds of extension. **First-party** (its 54 official ones)
runs inside the engine, with the engine's database pool and transactions,
trusted because the registry signed it; its reach beyond `host` is a named
list a gate checks. **Third-party** runs on the runner, under a user of its
own, through `host` only. Its shop and its Stripe billing are first-party.

Uhlaka gets the useful half of that without a second contract: a **part**.
A part is our own code that ships inside the program (so the program's own
release is its signature, and no registry or check at load is needed), runs
in the program's process with its tables and transactions, and is turned on
and off by the owner. The Extensions screen lists the parts beside the
extensions, so to the owner the shop is "an extension of Uhlaka" that is
off until wanted; under the hood it is ADR 0060 d3.

- **The list of parts is closed and small**: the shop's base and visitor
  accounts with members. A part is added only by a new record the owner
  accepts, and only for what several extensions hang on. **Every new
  feature is an installable extension**: the site's owner adds it from a
  file, without updating Uhlaka (unless it needs a newer extension format),
  and a site that does not install it carries none of it.
- A part that is off runs nothing: its module is not imported, its tables
  do not exist, its addresses answer 404 (ADR 0060 d3; guarded by "the
  shop, off" and "visitor accounts, off" in the tests). Only its tables'
  definitions, a few lines of text, are read at start.
- Many extensions installed do not weigh on the server either: each one's
  process starts when one of its actions runs and stops after five minutes
  unused (ADR 0026 d4).
- The code moves under `src/parts/shop/` and `src/parts/visitors/`, each
  reaching the program by one module, so the core can be read from the tree.
- A part is never written by a third party, and no third-party extension
  becomes a part: providers (Stripe, Netopia, couriers, e-Factura) stay
  isolated extensions, since they hold the site's keys and talk to the world.

What a full first-party tier (ours, installed separately, inline) would
cost beyond this: a signature checked at every load (a name can be faked),
a second interface into the program that can no longer change freely, a
release and an update for each package, and the crash and memory of
in-process code with none of the separation the owner was promised. That is
what ADR 0060 d4 refused; a part has the same speed and the same
reach, without those costs.

### d7. Deno where the server's isolation is missing

Zveltio runs its extensions' jobs in Deno (its ADR 0022, 2026-11-05): one
process a job, **with no permission at all** (no network, files, environment
or programs), talking to the engine on stdin and stdout; the engine makes
every call to the outside for it, and on Linux a seccomp filter forbids
sockets (its ADR 0023). Its routes and actions run on its Bun runner.

Uhlaka's runner (ADR 0026 d4) has the same shape: an empty environment, the
program makes every call to the outside. On a server, systemd adds a user of
its own, no network (`PrivateNetwork`, only `AF_UNIX`), a read-only system
and 512 MB at most: the kernel's boundary, as strong as Zveltio's. On one's
own computer and in Docker it is a plain Bun process, which can read what
that person can.

Proposed: the runner starts the extension's process with Deno, with no
permission, wherever systemd's isolation is not there (Windows, macOS,
Docker, a platform); on a server systemd stays and Deno runs inside it.
Deno is fetched the first time an extension is turned on, checked by its
checksum, never shipped with every install. Before it is built, a
measurement on a small VPS: the start of a process, the memory of one at
rest and at work, against today's Bun process (Zveltio measured 31 ms and
about 60 MB). It does not block d4 or payments.

## Weighed and not proposed

- **The shop's base as an extension now**: see d2. To revisit if a second
  shop (another model of selling) is ever wanted beside ours.
- **A first-party tier installed apart**, as Zveltio's: see d6 for its cost;
  the parts give its speed and reach without it.
- **Rules as expressions (CEL)**: nothing in d3 needs them.
