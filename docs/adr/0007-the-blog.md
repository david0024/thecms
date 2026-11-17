# ADR 0007 — The blog

- **Status:** Accepted
- **Date:** 2026-11-16
- **Builds on:** ADR 0001 d7 (content is blocks), d9 (static export), ADR 0003
  (the editor), ADR 0006 (what every page shares).

Most WordPress sites have a blog, even when it is three posts about opening
hours. This is the blog: posts, categories, a list, a feed.

## Decisions

### d1. A post is made of the same blocks as a page

A post is a document with a title, a date, a summary, a cover picture,
categories, and a body of blocks. Its body is edited in the same editor, with
the same blocks, formatting, images and dragging as a page. There is not a
second, simpler editor for posts to fall behind.

Posts are kept in their own table, so a post and a page may share a name
(`/about/` and `/blog/about/`).

### d2. Like a page, a post has a draft and a published copy

Saving a post changes its draft. Visitors, the list, the categories and the
feed see only what was published.

### d3. Addresses are fixed

- a post: `/blog/<slug>/`
- the list: `/blog/`, then `/blog/page/2/`
- a category: `/blog/category/<slug>/`
- the feed: `/blog/feed.xml`

`blog`, `media` and `assets` are addresses the site uses, so a page may not be
given one. (Before this, a page titled "Media" would have been written over the
images folder.) Whether the blog can live at another address, or be the home
page, is left for when someone needs it; changing addresses later means
redirects, so it is better not offered than offered carelessly.

### d4. The blog exists when there is a post

With no published post there is no blog: no list, no entry in the menu, no
feed. With one, all three appear. Nobody has to switch the blog on, and a site
without one carries no empty page.

### d5. Categories are words on the post

A category is a name typed on a post. Its page exists while a published post
carries it. Two spellings that would share an address (`News`, `news`) are one
category. There is no separate list of categories to keep in step, and no tags
beside categories: one way of grouping is enough until it is not.

### d6. The date is a day, set by the author

Posts are listed newest first by their date. It is a calendar day without a
time or a time zone, written in the site's language (`4 martie 2026`). A post
dated in the future is published like any other: with a static site,
"scheduled" would mean somebody exports again on that day.

### d7. The feed is Atom, and needs the site's address

A feed names each post by its full address, so it is written only when the
site's address is set, like the sitemap. It carries the thirty newest posts
with their summaries, not their full text.

### d8. The site's own words are data

Labels the author did not write ("Older posts", "Page not found") come from a
table by language (`src/blocks/words.ts`), English and Romanian so far. A site
in a language not listed gets the English ones.

## Not yet

- **A "latest posts" block** to show the newest posts on the home page.
- **Authors**, and a page per author.
- **Comments.** A static site has nowhere to receive them; this belongs with
  forms.
- **The post's title cannot be typed on the page**; it is edited in the panel.
- **The list of posts is not shown in the editor**; it is seen in the export.
- **Structured data** (`BlogPosting`) for search engines.
- **Previous and next post** links at the foot of a post.
- **Importing posts from WordPress**: the reason posts had to exist first.

## Verification

`e2e/editor.cjs` writes a post in the editor, dates and categorises it,
publishes, and reads the exported post, list, category page, feed and sitemap.
`test/blog.test.ts` covers the rest without a browser: pagination across three
pages, drafts kept out of the export, reserved addresses, and that a title made
of markup is text in the page, the list and the feed (the feed's escaping was
removed once to see the test fail).
