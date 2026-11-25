# Stripe

Card payments at checkout through Stripe Checkout (ADR 0076 d5).

1. Pack it: `bun tools/pack-extension.ts extensions/stripe`, then install the
   file in Extensions.
2. In Extensions → Stripe, add the secret key (Stripe dashboard → Developers →
   API keys). A test key (`sk_test_…`) takes test cards only.
3. In Stripe's dashboard → Developers → Webhooks, add an endpoint
   `https://<your site>/_/x/stripe/webhook` with the events
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   `checkout.session.expired` and `charge.refunded`; copy its signing secret
   (`whsec_…`) into Extensions → Stripe.

Without the webhook, a payment is still found: each one is checked 15 minutes
after it starts, and again with a growing wait, up to eight times. In the
Orders screen, "Check the card payment" asks Stripe at once, and "Refund by
card" gives the whole payment back.
