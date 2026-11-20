# ADR 0039 — Publish later, and the site's clock

- **Status:** Accepted (owner, 2026-11-20: "mergem pe propunerile tale", on ADR 0037, whose stage 1 names scheduled publication)
- **Date:** 2026-11-20
- **Builds on:** ADR 0037 d2 (the site's clock), ADR 0038 (the runtime), ADR 0028 (published versions)

WordPress lets an author set a post for an hour and walk away. thecms had no
clock: something was published only when someone pressed the button.

## Decisions

### d1. A page or an entry is set for an hour

The inspector of a page or an entry has "Publish later": a date and an hour,
in the author's own time. Set again, the time moves; it can be taken back.
At that hour, what the draft holds is published, as if the button had been
pressed then: its version is kept (ADR 0028) and an address that moved
leaves a redirect (ADR 0036). A time already past is refused (publish now
instead), and so is one more than two years ahead.

A section and a type's page are not set for later; they show on pages that
are. A translation is published with its page (ADR 0032).

A page that moves keeps its time. A page or an entry that is deleted takes it
away.

### d2. The site's clock

Every 30 seconds the clock publishes what is due and forgets the messages
kept long enough (ADR 0019). Both the editor and the runtime run one, so a
site served by `thecms run` publishes on time with no editor open. A due
publication is claimed by deleting it from the list before it is done; the
database says which process deleted it, so two clocks never both publish it.

Editors may set it, as they may publish.

## Not yet

- **A site exported to a static host** is not exported again by the clock.
  Its new pages appear when it is exported next. Publishing to a host from
  the program comes with ADR 0023's "Not decided here".
- **The time a post shows** (its date) is the one written on it, not the hour
  it was published.
