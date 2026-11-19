# ADR 0017 — The blocks the brief named: gallery, questions, testimonials, prices

- **Status:** Accepted
- **Date:** 2026-11-19
- **Builds on:** ADR 0001 d7 (one list of block types), ADR 0002 (the first slice).

The brief named the blocks a presentation site is made of: hero, services,
gallery, pricing, testimonials, contact form, FAQ. The first slice built five.
This adds four, so a typical presentation site can be made without a module.
The contact form is not here: where its messages go is a decision of its own.

## Decisions

### d1. Four new types, each a list of plain items

- **Gallery:** pictures, each with a caption.
- **Questions and answers:** a question and its answer.
- **Testimonials:** what was said, who said it, their role, a photo.
- **Prices:** up to six plans, each with a name, a price, what the price is
  per, a line of text, what it includes and a button.

Every item is plain text, an image or a link, cleaned like every other field.
None holds markup. What a plan includes is one feature a line, not a list
inside a list, so the editor needs no new kind of field.

### d2. On the site they need no script

An answer opens under its question with the browser's own `details` element.
In the editor every answer is shown open, so each can be typed into on the
page. A picture not chosen yet, or a button with no address yet, shows in the
editor and is left out of the site.

### d3. Their pictures belong to the page

Pictures in a gallery and testimonial photos count as used by the page: they
are exported with it, and cannot be deleted while it shows them.

## Not done here

- Bringing a WordPress gallery over as a gallery block (it comes as pictures).
- Structured data for search engines (`FAQPage`).
