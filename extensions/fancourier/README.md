# Fan Courier

Delivery by Fan Courier (ADR 0079): its price at checkout, FANbox lockers,
the AWB with its label and cash on delivery, and the parcel followed until it
is delivered.

1. Pack it: `bun tools/pack-extension.ts extensions/fancourier`, then install
   the file in Extensions.
2. In Extensions → Fan Courier, add the account of the contract: the user and
   password of selfawb.ro, and the client id (in selfawb.ro, under the
   account's details).
3. Choose the price of delivery:
   - **fixed** (the default): the price to the door and to a FANbox, and,
     if you want, a sum from which delivery is free. Checkout never waits for
     Fan Courier.
   - **courier**: Fan Courier's tariff for the parcel's weight and the buyer's
     town, asked once the address is typed. If Fan Courier does not answer,
     the fixed price is offered instead.
4. Give products their weight (the product's form, in kilograms). Without
   one, a parcel weighs what the settings say (1 kg unless changed).

In the Orders screen, **Make the AWB** makes it, puts the label (PDF) on the
order and gives the order its tracking number. With "Make the AWB by itself"
on, it is made when the order is paid, or as soon as it is placed when it is
paid on delivery; the cash to collect is the order's total, sent as Fan
Courier's "Cont Colector" service. To a FANbox, the service is "FANbox".

After the AWB, the parcel is asked about every three hours: when Fan Courier
has taken it, the order becomes **Sent** and the buyer gets the e-mail with the
AWB; when it is delivered, the order becomes **Completed**. A parcel is
followed for 30 days at most.

Fan Courier's API (v2, `api.fancourier.ro`) is called as its documentation
describes: `/login`, `/reports/awb/internal-tariff`, `/reports/pickup-points`,
`/intern-awb`, `/awb/label` and `/reports/awb/tracking`. The tests answer it
in their place; try the first orders with a test account.
