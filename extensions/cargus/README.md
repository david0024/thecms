# Cargus

Delivery by Cargus (ADR 0079): its price at checkout, Ship & Go lockers, the
AWB with its label and cash on delivery, and the parcel followed until it is
delivered.

1. Pack it: `bun tools/pack-extension.ts extensions/cargus`, then install the
   file in Extensions.
2. In Extensions → Cargus, add the API key (the subscription key from Cargus's
   developer portal, urgentcargus.portal.azure-api.net), and the user and
   password of the account. The pick-up point the courier comes to is the
   account's first, unless you give its id.
3. Choose the price of delivery: **fixed** (the default; checkout never
   waits for Cargus) or **courier** (Cargus's calculation for the parcel's
   weight and the buyer's town; the fixed price stands in when Cargus does not
   answer).
4. Give products their weight (the product's form, in kilograms).

The AWB is made with the Standard service (34) to the door, and Ship & Go
(38) to a point. **Make the AWB** in the Orders screen, or "by itself" in the
settings, works as with Fan Courier: the label (PDF) on the order, the cash to
collect when it is paid on delivery, then Sent and Completed as Cargus reports
the parcel.

Cargus's API is called as its documentation describes: `/LoginUser`,
`/PickupLocations`, `/PudoPoints`, `/ShippingCalculation`, `/Awbs`,
`/AwbDocuments` and `/AwbTrace`. The tests answer it in their place; try the
first orders with a test account.
