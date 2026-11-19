# ADR 0013 — One store, three databases

- **Status:** Accepted
- **Date:** 2026-11-19
- **Builds on:** ADR 0001 d9 (a site is one SQLite file).

A presentation site is well served by one SQLite file: nothing to install, and
copying the file is a backup. Some sites are not like that. A newsroom with
several editors, a host that offers only Postgres or MySQL, or an owner who
already runs one of them should not need another CMS. The owner asked for the
choice to exist from the start, before more code is written against SQLite
alone.

## Decisions

### d1. The address says which database

`thecms init site.db` still makes a SQLite file. `thecms init
postgres://user:pass@host/db` or `mysql://user:pass@host/db` puts the same site
on a server. Every command takes either. Nothing else changes for the owner.
The password in an address is never printed.

### d2. One store, written once, with the differences named

The store is written in the SQL the three share, through Bun's own client
(`Bun.SQL`), so no driver is added. Where they differ, the difference lives in
one small object per database, a `Dialect`: column types, how to write "insert
or replace", "insert unless it exists", placeholders, and the one column name
MySQL reserves. No other file knows which database it runs on.

Content is stored as JSON in text columns, as it was. No database's JSON
type, full text search or other feature is used: those are where the three
stop agreeing, and the core already cleans everything it reads (ADR 0001).

### d3. The store is asynchronous

`bun:sqlite` answers at once; a server does not. Every method of the store now
returns a promise, and every caller awaits it. This is the costly part of the
change, and the reason to make it now: it touched 31 places in the store and
every test, and would touch more each week.

### d4. Who may do what is decided by the application, not the database

Postgres has row-level security; SQLite and MySQL do not. If permissions were
put in the database, a site on SQLite or MySQL would be less safe than one on
Postgres, and the rules would exist in two forms. So the rule is: the store
does not decide who may do what. When accounts arrive, the check sits in one
place in front of the store, the same on every database, and is tested once.
On Postgres an operator may still add row-level security as a second guard;
nothing may depend on it.

### d5. Where they behave differently, the store does not rely on either

- MySQL counts an update that changes nothing as touching no row. Publishing a
  page twice is not an error, so the store asks whether the page exists before
  publishing instead of counting what changed.
- Postgres returns a count as text. Counts are read as numbers explicitly.
- MySQL's `TEXT` holds 64 KB; pages are `LONGTEXT` there. Its default
  collation compares letters without case; tables use `utf8mb4_bin`, so an
  address compares as its bytes, as on the other two.
- Images are stored in the database on all three (`BLOB`, `BYTEA`,
  `LONGBLOB`), so a site is still one thing to back up.

### d6. Every database is tested, every time

`test/databases.test.ts` runs the store on SQLite always, and on Postgres and
MySQL when given their addresses. CI starts both and runs it, including a
WordPress import and an export end to end. Each difference in d5 was broken
once on purpose and the test caught it.

## Consequences

- A SQLite file made before this opens unchanged: its schema is kept as it was.
- MySQL 8.4 needs `mysql_native_password` for now: Bun's client does not yet
  complete MySQL's default sign-in over a connection without TLS. CI starts
  MySQL that way; the README says so.
- Moving a site from one database to another is not offered yet. An export of
  the whole site as one file, then an import of it, would do it, and is the
  same tool a backup needs.

## Known gaps

- No connection settings beyond the address (pool size, TLS options).
- MariaDB is accepted (`mariadb://`) but not tested in CI.
