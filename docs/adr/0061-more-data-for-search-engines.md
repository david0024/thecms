# ADR 0061 — More data for search engines: questions, the business, events and products

- **Status:** Accepted (owner, 2026-11-22: "Da, toate, în ordinea asta", on the five SEO stages of ADR 0058; this is the third)
- **Date:** 2026-11-22
- **Builds on:** ADR 0030 (data for search engines), ADR 0010 (content types), ADR 0052 (more kinds of field), ADR 0058

ADR 0030 said three things to search engines: the site, the business behind
it, and an article for each dated entry. Rank Math says more, and search
engines show more for it: a business's address and hours beside the site
and on maps, an event's date and place, a product's price. The site already
knows most of it, or the owner can say it once.

## Decisions

### d1. Questions and answers

A page or an entry with a block of questions and answers says them as a
`FAQPage`: each question with its answer, in the order shown, from every
such block on it. A question without an answer is left out. Nothing is
asked of the owner.

### d2. The business as a place people come to

Site settings have a folded part, "Your business, for search engines
(address, hours)": what kind of business it is (a short list of the kinds
search engines know, in plain words: a shop, a restaurant, a bakery, a
dentist…), its street, town, county, postal code and country, its telephone
and email, its prices roughly, the currency of the prices on the site, and
its hours for each day of the week.

- Hours are written as people write them (`9-18`, `9-13, 14-18`) and kept
  as search engines read them (`09:00-18:00`); empty means closed.
- With a kind, an address, a telephone or hours, the business behind every
  page is that kind of `LocalBusiness`, with its `PostalAddress`, telephone,
  email, prices and `OpeningHoursSpecification`, days with the same hours
  said once. Without them it stays an `Organization`, as before.
- What is not right is not kept: a country of two letters, a currency of
  three, an email with an `@`, a telephone of digits.

### d3. A type's entries may be events or products

A content type says, for search engines, what each entry is: an article
(when dated, as before), nothing more, an event or a product. For an event
or a product, each field that can say something is asked what it is:

- an event: when it starts and ends (date fields), where it is (a text),
  its price (a number);
- a product: its price (a number), its code and brand (texts), whether it is
  in stock (yes or no).

Each meaning is held by one field at most. An entry then says an `Event`
(with its organizer, the business) or a `Product`, with its cover, its
description and its address. A price is said as an `Offer` only when Site
settings name the currency. An event with no start date says nothing: a
search engine would refuse it. A dated type of events is not also an
article.

## Not decided

- Reviews and ratings: nothing in the site collects them yet.
- An event online, or with more than one date: the fields say one place and
  one start.
- A product's variants and shipping: they come with a shop.
