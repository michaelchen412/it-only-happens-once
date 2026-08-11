# 0025 — If an element cannot name a table, it does not belong on the page

Status: **Accepted** *(2026-08-10 — written late, from
plan 10 (`docs/plans/archive/10-hq.md`) §10g, where it has governed every HQ
surface since 2026-08-01. Accepted rather than Proposed because the rule has
already been applied, has already killed features, and the surfaces it produced
are live.)*
Date: 2026-08-10

## Context

HQ's Today page assembles one screen from many sources: the check-in, tasks,
goals, people, birthdays, drift, mirrored calendar events, the last thing you
logged. A dashboard is the single easiest surface on which to render something
that *looks* authoritative and asserts nothing true — a summary line with no
query behind it, a prompt that fires on a condition nobody checked, a "recently"
that means whatever the developer assumed.

That risk is worse here than on the public site, and for a specific reason:
**this instrument's whole value is that its record is honest.** The check-in
exists to record how mornings actually go, and the interaction log exists to
record what actually happened with people. A page that quietly invents one line
teaches you to trust the twenty around it.

The prototypes proved the risk was real rather than theoretical. Building Today
against dummy data produced four elements that read perfectly and could not
survive being asked where their data came from.

Michael's challenge, during that audit, and now a standing rule:

> **If an element cannot name a table, it does not belong on the page.**

## Decision

**Every element on an HQ surface must be able to name the table or derivation it
comes from, and the rule is enforced by making that nameable rather than by
remembering it.**

- The prototype carried a `data-src` attribute on every element, naming its table
  or derivation, revealed by a **Show provenance** toggle. That habit carries
  into the real build — the toggle is scaffolding, the attribute is the
  discipline.
- **An element with no source is cut, not softened.** Not hedged with "roughly",
  not given a plausible default — removed, and the removal recorded.
- **Where a summary is genuinely assembled from several queries, it is labelled
  by source rather than blended.** Today's brief was four separate queries
  rendered as one tidy list, reading as a system-written summary of your life;
  it now names what each line is, and **Then** is shown as what it actually is —
  the last log entry, verbatim.
- ⚠ **A suggestion is never an automatic write.** When a mirrored Google event's
  title contains a roster name, the row offers a **dashed** `+ Tag Rosalind?`
  chip — *a suggestion you confirm*. Never an automatic link: **a wrong auto-tag
  corrupts the log silently, and silent corruption of the log is the one thing
  this database cannot survive.**
- **The brief is a bonus for having tagged, never a promise.** An untagged day
  shows People as birthdays and drift only, and that is a correct, quiet page
  rather than a broken one.

## Consequences

- **Some obviously-nice features are simply unavailable**, and that is the rule
  working rather than a gap to fill later. See Alternatives — all four were
  wanted and all four were cut.
- **"Quiet" becomes a valid page state.** A surface that has nothing sourced to
  say says little. This composes with
  [0013](0013-absence-never-accumulates.md): that ADR forbids accumulating
  absence, this one forbids filling it with something unsourced.
- **It constrains every future HQ surface**, in the same way 0013 does. A
  proposal that cannot say which table a line reads from is not a design that
  needs refining; it is a design that has not been finished.
- **It cost real features on day one** and the cost was correct: the drift rule
  as first written flagged the entire roster on creation day, because
  `last_contact_at` is null for a new person. Naming the source is what surfaced
  it — the element could name its column, and the column could not support the
  claim.
- **It does not apply to the public site**, where the equivalent discipline is
  different: a reader is shown authored content, not derived facts about
  themselves.

## Alternatives

**Show it anyway, softly.** The four elements the 2026-08-01 audit killed or
corrected, each with the verdict, recorded so none returns without a source:

| Element | Verdict |
|---|---|
| *"Saw X last night — anything worth keeping?"* | **Cut.** Needed an HQ event already person-tagged; most seeing-someone never becomes a calendar entry, so it would fire rarely and sometimes wrongly. |
| Message / Call buttons | **Cut.** Contacts live on the phone; a copy here only goes stale. |
| The brief's four lines as one summary | **Corrected**, not cut — labelled by source, with **Then** shown verbatim as the last log entry. |
| Drift on day one | **Fixed.** Drift now needs ≥1 interaction, and never applies to someone with an event today. |

**Auto-tag a mirrored event when its title matches a roster name.** The roster is
25 names, so the match is high-precision and the temptation is real. Rejected:
precision is not certainty, and the failure is *silent corruption of the log* —
the one error this database cannot recover from, because the log is the record
everything else is derived from. A dashed chip costs one tap and cannot lie.

**Infer rather than record.** The general form of the above — deduce that you saw
someone, deduce that a task was done, deduce a mood from activity. Every version
trades a true-but-sparse record for a dense one that is sometimes false, and this
instrument's entire value is in the first.
