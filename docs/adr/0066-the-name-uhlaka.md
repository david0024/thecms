# ADR 0066 — The name: Uhlaka

- **Status:** Accepted (Liviu, 2026-11-23: "thecms update? nu il redenumesti? uhlaka update", then "trece tot intai pe uhlaka. asa e corect"; the name was chosen earlier with David, and the repository moved to uhlaka-devs/uhlaka)
- **Date:** 2026-11-23
- **Builds on:** ADR 0023 and ADR 0048 (installation), ADR 0045 (versions), ADR 0026 (extensions), ADR 0051 (backups), ADR 0057 (a complete export)

thecms was a working name. The program is now **Uhlaka** ("frame" in Zulu),
its repository is `uhlaka-devs/uhlaka`, and its site is uhlaka.org. Until
this record the program still called itself thecms: its command, its files,
its formats and its words. The site that presents it could not say "Uhlaka"
while the command it tells people to type was `thecms`.

## Decisions

### d1. One name, everywhere, from 0.1.0-alpha.3

- The command is `uhlaka` (`uhlaka update`, `uhlaka backup`, `uhlaka run`),
  and so are the release files (`uhlaka-linux-x64`), the service and its
  user on a server, the Docker image (`ghcr.io/uhlaka-devs/uhlaka`), the
  package and the cookies.
- People read **Uhlaka**; commands, files and formats write `uhlaka`.
- The formats are `uhlaka.content/1`, `uhlaka.backup/1`, `uhlaka.extension/3`,
  `uhlaka.theme/1`, `uhlaka.view/1` and `uhlaka.data/1`, with the files
  `.uhlaka.json`, `.uhlaka-backup` and `.uhlaka-extension`; an extension
  says `uhlakaMinVersion`. The environment is `UHLAKA_SITE`, `UHLAKA_PUBLIC`,
  `UHLAKA_SMTP` and the rest.
- The decision records keep the name they were written with: they say what
  was decided then.

### d2. What was made as thecms still works

What a person or a site made before the rename is read as it would be
written now, in one place (`fromOldName` in `src/core/name.ts`): a content
file, a backup (also one named `.thecms-backup`, in the backups folder or
uploaded), an extension package, including one already installed and the
AI extension's releases, and a theme. A `THECMS_…` variable in the
environment stands for its `UHLAKA_…`, unless that one is given too. Only
the new name is written.

## Known gaps

- A server installed with 0.1.0-alpha.2 runs a service called `thecms`, and
  `thecms update` looks for release files called `thecms-…`, which
  0.1.0-alpha.3 does not have. Such a site is moved by installing again with
  the installer and restoring its last backup. No site outside the project
  was installed that way.
- Signed-in people sign in again once: the cookies have new names.
