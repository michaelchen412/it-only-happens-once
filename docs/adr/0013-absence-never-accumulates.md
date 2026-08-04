# 0013 — Absence never accumulates: recurrence is a rule, not a queue of rows

Status: **Accepted** *(2026-08-03, with the task model it governs — `tasks`,
`task_events`, and the disposition action that is the only thing able to move a
schedule. Until that migration existed this was a principle; it is now a shape.)*
Date: 2026-07-31

## Context

`vision.md` §2.7 requires that the system "never generate guilt or backlog," and
§6 makes *no placement debt* a hard rule: unplaced is a permanently valid state,
and returning after a six-month gap must confront Michael with no backlog.

HQ now introduces the three feature categories most likely to violate that: a
to-do list, recurring chores, and a daily check-in. Mechanically, these are
**guilt engines**. The universal failure mode is well known and is why most
personal systems are abandoned: you miss four days, you open it, there is a wall
of red, you close it, and you never return.

The stakes here are higher than that, and the reason is structural. The daily
check-in exists to record how mornings actually go, which means **the surface is
opened first, and most reliably, on the mornings that are hardest.** Those are
also, necessarily, the mornings following the stretches where the least got
done. A design that accumulates arrears therefore delivers its largest
accusation at precisely the moment its user is least able to absorb one — and it
is a health-tracking tool doing it. **A surface that greets you with forty-seven
overdue items at 7am on a bad morning is not merely annoying; it is the worst
possible outcome of building this at all**, because it makes the instrument a
source of the thing it is measuring.

At the same time he was explicit that silence is not acceptable either: *"I want
to know if I skipped."* Missing data is genuinely useful — a chore skipped four
times in six usually means the interval is wrong, not that the person failed.

So the requirement is precise: **record the misses, never accumulate them.**

The conventional implementation makes this impossible. Most task systems
materialise future occurrences as rows — the "every two weeks" chore becomes
twenty-six rows a year — and then have to hide, roll forward, or bulk-dismiss the
ones that passed. Once forty-seven rows exist, some surface will eventually
render forty-seven rows.

## Decision

**Absence never accumulates. It is a principle with schema-level enforcement.**

1. **Recurrences are rules, not pre-generated rows.** A task stores its rule plus
   a single materialised `next_due_on`. **A row is written only when the task is
   disposed of.** Forty-seven overdue rows cannot be rendered because forty-seven
   rows were never created.

2. **Disposition is explicit and happens once.** An item that passes its date
   surfaces **one time**, as a single line, asking *did it* / *skipping it*. One
   tap. Both outcomes write a `task_events` row; either way the item leaves the
   surface and the schedule advances. **A skip is a recorded answer, never
   inferred from silence.**

3. **Overdue collapses.** Anything past its date renders as one line ("3 things
   past due →"), never as N rows.

4. **No streaks, anywhere.** No chains, no "you missed 6 days", no calendar of
   red squares. A check-in has a `skipped` flag; a date with no row is simply
   absent and is never backfilled with a prompt.

5. **Relationship drift is an observation, not a task.** Cadence produces a quiet
   line ("It's been a while — Priya (4mo)"), capped at three at a time, with no
   due date and no completion. Cadence is opt-in per person; most of the roster
   never nags at all.

6. **The writing commitment is a signal, not a to-do.** *Last published 9 days
   ago* — never an overdue item.

Recurrence gets two modes, and the default matters: **`after_completion`**
(*every 2 weeks* means two weeks after you actually did it) is the default,
because the stated use case is menial chores and the alternative leaves you
permanently behind after one late completion. **`fixed`** exists for genuinely
calendar-bound obligations.

## Consequences

- "What is due" becomes a **computation**, not a query over materialised rows.
  Slightly more work in the read path, and it must be got right — including the
  timezone convention ([data-model.md](../data-model.md) §6b), since "overdue"
  compares against a **local** date and `timestamptz` has no notion of a day.
- History lives in the disposition log, which is *better* data than a queue:
  `task_events` records what actually happened, including skips, and yields
  honest adherence ("skipped 4 of the last 6 — maybe every 3 weeks?").
- Editing a recurrence rule cannot break future rows, because there are none.
- **A skipped occurrence is not recoverable after disposition** — advancing the
  schedule is one-way. Accepted: re-doing a skipped chore late is not a thing
  anyone needs.
- If Michael is away for two weeks, several tasks each surface once on return.
  Several single-tap dispositions is not zero friction, but it is bounded by the
  number of *tasks*, not by elapsed time — which is the property that matters.
- **That property has to be built, and it is one line: a fixed schedule advances
  to the first occurrence strictly after *today*, not after the occurrence being
  answered.** The obvious implementation — step once from the answered
  occurrence — costs four taps for three missed Mondays, which is elapsed-time
  arrears wearing a rule's clothing. Added on acceptance, because it is the
  place this ADR is most likely to be reimplemented wrongly.
- This constrains every future HQ surface. Any feature that wants to show a count
  of things not done must be checked against this ADR first.

## Alternatives

**Materialise occurrences, hide the old ones.** The standard approach. Rejected
because the rows still exist, and every subsequent query, export, backup and
"show all" view is one forgotten filter away from becoming the wall. Safety by
discipline instead of by construction.

**Silently roll missed chores forward.** Zero guilt, and it discards exactly the
signal Michael asked for. Rejected by his own answer.

**Streaks and gamification.** Genuinely effective for habit formation in the
general case, and specifically contraindicated here: a broken streak lands
hardest on a bad morning, which is a punishment delivered at the worst possible
moment — and those mornings are exactly what the instrument exists to record.

**Infer skips from silence** (no disposition by end of day ⇒ skipped). Cheaper,
no taps, and it makes the log lie: a day the app was never opened becomes
indistinguishable from a deliberate skip, which corrupts the adherence signal
the whole mechanism exists to produce.
