# 0039 — An instant and a calendar date are different values

Status: **Accepted** *(2026-08-18 — decided by reading the write path before
changing the read path, which is what turned the first answer over. The
go-forward fix is in the tree; the backfill of the rows already wrong is
separate and is named in Consequences.)*
Date: 2026-08-18

> **An instant renders in the viewer's zone. A calendar date renders in no zone
> at all. They are different kinds of value and they take different treatments —
> and a surface must decide which one it holds before it picks a helper.**

## Context

`docs/admin.md` §11a and `architecture.md` §106 both state a project rule:
**times on screen are never UTC.** `AdminLayout` mounts `local-time.ts` so no
page has to remember to opt in. The rule is right and the mechanism is good.

Plan 42 · §4.C.7 found the fragment manager standing outside it — `occurred_at`
and `updated_at` printed as bare strings with `timeZone: 'UTC'`, invisible to
the mechanism. The obvious fix was to apply the stated rule.

**Applying the stated rule literally to `occurred_at` produces a second bug**,
and `lib/fragments-display.ts` said so in its own comment, arguing the opposite
side well:

> *"UTC, so it never drifts by a day."*

Both hazards are real, which is what makes this a decision rather than a fix:

- **In UTC:** an evening in the Americas rolls forward. A quote saved at 6pm
  Pacific stores `…T01:00Z` and is filed under **tomorrow**.
- **In the viewer's zone:** a backdated essay stored as `2023-04-19T00:00:00Z`
  renders as **18 April** for every reader west of Greenwich.

### What the write path showed, and it moved the fix

The draft of plan 42 proposed rendering `occurred_at` from its stored Y-M-D with
no conversion — a display change. Reading `actions/fragments.ts` first is what
found that this could not work:

- A **backdated** piece goes through `occurredAtFrom`, which stores that day's
  midnight. Reading its Y-M-D back is already exactly what was typed. **The
  proposed change was a no-op here.**
- An **auto** date was `occurred_at = now` — an **instant**. ⚠ **No rendering
  repairs a wrong day that is already in the column.**

**So the hazard is created at the WRITE site.** The two paths were writing two
different kinds of value into one column, and every reader downstream was left
to guess which one it had.

### Three readers, one column

⚠ **The audit counted two conventions and there were three.** Beside
`shortDate` (UTC) and `homeDate` (the configured zone), the **public**
`Timestamp.astro` passed **no `timeZone` at all** — so the blog rendered
whatever zone the server happened to be in. It also printed a **time of day**
for a value that never carried one: *"Posted on Thursday, July 6, 2023 at 12:42
AM"*, a clock reading invented for a calendar date.

## Decision

**A column holds one kind of value, and the kind decides the treatment.**

| | what it is | written as | read as |
|---|---|---|---|
| `updated_at`, `published_at` | an **instant** | `new Date().toISOString()` | the viewer's zone, or the configured home zone server-side |
| `occurred_at` · `date_precision: 'day'` | a **calendar date** | that day's **UTC midnight**, in the configured home zone | `timeZone: 'UTC'`, **no time of day** |
| `occurred_at` · `date_precision: 'year'` | a **year** | Jan 1 noon UTC | the year alone |

The auto date is minted as *today in the configured home zone*
(`autoOccurredAtFor`), which is what makes the two writers agree: a backdated
piece and an auto-dated one now store the same shape.

⚠ **`ymdToUtc(localToday(tz))`, not `zonedTimeToUtc(today, '00:00', tz)`** — and
the near-miss is worth recording because it looks more correct. Storing a real
local midnight is harmless at `07:00Z` for Los Angeles and **`15:00Z` the
previous day** for Tokyo, so the UTC read comes back a day early and the bug
returns wearing the opposite sign. A calendar position has no zone by
construction.

### Against GROUND-RULES' three questions

1. **Constrains unspecified work?** **Yes.** Every future surface printing a
   date now has to answer *instant or calendar date?* before it picks a helper,
   and the corpus already has three cases resolving three different ways.
2. **A rejected alternative a competent person would re-propose?** **Yes, and it
   was in the tree in writing** — `fragments-display.ts`'s *"UTC, so it never
   drifts by a day."* It is a good argument against a real hazard, and the next
   person to meet a date drifting a day will reach for exactly it.
3. **Reconstructible from the repository alone?** ⚠ **No, and this is the one
   that decides it.** §11a and §106 say *"never UTC"* and stop there — **neither
   carves out a calendar date** — so applying the stated rule literally produces
   the second hazard. And the fix deletes the only place the counter-argument
   lived.

**The existing docs are not wrong, they are incomplete** — which is why this
refines a stated rule rather than restating one. `architecture.md` §106 carries
a pointer to this record, the way it does for 0028.

## Consequences

**Done, 2026-08-18.** `autoOccurredAtFor` mints the calendar date;
`Timestamp.astro` reads in UTC and no longer prints an invented time; the
manager's two columns already split in plan 42's batch E.

⚠ **THREE THINGS THE BUILD TURNED UP, none of them visible from the decision:**

- **The column default is the same mistake one layer down.**
  `occurred_at timestamptz not null default now()` is an instant standing in for
  a calendar date, in SQL, where none of this reaches it — so a **draft** created
  at 6pm Pacific was filed under tomorrow too. `persist` now sets the value on
  **insert** as well as on first publish, which fixes it without a migration and
  leaves the default as nothing but a backstop.
- ⚠ **`occurredAtFrom` depended on the server's timezone being UTC.**
  `new Date('2023-04-19T00:00')` parses in the process's zone; Vercel runs UTC,
  so production was **right by accident**. It reads the wall clock as UTC now — a
  no-op in production, and it removes the dependency. **Found by the unit test
  pinning the two write paths together, not by review.**
- ⚠ **`Timestamp.astro`'s `updated` half is deliberately still not compliant**
  and is recorded rather than smuggled. `updated_at` is an instant, so it belongs
  in the viewer's zone; rendered on the server it can only be the server's.
  Fixing it wants a client pass, and `local-time.ts`'s two modes both drop the
  **year**, which that line needs against posts from 2022.
  `fragments-display.ts` met this exact wall and declined it in the same words
  (*"full compliance wants a third mode"*). Same call, same reason: the
  discrepancy is hours, not a day.

⚠⚠ **THE ROWS ALREADY WRONG ARE NOT FIXED BY ANY OF THIS, and that is the open
item.** Measured against production on 2026-08-18:

| | rows | filed under the wrong day |
|---|---|---|
| writing · published | 56 | **17** |
| writing · draft | 26 | 4 |
| quote · published | 78 | 0 — 71 sit at exact UTC midnight and are calendar dates already |

Every one of the 17 is an evening-Pacific timestamp: *Color* stored
`2023-07-06 00:42Z`, written `2023-07-05 17:42` local. **30% of published essays
are dated a day late on the public site**, and only a backfill repairs them —
`occurred_at → UTC midnight of its home-zone day`, writing and drafts only.
⚠ **Quotes must be excluded**: their UTC-midnight values are already correct and
a blanket zone-shift would break them in the other direction.

**What would falsify this.** If the site ever serves a reader for whom the
authored day is not the meaningful one — a second author in another hemisphere,
or a feed that must sort by the moment of writing rather than the day claimed —
then `occurred_at` is carrying two jobs and wants splitting into a `date` column
and an instant, rather than one column read two ways.
