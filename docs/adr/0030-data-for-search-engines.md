# ADR 0030 — Data for search engines

- **Status:** Accepted (owner, 2026-11-20: asked for the clearly useful ideas from a review of SveltyCMS to be built; this was the fourth)
- **Date:** 2026-11-20
- **Builds on:** ADR 0001 (no script on the public site), ADR 0007 (the blog), ADR 0010 (content types)

Search engines read schema.org data to show a site's name, its logo, and an
article's date beside a result. A WordPress site gets it from an SEO plugin;
here the site already knows all of it.

## Decisions

### d1. Only with the site's address

The data names pages by their whole address, as search engines want it. A
site whose address is not set has none, as it has no sitemap.

### d2. What is said

- The home page: the site (`WebSite`: name, address, language) and the
  business behind it (`Organization`: name, address, logo).
- An entry of a dated type: an article (`BlogPosting`: headline, date,
  address, description, cover picture, first category, tags), published by
  the business.
- Other pages say nothing more: a page's own title and description are
  already in its head.

### d3. The one script element is data

It is `<script type="application/ld+json">`, which no browser runs, so the
public site still runs no script (ADR 0001). Every `<` inside it is written as
`<`, so nothing the owner writes can close the element. The test that
guards "no script" allows this element and nothing else.

## Not decided

- A person as an article's author: entries have no author yet.
- Data for other kinds of entry (an event's date and place, a product's
  price), which would need their fields to say what they mean.
