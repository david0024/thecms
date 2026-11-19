# ADR 0022 — Accounts

- **Status:** Accepted (owner, 2026-11-19: agreed to the plan of installation and accounts, "continua")
- **Date:** 2026-11-19
- **Builds on:** ADR 0003 (the editor and its key), ADR 0013 (one store, three databases)

Until now the editor ran on its owner's computer and answered only to the key
in the address it printed. A site made for a client is edited by the client,
on a server, from anywhere. That needs accounts: who may sign in, and what
each may do. The installation (the next ADR) prints a one-time link for the
first owner, as Zveltio does; this ADR is what that link opens.

## Decisions

### d1. Two ways to run the editor; accounts only when others can reach it

- `thecms edit site.db` stays as it was: on this machine only, with the key
  in the address. Whoever has the key is the owner. Nothing about accounts
  shows.
- `thecms serve site.db --public=https://cms.example.com` is the editor for
  others. It has accounts. The public address is https, with nothing after
  the host; http is accepted only for 127.0.0.1 and localhost, to try it out.
  It listens on 127.0.0.1 unless `--host` says otherwise, behind the server
  that holds the certificate (Caddy, nginx).

### d2. The first owner comes from a link the server prints

While the site has no owner, `serve` prints a link that works once, for an
hour. Started again, it prints a new one and the old one stops working. The
link asks for a name, an address and a password, and makes the owner.

There is no "first one to open the page is the owner": a server reachable by
anyone would belong to whoever found it first.

### d3. Everyone else is invited by an owner, with a link the owner sends

The owner adds an address and a role on the People screen and gets a link
that works once, for three days. The site sends no email for it: it may have
no mail server, and a link the owner sends themselves is one less thing that
can fail. The same screen makes a new link for someone who forgot their
password. An owner locked out runs `thecms reset-link site.db their@address
--public=…` on the server.

### d4. Two roles

- **Owner:** everything.
- **Editor:** writes and publishes pages, posts and entries, and uploads
  images. The settings, the menu, the theme, content types and each type's
  own page, the import, visitors' messages and the people are the owners'.

The server decides; the admin only hides what the server would refuse. The
site always keeps an active owner: the last one cannot be removed or made an
editor.

### d5. Passwords, sessions and links are kept as little as possible

- A password has 10 to 200 characters and is kept as an argon2id hash
  (`Bun.password`). A wrong address takes as long as a wrong password.
- Ten wrong passwords for one address in a quarter of an hour, and that
  address waits.
- A session is a random secret in a cookie: `HttpOnly`, `SameSite=Strict`,
  `Secure` on https, for 30 days. The database keeps only its SHA-256, so a
  copy of the database signs nobody in. The same holds for links.
- A new password ends every session of that person; removing someone ends
  theirs.
- A link is spent by deleting its row, and the database says how many rows
  that deleted: two requests with the same link cannot both get in. What was
  typed is checked before the link is spent, so a short password can be
  tried again.

### d6. A call is the admin's only when it shows it

Every call must name the public host, come from the public origin when the
browser says where it comes from, and carry the header `x-thecms-request: 1`.
A page of another site cannot send that header without asking the server
first, and nothing here answers that question. With the `SameSite=Strict`
cookie this closes the door to requests forged from elsewhere. The key of
`edit` means nothing to a served editor.

What is read without a session is what holds nothing private: the admin's
page and script, the empty frame of the canvas, the theme's CSS, and stored
images, whose names are the hashes of their bytes and cannot be guessed.

### d7. The name of the cookie and the header come from one place

The product's name may change. `src/core/name.ts` holds it, and the session
cookie is named from it (`thecms_session`).

## Not decided here

- Signing in with another account (Google, GitHub) or a second factor.
- Roles of one's own, or an editor limited to some content types.
- Who changed what, and when.
