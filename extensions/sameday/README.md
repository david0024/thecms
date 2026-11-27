# Sameday

Delivery by Sameday (ADR 0079): its price at checkout, easybox lockers, the
AWB with its label and cash on delivery, and the parcel followed until it is
delivered.

1. Pack it: `bun tools/pack-extension.ts extensions/sameday`, then install
   the file in Extensions.
2. In Extensions → Sameday, add the user and password of the API account
   Sameday gives with the contract. To try it first, tick "Sameday's demo
   account" and use the demo's user and password.
3. Choose the price of delivery: **fixed** (the default; checkout never
   waits for Sameday) or **courier** (Sameday's estimate for the parcel's
   weight and the buyer's town; the fixed price stands in when Sameday does
   not answer).
4. Give products their weight (the product's form, in kilograms).

The AWB is made from the account's default pick-up point and contact person,
with the 24H service to the door and Locker NextDay to an easybox, both found
among the account's services. **Make the AWB** in the Orders screen, or "by
itself" in the settings, works as with Fan Courier: the label (PDF) on the
order, the cash to collect when it is paid on delivery, then Sent and
Completed as Sameday reports the parcel.

Sameday's API is called as its documentation describes: `/api/authenticate`,
`/api/client/pickup-points`, `/api/client/services`, `/api/client/lockers`,
`/api/awb/estimate-cost`, `/api/awb`, `/api/awb/download/<awb>` and
`/api/client/awb/<awb>/status`. The tests answer it in their place; try the
first orders with the demo account.
