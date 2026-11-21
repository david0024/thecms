# ADR 0045 — Versions: alpha, then beta, then stable

- **Status:** Accepted (owner, 2026-11-21: "clar trebuie alpha. si va ramane in alpha pana cand implementam tot ce am stabilit. apoi, trecem in beta pentru testare si corectare erori si abia apoi la stable. putem avea evident mai multe versiuni de alpha si de beta, in functie de dezvoltare si verificare.")
- **Date:** 2026-11-21
- **Builds on:** ADR 0023 (installation: releases on GitHub, `thecms update`), ADR 0037 d4 (the four stages)

The program had a version, 0.1.0, and a way to publish a release (a tag
`v<version>`), but no release, and nothing said what a version promises.

## Decisions

### d1. Three phases, in order

- **Alpha** until everything decided is built: the four stages of ADR 0037
  d4. Features arrive, and what is there may still change shape.
- **Beta** then, for testing and fixing errors. No new feature that was not
  already decided; what changes is what testing finds.
- **Stable** only after that.

There may be as many alphas and betas as the work and its checking need.

### d2. How versions are written

Semantic versions, with the phase after a dash and a number after it:
`0.1.0-alpha.1`, `0.1.0-alpha.2`, …, `0.1.0-beta.1`, …, `0.1.0`. They are
ordered as semantic versions are: an alpha before a beta, a pre-release
before its release, `alpha.10` after `alpha.9`. The tag is `v` and the
version in `package.json`, as before.

### d3. Every alpha and beta is a pre-release on GitHub

The release workflow marks a version with a dash as a pre-release. GitHub's
"latest release" skips pre-releases, so while there is no stable one:

- `install.sh` and `install.ps1`, given no version, take the newest release
  from the list, pre-releases among them;
- `thecms update` does the same, and orders versions as d2 says;
- the README links the install script of the current pre-release.

An extension that needs version `0.1.0` of the program installs on its
pre-releases too: what it asks for is the version's number, not its phase.

### d4. An update keeps the program it replaces

`thecms update` keeps the program it replaced beside the new one, as
`thecms.previous`, and says so. Going back to it is one rename. Only the one
before is kept; the site's data is never touched by an update.

## The first

`v0.1.0-alpha.1`, from `main` as it is after this record: stage 1 of ADR 0037
d4 without its last two parts (the new blocks; documents in the media
library).
