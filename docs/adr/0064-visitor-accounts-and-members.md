# ADR 0064 — Visitor accounts, members, and e-mail to visitors

- **Status:** Accepted (Liviu, 2026-11-22: "Da, cum ai propus", on the proposal below; step 2 of ADR 0060 d6)
- **Date:** 2026-11-22
- **Builds on:** ADR 0060 (stage 3; d1, d3, d6 step 2), ADR 0062 (extensions 3; d9), ADR 0022 (accounts for a served editor), ADR 0019 (the site's mail), ADR 0043 (pages behind a password), ADR 0044 (the site is served), ADR 0057 (a complete export), ADR 0051 (backups)

WordPress lets visitors make an account, and its membership plugins keep
pages for members of a level. ADR 0060 d1 puts visitor accounts, members and
e-mail to visitors in the program, and ADR 0043 d4 left "private" pages for
them. This record says how they are made.

## Decisions

### d1. Visitor accounts, apart from the admin's

A visitor's account is not a person of the admin (ADR 0022): another table,
another cookie, and it never reaches `/admin` (ADR 0037 d2). An owner or an
editor who wants to see the site as a member makes a visitor account like
anyone.

Its pages are under `/_/account`, drawn by the runtime in the site's layout,
header and footer, with its theme, in the visitor's language, without script:

- **sign up**: name, e-mail, password, and consent to the site's privacy page;
- **sign in**, and **a forgotten password**, which sends a link;
- **my account**: name, e-mail, password, the member levels held, "download my
  data" (JSON) and "delete my account";
- **sign out**.

A new address is confirmed by a link sent to it before the first sign-in; a
link lasts a day. A password is kept as its hash (argon2id), and wrong
passwords are counted where the processes share them, as for the admin. The
session is a secret in an HttpOnly cookie of its own (`SameSite=Lax`, 30
days).

### d2. Who may sign up

The owner chooses: **open** (anyone), **by invitation** (the owner adds the
visitor, who receives a link), or **closed** (no new accounts; those made
keep signing in). Open sign-up cannot be turned on while the site has no
mail server that works: confirming an address and a forgotten password need
it, and the admin says so.

### d3. Members

The owner names levels ("Member", "Premium"). A visitor may hold several. The
owner gives and takes them from the Visitors screen, and may choose a level
each new account receives. The subscriptions and the shop will give them by
the access of d7.

### d4. Who sees a page

Beside **Password** (ADR 0043), a page, an entry and a whole content type
gain **Who sees it**: everyone, visitors signed in, or members of chosen
levels. The runtime serves such a page as it serves one behind a password:
only to a visitor allowed, `private, no-store`; anyone else gets 403 and a
page of the site's frame with the sign-in form, or, signed in without the
level, a line saying the page is for members. Like a page behind a password
(ADR 0043 d3), it is not in the sitemap, the search, the feeds or an export.

The built pages do not know who is signed in, so they stay built once and
kept (ADR 0044). The menu gains an item **My account**, leading to
`/_/account`, which shows the sign-in or the account.

### d5. E-mail to visitors

The program carries templates, in English and Romanian: confirm the address,
a forgotten password, welcome, invitation, account deleted. The owner changes
each one's subject and text, in each language, with `{name}`, `{link}` and
`{site}`. A visitor gets them in the language they signed up in.

Mail goes through the site's mail server (ADR 0019). It waits in a queue in
the database and the site's clock sends it, trying again a few times, so no
request waits for a slow server; what fails at the last try is said in the
log and in the Visitors screen.

The mail server may now also be set in **Settings → E-mail**, with the
sender's address and a button that sends a test message. `THECMS_SMTP` and
`THECMS_MAIL_FROM`, when given, are stronger than the settings, and the
screen says so. The password is kept as the other secrets of the site are.

### d6. What is kept, and given back

Only the e-mail, the name, the password's hash, the language, the day of
sign-up, the levels, and the day of the last sign-in. No visitor's address
(IP) is kept. An account not confirmed in seven days is deleted. A visitor
downloads their data and deletes their account themselves; the owner can do
both from the admin. A backup holds the visitors (ADR 0051); a complete
export (ADR 0057) holds them only when that part is chosen.

### d7. For extensions (ADR 0062 d9, the accounts' part)

- events **`account.made`**, **`account.removed`** and **`member.changed`**,
  with the visitor's id and levels, never their password or session;
- `uses: ["members"]`: read a visitor's name, e-mail, language and levels,
  give and take a level;
- `uses: ["mail"]`: send a visitor one of the site's templates, or a template
  the extension declares, through the queue of d5;
- **the signed-in visitor on a route**: the action is told the visitor's id
  and levels, never the cookie.

Each is shown to the owner before installing, as with ADR 0062 d1.

### d8. Off costs nothing (ADR 0060 d3)

Visitor accounts are off until the owner turns them on in **Settings → Visitor
accounts**, with one switch. While off, the module is not loaded, its tables
do not exist, `/_/account` answers 404, and the admin shows no Visitors
screen, no "Who sees it" and no "My account" in the menu. A test guards it.
Turned off again, the accounts are kept and no one signs in; pages for
members stay closed to everyone but the admin.

## How it is built

Three pull requests: (a) the accounts, their pages, the mail queue, the
templates and Settings → E-mail; (b) the levels and "Who sees it"; (c) what
extensions are given (d7).
