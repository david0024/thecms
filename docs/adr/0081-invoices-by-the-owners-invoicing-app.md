# ADR 0081 — Invoices are made by the owner's invoicing app; Oblio first

- **Status:** Proposed (David, 2026-11-27, chose: "cine își dorește să aibă 2
  aplicații de facturare? dar se pot trimite datele în Oblio de exemplu care
  să genereze factura?")
- **Date:** 2026-11-27
- **Changes:** ADR 0076 d3 and d5 step 4 ("e-Factura" becomes "invoicing
  apps"); ADR 0065 d4 ("for e-Factura later")
- **Builds on:** ADR 0065 (the shop), ADR 0076 d3–d5, ADR 0079 (the couriers,
  the same shape)

Uhlaka is made for any country, not for Romania. e-Factura is ANAF's system
and only Romania's; Italy, Poland, Belgium, Germany and France each have
their own, and more come. A shop's owner already keeps their invoices in an
invoicing or accounting app, which numbers them, keeps the books and reports
them to their country. Nobody wants a second one inside the site.

## Decisions

### d1. Uhlaka makes no invoices

The shop keeps orders (ADR 0065 d7). An invoice is made by the owner's own
invoicing app, from the order, through an extension for that app. Uhlaka has
no series, numbers, invoice PDF of its own, nor any country's reporting
(e-Factura, SDI, KSeF, Peppol). These are the app's work, and the app's
country.

### d2. One extension for each app, the first Oblio

`extensions/oblio`, packed and installed as the couriers are. Later, on the
same shape: SmartBill, FGO (Romania), and apps used elsewhere (Xero,
QuickBooks, others), each its own extension, none depending on another.

### d3. Oblio: what it keeps, and where

In the extension's settings, as secrets of its own: the account's e-mail and
API secret (Oblio, Settings › Account data), the company's tax code as Oblio
knows it, the invoice series, and the management (*gestiune*) when Oblio
keeps the stock. Oblio's token is asked for with those and kept by the
extension until it ends.

### d4. When the invoice is made

- **By itself** (the default): when the order is paid (`order.paid`). An
  order paid on delivery is invoiced when it is completed, or by the button.
- **A button on the order**: **Make the invoice**, once (asked again, it says
  the invoice the order has).
- What fails (Oblio not answering, a token that ended) is tried again later
  with `host.later`, and said in the log when it gives up.

### d5. What is sent

From the order: the buyer (name, e-mail, phone, address with town and
county; the company's name, tax code and registration number when buying as
one), each line as bought (name, code, quantity, price with VAT, VAT rate),
delivery as a line, a coupon as a discount, the currency, and the payment
(card or transfer as collected, cash on delivery as not yet). The order's
number goes in the invoice's mentions.

### d6. What comes back on the order

The invoice's series and number and Oblio's link to it, kept in the
extension's collection `invoices` (one row an order, `order` unique, made
before Oblio is asked, so two asks never make two invoices). The PDF is
downloaded from Oblio and kept on the order as a file (ADR 0076 d4.4), so the
buyer sees it on the order's page. Oblio sends it to e-Factura when the
account is set so in Oblio; the extension does not.

### d7. Refunds and cancelling

When an order is refunded (`order.refunded`), the extension asks Oblio for a
storno invoice of the one it made; a cancelled order that was never invoiced
needs nothing.

### d8. What the program adds

Nothing new is expected: events, actions on an order, jobs queued once, files
and a unique field are in format 4 (ADR 0076 d4). If building it shows a
lack, it is named in "As built".

### d9. Permissions

None new. The extension uses `orders`; its only egress is `www.oblio.eu`;
who may press the button is the program's rule for the Orders screen.

## Not decided here

- VAT by the buyer's country (OSS in the EU) and more than one currency: the
  shop's base, a record of their own.
- The buyer's country on the order: needed by apps outside Romania; added
  with the first of them.
- An extension that sends straight to ANAF or Peppol without an app.
