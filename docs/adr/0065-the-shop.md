# ADR 0065 — The shop

- **Status:** Accepted (Liviu, 2026-11-23: "Cum am propus", on the proposal in the project thread; step 3 of ADR 0060 d6)
- **Date:** 2026-11-23
- **Builds on:** ADR 0060 (stage 3; d1, d3, d6 step 3), ADR 0037 d5 (the shop's core in the program), ADR 0025 (no type is built in), ADR 0010 (content types), ADR 0015 (a type's page), ADR 0061 d3 (products for search engines), ADR 0062 d9 (the shop's events and questions), ADR 0064 (visitor accounts, the mail queue), ADR 0044 (the site is served), ADR 0051 (backups), ADR 0057 (a complete export)

WordPress sells with WooCommerce. ADR 0060 d1 keeps the shop in the program,
off until the owner turns it on, with payments, couriers and invoicing as
extensions of later steps. This record says what the first shop holds.

## Decisions

### d1. Products are entries of a type that sells

No type is built in (ADR 0025), and a product is not one either. A content
type may be marked **sells**: its entries are products. Turning the shop on
makes an ordinary type "Products" (`/products/`, in the site's language) when
no type sells yet; the owner renames it, moves it or marks another type
("Courses") as selling, as with any type. A type that sells is said to search
engines as products (ADR 0061 d3), its price from the shop.

So a product has, at no cost, what entries have: its address, categories and
tags, translations, its page designed in the builder, the list block, "Who
sees it" (ADR 0064 d4) and the data for search engines.

### d2. What the shop adds to a product

Beside the fields the owner defines, an entry of a type that sells carries the
shop's own, which the owner does not shape:

- **price**, with VAT included, and a **sale price**, empty for none;
- a **code** (SKU);
- the **VAT rate**: one of the site's rates (d5);
- **stock**: not counted, or a number left; at 0 the product cannot be bought;
- **variants**: up to three options (Size × Colour), each with its values;
  each combination may have its own price, sale price, code and stock, or
  take the product's.

The price, the code and the options are content: drafted and published with
the entry, kept among its last publications, in the export. **Stock is not
content**: it changes with each order, so it lives in a table of the shop,
set from the entry's editor and taken by orders, without publishing anything.

### d3. Buying is a form, not a script

A product's page has a part **Buy** (ADR 0015): its price, its sale price
crossed through, whether it is in stock, the variants as lists, a quantity and
**Add to cart**, a plain form posted to `/_/cart`. A product's page is built
once at publication (ADR 0044); the stock it shows is what was there when it
was built, and is built again when a product runs out or comes back. Price and
stock are checked again when an order is placed.

### d4. The cart and checkout

Under `/_/`, drawn by the runtime in the site's layout, without script:

- **`/_/cart`**: the lines, quantities changed or removed, a coupon (d8), the
  subtotal, shipping and the total;
- **`/_/checkout`**: name, e-mail, phone, the delivery address (with county
  and town), a company's details when buying as one (its name, tax code and
  registration number, for e-Factura later), the shipping and payment methods,
  a note, and consent to the site's terms page, required;
- **`/_/order/<id>`**: the order, as its buyer sees it, by a link only they
  have.

A cart is a secret in a cookie of its own (`SameSite=Lax`), kept in the
shop's tables for 30 days. One buys without an account; when visitor
accounts are on, a signed-in visitor's details are filled in and their orders
are listed in "My account". The owner may require an account to buy.

### d5. One currency, prices with VAT

A site sells in one currency (Site settings, RON when none is named). Prices
are entered with VAT included, each product at one of the site's rates (21%,
11%, 0% to start; the owner changes them). The cart and the order show the VAT
of each rate. A site that does not charge VAT says so once, and no VAT is
shown.

### d6. Paying and delivering, before the extensions

Until Stripe and Netopia (step 4) and the couriers (step 5):

- **payment**: by **bank transfer** (the owner's account and bank, sent in the
  order's e-mail) and **cash on delivery**, each on or off;
- **shipping**: methods the owner names, each with a fixed price, free above a
  sum, or **pick up** at an address.

The questions an extension answers (ADR 0062 d9: "where is the buyer sent to
pay?", "what does this cost to send?", "issue the invoice") come with step 4,
shaped on a real provider.

### d7. Orders

An order has a number that follows the last, its lines as they were bought
(name, variant, price, VAT), the buyer's details, and a state: **waiting for
payment**, **paid**, **being prepared**, **sent** (with a tracking number),
**completed**, **cancelled** or **refunded**. Placing it takes the stock;
cancelling it gives it back.

The admin has an **Orders** screen: the list by state, an order's page with
its states, and a CSV of the orders. The owner (and editors, as for messages,
only when the owner allows it) handles them.

The buyer is sent **order received**, **paid**, **sent** and **cancelled**;
the owner is sent each new order. These are templates of Settings → E-mail,
in each language, and go through the queue of ADR 0064 d5, which becomes the
site's, not the accounts' alone: it is made when either part is turned on.

### d8. Coupons

A code, a percentage or a sum off, an end date, a number of uses and a
smallest order. One coupon an order.

### d9. For extensions (ADR 0062 d9, the shop's part)

Events **`order.made`**, **`order.paid`**, **`order.refunded`** and
**`order.sent`**, with the order's id, number and total, never the buyer's
details; `uses: ["orders"]`: read an order, mark it paid or refunded, set its
tracking number. Each shown to the owner before installing.

### d10. Off costs nothing (ADR 0060 d3)

The shop is off until the owner turns it on in **Settings → Shop**. While
off its module is not loaded, its tables do not exist, `/_/cart`,
`/_/checkout` and `/_/order/` answer 404, and the admin shows no Orders, no
"sells" on a type and no shop fields on an entry. A test guards it. Turned off
again, products are kept as entries, their pages show no Buy part, and the
orders are kept.

A static export has no shop: the export screen says so, as for forms.

## Not in the first shop

Products to download, reviews, more than one currency, subscriptions (step 6
of ADR 0060 d6), the payment, delivery and invoice questions (step 4), and
importing products from WooCommerce.

## How it is built

Three pull requests: (a) the switch, the types that sell, the product's fields
and variants, its stock and its Buy part; (b) the cart, checkout, the manual
payments and shipping, orders, their screen and their e-mails; (c) coupons,
what extensions are given (d9), and the shop's tables in backups and in the
complete export.
