# ADR 0048 — The installer, in steps

- **Status:** Accepted (owner, 2026-11-21: "eu as face in mai multi pasi. instalatorul te intreaba unde vrei sa gazuiesti site-ul, si aici sa avem mai multi optiuni, vps/own server, cloudflare … daca alegi cloudflare sa iti dea posibilitatea sa te conectezi la contul cloudflare pentru a crea cloudflare pages/workers/database, daca alegi de exemplu vps/server sa te intrebe daca vrei ca instalatorul sa instaleze si baza de date … daca alegi ca il conectezi tu la o baza de date pe care ai creat-o singur … sa scrii datele de conectare"; on the proposal that completes it: "da")
- **Date:** 2026-11-21
- **Builds on:** ADR 0023 (installation), ADR 0022 (accounts: the first owner's link), ADR 0037 d4 (the runtime on Workers, stage 3), ADR 0044 (the site is served; Valkey), ADR 0045 (versions)
- **Changes:** ADR 0023 d3 and d5, where installing is one command with options to remember

`install.sh` installs the program, and `--server --public=… --database=…`
sets up a server. An owner has to know the options before they start, and
the choices that matter (where the site lives, which database) are flags.
The owner wants the installer to ask, one step at a time, as WordPress's
installer does.

## Decisions

### d1. First question: where the site will live

The installer asks where the site is hosted, and each answer leads to its own
steps:

- **A VPS or your own server** (Linux with systemd): the steps in d2.
- **Cloudflare:** the steps in d3.
- **Docker:** an image of the program, with the database and Valkey beside it
  in a `compose` file; the same questions as d2, answered as settings.
- **A ready platform** that runs a container (Railway, Render, Fly.io): the
  Docker image, with the settings each platform asks for written out.
- **Only this computer**, to try it: the program in the user's folder, a
  SQLite file, nothing else (what `install.sh` does today without options).

Shared hosting with cPanel is not supported: it runs PHP, not a program that
stays running. The installer says so, and points to the choices above.

### d2. On a server: the database and Valkey installed, or yours

- By default the installer **installs the database and Valkey** itself and
  connects the site to them, listening only on the server. It asks which
  database, among those thecms supports: SQLite (a file, nothing to install),
  PostgreSQL, MySQL or MariaDB.
- **"I connect to my own database"**: for a database made elsewhere, perhaps
  on another server. It asks for the connection details (host, port, name,
  user, password), **tests the connection** before it goes on, and says what
  failed if it cannot connect.
- Then the address people will open, and the web server in front of it, as
  `--server` does now (ADR 0023 d5).

### d3. On Cloudflare: authorised in the browser, then made for you

- The owner **authorises the installer in the browser**, on their Cloudflare
  account. No token is copied by hand.
- The installer then **creates what the site needs**: the Worker that serves
  it, a D1 database, and an R2 bucket for the media library.
- This needs the runtime on Workers, which is stage 3 of ADR 0037 d4; the
  Cloudflare choice arrives with it.

### d4. The terminal asks only about the server; the site is set up in the browser

The terminal asks only what a server needs: where, which database, which
address. The site itself is set up in the browser, the first time it is
opened, as WordPress does: **the site's name, the owner's account, and the
language**. The installer prints the link that opens that first page; it
works once, as the first owner's link does now (ADR 0022), so nobody else who
finds the address first can claim the site.

### d5. Still one command to start

`curl … install.sh | sh` (and `install.ps1` on Windows) still starts it, and
still checks the release's checksums before anything is put in place. Every
question has an option that answers it, so a script or a CI job can install
without being asked (`--host=server --database=postgres …`). Run again, it
updates the program and leaves the site as it is.

## Order

The server, Docker and the first page in the browser come first, as their own
work; Cloudflare comes with the runtime on Workers (stage 3).

## Not decided here

- Whether the database installed by d2 is backed up by the site's own backups
  (stage 2) or by the server's.
- A managed hosting offer (stage 4).
