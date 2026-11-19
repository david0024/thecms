# ADR 0020 — The core is AGPL-3.0-or-later

- **Status:** Accepted (owner, 2026-11-19: "mai bine incepem mai restrictiv si relaxam in functie de reactia pietei")
- **Date:** 2026-11-19
- **Supersedes:** ADR 0001 d5 (GPL-3.0-or-later for the core)

ADR 0001 d5 chose the GPL because the audience comes from WordPress and reads
the GPL as a sign of trust. It accepted one cost: anyone may run the product as
a hosted service and never give their changes back. The GPL asks for the
source only when the program is handed to someone, and a hosted service hands
nothing over.

The owner has decided to take the restrictive licence first. A project can
always relax its licence later, by its owner's choice. Moving the other way,
from a permissive licence to a restrictive one, has been done by others, and
the market took it badly each time. Zveltio made the same choice: it is
AGPL-3.0, and only its SDK is MIT.

## Decisions

### d1. The core is AGPL-3.0-or-later

Everything in this repository is AGPL-3.0-or-later unless a folder below says
otherwise: the engine, the editor, the renderer, the importer and the form
service. A changed version that is offered to users over a network must offer
those users its source (section 13). Version 3 or later, for the same reason
as before: it combines cleanly with Apache-2.0 dependencies.

The cost is known: some companies have a policy of avoiding the AGPL. A site
built with thecms is not affected. Its pages, its content and its exported
static files are the owner's, under any licence the owner likes. The AGPL
reaches only the program.

### d2. What sites and other programs use stays MIT

- **Themes** (`themes/`) are data, under MIT, so anyone may start a theme from
  them, commercial themes included.
- **Language packs** are data too and will be MIT when they arrive.
- **A client or SDK**, meaning code other programs link against to talk to
  thecms, will be MIT.

Each of these folders carries its own `LICENSE` file. A theme, a language pack
or a module that runs behind a contract (ADR 0001 d5) is not a derived work of
the core, and it may carry any licence, commercial ones included.

### d3. Code moves to Zveltio freely

Zveltio is AGPL-3.0, so code from this core may go into Zveltio as it is. Only
code meant for Zveltio's SDK, which is MIT, must be MIT here as well. The
earlier wording that called Zveltio MIT was wrong, and it is corrected in
ADR 0001.

### d4. External contributions come under a simple CLA

Relaxing the licence later is possible only if every contribution can be
relicensed. So a contributor keeps the copyright of what they write and grants
the project the right to license it under any licence, including a more
permissive one (`CLA.md`). Opening a pull request after reading it is the
agreement. There is no bot and no signature form. Work the project's own
authors do needs none.
