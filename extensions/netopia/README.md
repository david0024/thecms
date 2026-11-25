# NETOPIA Payments

Card payments at checkout through NETOPIA Payments, API v2 (ADR 0076 d5).

1. Pack it: `bun tools/pack-extension.ts extensions/netopia`, then install the
   file in Extensions.
2. In NETOPIA's admin (sandbox first: <https://sandbox.netopia-payments.com>):
   Profile → Security gives the API key; the point of sale gives its
   signature (`XXXX-XXXX-XXXX-XXXX-XXXX`) and NETOPIA's public key (the
   `.cer` file). Put all three in Extensions → NETOPIA Payments; leave
   "Test account" ticked until the live account is approved.
3. Nothing to set for the notices: each payment tells NETOPIA to send them to
   `https://<your site>/_/x/netopia/notify`. The site's address must be set
   in Settings.

A notice is believed only with its `Verification-token`: a JWT NETOPIA signs
with RS512, for this point of sale, over the notice's body. NETOPIA's status
API is announced for later, so an order is marked paid by the notice only.

Before the first live sale: one payment in the sandbox, to see that the
amount (sent with two decimals, `125.50`) and the notice arrive as written
here; NETOPIA's documentation is not explicit on either.
