# 0016 — HQ's layering: `lib/hq` decides, loaders gather, pages render

Status: **Accepted** *(2026-08-04 — written after the fact, from a code audit of
what plans 10–14 actually built; see [0012](0012-hq-is-a-private-second-domain.md)
for the boundary this sits inside)*
Date: 2026-08-04

## Context

HQ was built in five plans over about a week — the check-in, People, the Agenda,
Capture — and each shipped a working surface. Nobody wrote down how the layers
were supposed to relate, because the first plan did not need it and every plan
after it followed the shape of the one before.

An audit on 2026-08-04 found what happens when that convention is only a habit:

- **Today's task view-model existed twice**, comment for comment, in
  `admin/index.astro` and `admin/agenda/tasks.astro` — the same two queries, the
  same `Row` shape, the same type predicate.
- **`admin/index.astro` carried ~170 lines of data layer**, so the page named
  "Today, assembled" was where Today was assembled, while `lib/hq/today.ts` —
  the module with that name — held only the rules.
- **`agenda.astro` hand-rolled `new Date(\`${ymd}T00:00:00Z\`)` in four places**
  while importing `parseYmd` from `lib/hq/time.ts`, the module whose opening
  comment exists to say that a second derivation of a local date is the bug the
  module was written to prevent.
- **The `<CalendarItem>` builders** were written out in both pages, including the
  same nullable two-level `event_people` unwrapping.

None of it was broken. All of it was one edit away from being broken in one
place and not the other — which is the failure mode this domain can least
afford, because a disagreement about *which occurrence a task is standing on*
surfaces weeks later as a chore that quietly stopped appearing.

The rule was already written down, in `lib/hq/today.ts`'s own header: *"the rules
that decide what is on the page, separated from the page so they can be tested
and so no zone invents its own answer."* It was simply not enforced anywhere.

## Decision

**Three layers, and each one is defined by what it may import.**

| Layer | Example | May import | Must not |
|---|---|---|---|
| **Rules** | `today.ts`, `tasks.ts`, `dates.ts`, `time.ts`, `goals.ts`, `recurrence.ts` | other rule modules | a Supabase client, at runtime |
| **Loaders** | `today-data.ts`, `brief.ts`, `links.ts`, `calendar.ts`'s queries | rules; Supabase as a **type** | rendering concerns |
| **Pages / zones** | `admin/index.astro`, the `*Zone.astro` components | both | build a view-model of their own |

Four consequences of that table are the actual decision:

1. **A rule module is pure and takes local-date strings.** It runs unchanged in
   the browser and on the server, which is what makes a lead or a recurrence
   trustworthy: `task-sheet.ts` computes the lead sentence with the same
   function the action uses to advance the schedule.

2. **A loader takes a client as an argument and imports Supabase as a type
   only.** `time.ts` established this and `calendar.ts` states it; it means a
   module can query without dragging a client into the browser bundle.

3. **A page fetches by calling one loader, and renders.** It may decide *which*
   loader to call — `admin/index.astro` skips `loadToday` entirely when you step
   off today, and that guard belongs to the page because the page owns the
   question "which day is this about". It may not assemble.

4. **Routing belongs to the page.** `eventItem()` and `birthdayItem()`
   deliberately set no `href`: Today sends an event to the day panel, the
   calendar is already in the day panel, and a default in the shared builder
   would have to be wrong for one of them.

**Authorization is not a layer.** RLS is the trust boundary
([0012](0012-hq-is-a-private-second-domain.md), [auth.md](../auth.md)); every
action runs on `ctx.locals.supabase`, and `requireAdmin` is a courtesy that
produces a readable sentence, never the thing standing between a stranger and
the data.

## Consequences

**Good.**

- The logic became testable, and immediately was: `liveAndAnswered` has 7 tests
  where the two copies it replaced had none, because neither was reachable from
  anything but a browser.
- "Where does this go?" has an answer that does not depend on taste. A pure
  question is a rule; a question needing rows is a loader; anything else is the
  page.
- The browser bundle stays honest. The two modules that reach it through
  `task-sheet.ts` are structurally prevented from acquiring a database client.

**Bad, and accepted.**

- **A loader is one more file than putting the query in the page**, and for a
  surface with one query that is real overhead. The line drawn: if two surfaces
  need the same rows, or if the shaping is more than a `.map()`, it is a loader.
  One query feeding one page can stay in the page — `agenda.astro` still holds
  its own, and that is not a violation.
- **`today-data.ts` is not obviously named for the tasks room**, which also
  calls `liveAndAnswered`. The alternative — splitting it per consumer — would
  have re-created the duplication this ADR exists to remove.
- **The rule/loader line has an awkward middle.** `people.ts` is mostly pure and
  has `signPhotos` in it; `calendar.ts` is mostly types and has two queries.
  Both predate this ADR and neither is worth moving; the test is whether a
  browser-bound module can be reached with a client attached, and neither can.

## Alternatives

**Leave it as convention.** It had been convention for five plans and produced
four duplications in one audit. Conventions that are not written down are
re-derived by whoever is next, including the same person a fortnight later.

**Put the loaders in the rule modules** (`loadToday` in `today.ts`,
`liveAndAnswered` in `tasks.ts`). Read as tidier and was the audit's own first
sketch. Rejected on the browser-bundle promise: `tasks.ts` reaches the browser
through `task-sheet.ts`, and the whole reason the lead rule is believable is
that both sides run the identical function. A module that might acquire a client
is a module that will.

**A repository layer** — one class per table, methods for every read. It is the
familiar shape and it is wrong for this app: the queries here are *page-shaped*,
not table-shaped (Today wants thirteen tables at once and nothing else ever
wants that combination), so a repository would be a thin wrapper nobody reuses,
plus a second place to look.

**Do nothing and rely on review.** The duplications were introduced by a
reviewer who had read the file that forbade them. Structure survives what
attention does not.
