# Invoicing (Romania)

The shop's invoices made by your invoicing app (ADR 0081 d4): Oblio for now,
SmartBill and FGO later. The app numbers the invoice with your series, keeps
it and sends it to e-Factura (SPV) when your account is set so; Uhlaka keeps
its PDF on the order, where the buyer sees it.

1. Pack it: `bun tools/pack-extension.ts extensions/invoicing-ro`, then
   install the file in Extensions.
2. In Extensions → Invoicing (Romania), add the Oblio account: its e-mail,
   its API secret (in Oblio, Setări → Date cont), the company's CIF and the
   series of the invoices. A storno series is optional (empty: the same
   series). Give the warehouse (gestiune) only when Oblio keeps your stock.
3. In Settings → Shop → Invoices, choose when they are made: by themselves
   when an order is paid (sent, when paid on delivery), or only by the
   button on the order.

To have them in SPV, turn on sending to e-Factura in your Oblio account.

What Oblio is sent: the buyer (or the company, with its CIF and registration
number), each line with its price with VAT and its rate, the coupon as a
discount, delivery as a line, the currency, the order's number, and how it
was paid (a transfer as `Ordin de plata`, a card as `Card`, cash on delivery
as `Ramburs` once the order is completed). A refunded order gets a storno of
its invoice.

Oblio's API (`www.oblio.eu/api`) is called as its documentation describes:
`/authorize/token` and `/docs/invoice`. The tests answer it in its place; try
the first invoices on a real account and look at them in Oblio.
