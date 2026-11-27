# ADR 0081 — Invoices: the shop asks, an extension for the country makes them

- **Status:** Proposed (David, 2026-11-27: Uhlaka is international, not
  Romanian; "cine își dorește să aibă 2 aplicații de facturare?"; "întâi
  partea generică separat, și apoi integrarea pe fiecare țară (deocamdată
  România) ca altă extensie")
- **Date:** 2026-11-27
- **Changes:** ADR 0076 d3 and d5 step 4 ("e-Factura" becomes "invoicing",
  d1–d3 below); ADR 0065 d4 ("for e-Factura later")
- **Builds on:** ADR 0065 (the shop), ADR 0076 d4 (questions, actions on an
  order, jobs, files), ADR 0079 (the couriers, the same shape)

Uhlaka is made for any country. e-Factura is ANAF's and only Romania's;
Italy, Poland, Belgium, Germany and France each have their own. A shop's
owner already keeps their invoices in an invoicing app, which numbers them,
keeps the books and reports them to the country. Nobody wants a second one
inside the site. So Uhlaka makes no invoice itself: it asks for one, and an
extension for the owner's country gets it from the owner's app.

## Decisions

### d1. Two parts, kept apart

1. **The generic part**, knowing no app and no country (d2).
2. **An extension for each country**, which knows that country's apps and
   talks to the one the owner chose (d4). The first is Romania.

Extensions do not depend on one another (ADR 0076 d4): the country's
extension talks to the program only, as a courier does.

### d2. The generic part is the shop's, off until turned on

In the shop's settings, **Invoices**, off by default. Turned on, the shop:

- asks for an invoice **by itself** when the order is paid (`order.paid`),
  or, for an order paid on delivery, when it is sent; or only by hand, as
  the owner chooses;
- gives the order a button, **Make the invoice**, which makes one once:
  asked again, it says the invoice the order has;
- keeps the invoice on the order: its series and number, a link to it in
  the app, and its PDF, which the buyer sees on the order's page;
- asks for a **storno** of it when the order is refunded;
- tries again later what fails (`host.later`'s way), and says in the log
  when it gives up;
- lists the invoices in the Orders screen (number, order, state).

It keeps one invoice for an order (the order unique), written before the
extension is asked, so two asks never make two invoices.

### d3. The question an extension answers

`invoice.make`, given the order as an extension that uses `orders` reads
it, answers `{ series, number, link?, pdf? }` (the PDF in base64), or throws
what the app said. `invoice.storno`, given the order and the invoice, answers
the storno invoice the same way. One extension answers them on a site; a
second one installed is refused while the first is on.

### d4. Romania: `extensions/invoicing-ro`

In its settings the owner chooses the app, from a list: **Oblio** first,
then SmartBill and FGO, each a small piece of code in the extension. The
account's keys are the extension's secrets. It declares the hosts of its
apps only (`www.oblio.eu` for Oblio).

What it sends: the buyer, or the company with its tax code and registration
number; each line as bought (name, code, quantity, price with VAT, VAT
rate); delivery as a line; a coupon as a discount; the currency; whether it
was paid, and how; the order's number in the mentions. The app makes the
invoice with the owner's series, and sends it to e-Factura (SPV) when the
account is set so there.

### d5. Permissions

None new. The country's extension uses `orders`; who may press the button
is the program's rule for the Orders screen.

### d6. The order of the work

1. This ADR and the generic part (d2, d3), one PR.
2. `invoicing-ro` with Oblio, one PR.
3. SmartBill and FGO, later.

## Not decided here

- VAT by the buyer's country (OSS in the EU) and more than one currency.
- The buyer's country on the order, needed by apps outside Romania; added
  with the first of them.
- Sending straight to ANAF or Peppol without an app.
