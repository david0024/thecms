# ADR 0025 — No built-in blog: every content type is the owner's

- **Status:** Accepted (owner, 2026-11-19: "nu exista un blog încorporat; fiecare își definește tipul de conținut")
- **Date:** 2026-11-19
- **Replaces:** ADR 0010 d2 (posts are a type that is always there)
- **Builds on:** ADR 0007 (the blog), ADR 0010 (content types)

The owner asked for no blog built into the product. Every kind of content is a
type the owner defines: its name, what an entry holds and how it looks.
Products, articles, a vlog and a blog are all the same thing.

## Decisions

### d1. No type is built in

The blog is an ordinary type in the site's list. It can be renamed, given
other fields, given another address, or deleted once it holds nothing, like
any other. The menu has no "blog" item of its own: it points at a type.
`/blog/` is no longer an address the site keeps for itself.

### d2. The address comes from the type's name

An entry is at `/<type>/<entry>/`: the type's address (from its name, which
the owner may change) and the entry's (from its title). Every entry needs a
title, whatever its type.

### d3. A new site starts with an example

`thecms init` makes a site with a type "Blog" and a few posts, to show how a
type works. Nothing depends on it.

### d4. Sites made before keep what they had

A site saved before this, whose posts were built in, gets them as the first
type in its list, with the name it had given its blog and at `/blog/`. Its
addresses do not change. A menu item that pointed at the blog points at that
type.

### d5. An import brings back a place for posts

A WordPress export has posts. If the owner deleted the type that holds them,
the import adds it again ("Blog", at `/blog/`), and the owner may rename it
after. If a page already lives at `/blog/`, the posts are left out and the
report says why.
