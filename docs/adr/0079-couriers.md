# ADR 0079 — The couriers: Fan Courier, Sameday and Cargus, each an extension

- **Status:** Accepted (David, 2026-11-27: "Da, cum ai propus")
- **Date:** 2026-11-27
- **Builds on:** ADR 0065 (the shop), ADR 0076 d3–d5 (providers as extensions,
  the format `uhlaka.extension/4`, the order of the work)

A Romanian shop sends its parcels by courier. The three most used by small
shops are Fan Courier, Sameday and Cargus. ADR 0076 put them after the payment
providers, as extensions in the fourth format. This ADR says what they do and
the little the program adds for them.

## Decisions

### d1. Three extensions, one for each courier

`extensions/fancourier`, `extensions/sameday` and `extensions/cargus`, packed
and installed as Stripe and NETOPIA are. An owner installs the one they have a
contract with, or more than one. Each keeps its own account (user, password,
client or API key) as secrets in its own settings; no courier's key is seen by
another extension or by the program. None depends on another (ADR 0076 d4).

### d2. The price of delivery: the owner's, unless they choose the courier's

In the extension's settings the owner chooses how delivery is priced:

- **A fixed price** (the default): the owner's price for delivery to the door
  and, where the courier has them, to a locker, and a sum above which delivery
  is free. Selling never depends on the courier's servers being up.
- **The courier's price**: the extension asks the courier what the cart costs
  to send to the buyer's town, by its weight (d6). When the courier does not
  answer in time, the fixed price is offered instead, so a buyer can always
  finish the order.

### d3. Lockers, chosen at checkout by the buyer's town

Where the courier has lockers (Fan Courier's FANbox, Sameday's easybox,
Cargus's Ship & Go), the extension answers them at checkout as places to pick
up (`<extension>:locker:<point>`), the ones in the buyer's town, at most 20.
The buyer picks one; the order keeps its address as the place it is picked up.

### d4. The AWB: a button on the order, or made when the order is paid

- An action on the order, in the Orders screen: **Make the AWB**. It is made
  only for an order delivered by this extension's ways, once (asked again, it
  says the AWB the order has).
- Optional, in the settings: **make the AWB by itself** when the order is paid
  (`order.paid`), or as soon as it is placed when it is paid on delivery
  (`order.made` with payment `cod`). What fails is tried again later
  (`host.later`), and said in the log when it gives up.
- The weight sent is the order's (d6), or the owner's default weight for a
  parcel when products have none.
- When the order is paid on delivery (`cod`), the cash to collect (*ramburs*)
  is the order's total, filled in by itself.
- The label is a PDF kept on the order (ADR 0076 d4.4), downloaded by the
  owner from the order; the AWB number is the order's tracking number.

### d5. Following the parcel, and telling the buyer

After an AWB is made, a job queued once asks the courier where the parcel is,
every few hours. When the courier has taken it, the order moves to **Sent**
and the buyer gets the "Order sent" e-mail with the tracking number; when it is
delivered, the order moves to **Completed**. It stops once the parcel is
delivered or returned, or after 30 days. The owner can still move the order by
hand in the Orders screen.

### d6. What the program adds

1. **The weight of a product**, typed in kilograms (`0,5`), kept in grams; a
   combination may have its own. Each line given to `checkout.delivery`, and
   each line of an order placed from now on, carries its `weight` (grams, for
   one; 0 when not given).
2. **`orders.sent(id, tracking)` and `orders.completed(id)`** for an extension
   that uses `orders`, beside `paid`, `refunded` and `tracking`. Asking for a
   state the order already has, or has gone past, changes nothing; a cancelled
   or refunded order stays so.
3. **A binary answer from `host.fetch`**: with `as: "base64"` the body comes
   back as base64, so that a label's PDF arrives whole.

### d7. The order of the work

1. This ADR and d6, one PR.
2. Fan Courier, one PR.
3. Sameday, one PR.
4. Cargus, one PR.

## Not decided here

- Returns, parcels in more than one box, delivery outside Romania, asking the
  courier to come for the parcel at an hour (the contract's daily pick-up is
  assumed).
- Showing the lockers on a map: a list by town is enough for a first version.

## As built

- **d6 (2026-11-27):** `weight` on a product and on a combination, typed in
  kilograms in the product's form (a number is read as grams, as an import
  may give it); `weightFor(product, variant)` in the core. `checkout.delivery`
  is given each line's `weight` and the cart's `weight` in all. An order's
  lines keep `weight`. `orders.sent` moves an order from waiting, paid or
  preparing to sent, with its tracking number, and the buyer gets "Order
  sent"; on an order already sent it only adds a tracking number it lacks.
  `orders.completed` moves it from any of those, or from sent, to completed.
  `host.fetch(url, { as: "base64" })` gives the bytes in base64, at most 5 MB.
- **Fan Courier (2026-11-27):** `extensions/fancourier`, with what the three
  share in `extensions/courier/courier.ts`, bundled into each when packed.
  Ways answered: `fancourier:home` and `fancourier:locker:<FANbox id>`. The
  settings: user, password, client id; price `fixed` or `courier`; the fixed
  prices in lei; free from a sum; a parcel's weight when products have none;
  lockers on or off; the AWB by itself. Its collection `shipments` keeps one
  row an order (`order` unique), made before Fan Courier is asked, so two
  asks at once do not make two AWBs. Cash on delivery is the service "Cont
  Colector" with `cod`; a FANbox is the service "FANbox" with the locker's id
  as `pickupLocation`. The parcel is asked about two hours after the AWB, then
  every three hours. The API was written from Fan Courier's documentation and
  answered by the tests; it has not yet been tried with a real account.
- **Sameday (2026-11-27):** `extensions/sameday`. Ways answered:
  `sameday:home` and `sameday:locker:<easybox id>`. The settings: user,
  password, and Sameday's demo account for trying it (its own host,
  `sameday-api.demo.zitec.com`). The AWB is made from the account's default
  pick-up point and contact person, with the service whose code is `24`
  (24H) to the door, and `LN` (Locker NextDay) with `lockerLastMile` to an
  easybox; the courier's price is `/api/awb/estimate-cost`. Not yet tried with
  a real account.
