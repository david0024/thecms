# ADR 0038 — The site's runtime: the published site and what cannot be static, from one address

- **Status:** Accepted (owner, 2026-11-20: "mergem pe propunerile tale", on the plan of ADR 0037, whose stage 1 begins here)
- **Date:** 2026-11-20
- **Superseded in part by:** ADR 0044 (the runtime is no longer optional: it is how a site is served)
- **Builds on:** ADR 0037 d2 (static where it can be, a server where it must), ADR 0019 (the form service), ADR 0036 (old addresses)

ADR 0037 puts what cannot be static in an optional runtime, under the site's
own `/_/` addresses, on a server first. Those addresses need the pages and the
runtime at the same origin. On a static host that needs a proxy rule that not
every host offers. On a server, the simplest arrangement is for the runtime to
serve the pages too. That is this first part.

## Decisions

### d1. `thecms run <site>` serves the published site

`thecms run <site.db> [--port=4323] [--host=127.0.0.1]` serves exactly the
files `thecms export` would write. They are built in memory from what is
published, with the same check before publishing, and nothing is written to
disk.

- **Freshness.** The build is reused for 5 seconds, then made again on the
  next visit. A publication in the editor shows within that time. There is no
  signal between the two processes to keep in step.
- **Responses.**
  - Each file goes out with its type.
  - A page goes out with a policy that allows no script and nothing from
    elsewhere but images.
  - A stored image is cached for a year, because its name is its hash.
  - An address missing its last slash leads to the one that has it.
  - What is not there gets the site's own 404 page.
- **Not served.** The lists the export writes for hosts (`_redirects`,
  `.htaccess`) and any name starting with a dot.
- **Old addresses** (ADR 0036) answer with a real `301`, read from the same
  small page the export writes. A redirect the export leaves out (a loop, one
  to an address the site does not have) is left out here too.

The editor stays a separate process (`thecms serve`), on its own address. The
public site never shares a process with the admin.

### d2. What is dynamic lives under `/_/`

`/_/send` is the form service of ADR 0019, unchanged. `/_/` answers that the
runtime is there, and any other address under it is not found. The
comments, the search, the cart and the account of ADR 0037 d4 each arrive as
a route there, with a record of their own.

`thecms forms` keeps working for a site exported to a static host.

### d3. A form sends to the site's own runtime with `/_`

The site's form service can now be written as `/_`. The form then posts to
`/_/send`, on the same address as the page, and the setting's hint says so.
An address elsewhere (`https://forms.example.com`) works as before.

## Not yet

- **The server install.** `install.sh --server` does not yet start `thecms
  run` beside the editor, with Caddy in front of both.
- **The runtime on Workers.** That is ADR 0037 stage 3.
- ~~**The jobs.**~~ The runtime has a clock since ADR 0039.
- **Many pages.** The whole site is built again after 5 seconds. For a site
  of thousands of pages, the build should follow the publications instead.
