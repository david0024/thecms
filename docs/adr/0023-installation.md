# ADR 0023 — Installation

- **Status:** Accepted (owner, 2026-11-19: "github releases deocamdata"; agreed to the plan, "continua")
- **Date:** 2026-11-19
- **Builds on:** ADR 0013 (one store, three databases), ADR 0022 (accounts)

Zveltio installs with one command and asks nothing it can guess. The owner
asked for the same here. Until now trying thecms meant cloning the
repository, installing Bun and running `bun install`.

## Decisions

### d1. One file a platform, with everything in it

`bun build --compile` (`tools/build.ts`) makes the program one executable for
each of linux-x64, linux-arm64, darwin-x64, darwin-arm64 and windows-x64. It
carries the runtime, the code, the Svelte components compiled, the admin
built for the browser, the themes and the language packs. Nothing is
installed beside it, and it runs from any folder.

- What used to be read from a folder at run time is imported instead
  (`src/site/shipped.ts`). A test holds those lists to the folders.
- The admin is built once, ahead, into `src/site/built-admin.ts`. Run from
  the sources, that is empty and the editor builds the admin when it starts,
  as before.
- About 105 MB on Linux, most of it the runtime. A smaller file is not worth
  a second runtime.

### d2. Published on GitHub Releases, with checksums

A tag `v<version>` runs `.github/workflows/release.yml`. It checks that the
tag is the version in `package.json`, runs the tests, builds every platform,
installs the Linux file with the install script and makes and exports a site
with it. Only then does it publish the files, `checksums.sha256` and both
install scripts. There is no domain yet: the scripts are downloaded from the
release itself.

### d3. One command to install, checked before anything is put in place

```sh
curl -fsSL https://github.com/david0024/thecms/releases/latest/download/install.sh | sh
```

```powershell
irm https://github.com/david0024/thecms/releases/latest/download/install.ps1 | iex
```

The script downloads the file for this computer and the checksums. If the
SHA-256 does not match, it stops and installs nothing. On macOS it signs the
file for this computer (`codesign --sign -`), which Apple Silicon requires.
The program goes in `~/.local/bin` (`%LOCALAPPDATA%\thecms\bin` on Windows).

### d4. `thecms` alone does the right thing in a folder

Run with no command, the program opens `site.db` in the current folder,
making it with the sample pages if it is new. It then opens the editor on
this computer, or, given `--public=` or `THECMS_PUBLIC`, serves it with
accounts and prints the first owner's link (ADR 0022). `THECMS_SITE` names
another file or a database address.

### d5. A server in one more option

```sh
curl -fsSL …/install.sh | sudo sh -s -- --server --public=https://cms.example.com [--database=postgres://…]
```

On Linux with systemd it adds a system user `thecms` and keeps the site in
`/var/lib/thecms` (or the database given). The settings go in
`/etc/thecms/env`, readable only by root and the service, because a database
address carries its password. The service runs `thecms --port=4321` on
127.0.0.1, with a read-only system around it. The script shows the two lines
of Caddy that put the certificate in front, and prints the link that makes
the first owner. Run again, it updates the program and leaves the site.

### d6. `thecms update`

It asks GitHub for the newest release and downloads this platform's file. It
checks the file against the checksums, then puts it in place by renaming,
which works while the program runs, Windows included. `update --check` only
says whether a newer release exists. Run from the sources, it refuses: those
are updated with git.

### d7. The name in one place

`src/core/name.ts` holds the name and the repository. The release files, the
command's messages and the session cookie take them from there. The install
scripts cannot import it, so they say it once at the top, and a test checks
that they say the same.

## Not decided here

- Serving the published site from the same server. For now it is exported
  (`thecms export`) to any static host. Publishing to Cloudflare Pages comes
  next.
- A package for Homebrew, apt or winget.
- Signing the files with a certificate (Apple notarization, Windows
  Authenticode).
