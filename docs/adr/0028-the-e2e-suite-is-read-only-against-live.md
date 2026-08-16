# 0028 — The e2e suite runs against the live project, and read-only is enforced by construction

Status: **Accepted** *(2026-08-10 — written late, from
plan 27 (`docs/plans/archive/27-the-nets.md`) §3 and
plan 31 (`docs/plans/31-the-first-two-minutes.md`) §4. Accepted rather than
Proposed because the fixture shipped 2026-08-09 and the refusal it depends on
was taken 2026-08-10.)*

⚠ **Trigger 2 below has since fired, and the answer is
[ADR 0037](0037-a-seeded-write-is-throwaway-gated-and-swept.md).** A pointer
only: nothing here is reversed, and the Consequences' *"Today none does"* is
left standing as what was true on the day it was written. 0037 also draws a
distinction this record could not — trigger 3 counts opt-outs that can **write**,
not ones that name only reads.
Date: 2026-08-10

## Context

**There is no local Supabase stack for this project**, and no plan to add one.
The Playwright suite therefore runs against the **live** Supabase project —
Michael's real corpus, his real check-ins, his real people.

That makes "read-only" not a nicety but the only thing standing between a green
test run and rows appearing in the corpus. Until 2026-08-09 it was a
**convention**: 23 of 49 spec files called `stubActions`, the other 26 simply did
not write, and nothing checked.

Concretely, from plan 27's audit: `tasks.mobile.spec.ts` filled `[data-due]` and
dispatched `input` with **no stubs at all**. It was safe only because the task
sheet has no autosave — and the writing sheet next door has had one (1.2s after
you stop typing) since plan 06. **The day the task or log sheet gained the same
behaviour, a green mobile spec would have written to production.**

The conventional answer to all of this is a local stack or ephemeral database
branches. That was put to Michael on 2026-08-10 and refused.

## Decision

**The suite runs against the live project, and the read-only guarantee is
structural rather than per-spec discipline.**

1. **The shared `test` fixture blocks `**/_actions/**` for every spec, by
   default, before the test body runs.** `tests/e2e/fixtures.ts` owns this;
   specs import `test` from there, never from `@playwright/test`.
2. **Opting out is possible and deliberate** — `allowActions` — but it is a line
   of code with a name, **which is what makes it a decision rather than an
   omission**.
3. **Database branching is refused**, with three named triggers that would
   reopen it (below).

## Consequences

- ⚠ **Three things the guarantee does not cover, stated because a guarantee you
  misread is worse than none:**
  - `page.route` only sees the **browser's** requests. Playwright's own
    `request` fixture bypasses it entirely — three specs use it, all
    `GET /admin/export.json`, all read-only. A spec that POSTed through
    `request` would not be stopped by anything here.
  - It blocks the **actions endpoint**, not every write. Nothing prevents a spec
    from importing `@supabase/supabase-js` and writing directly — which is
    exactly what `auth.setup.ts` does with the service-role key.
  - It stops the **request**, not the intent. It cannot make an
    already-written row go away.
- **The suite cannot run in CI**, and that is downstream of this decision rather
  than a separate one: minting an admin session needs
  `SUPABASE_SERVICE_ROLE_KEY`, and putting that in GitHub Actions secrets would
  widen where the service-role key lives. So **detection is local**, and
  `.github/workflows/verify.yml` says so in its own header.
- **A spec that genuinely needs to write has nowhere good to go.** Today none
  does. When one does, that is the second reopen trigger below firing, not a
  reason to quietly add `allowActions`.
- **Every new spec inherits the guarantee for free** and has to work to lose it.
  That is the whole difference from the convention it replaced.

## Alternatives

**Supabase database branching** — an ephemeral database per branch or per run.
The conventional answer, and the one a new session will propose first. Refused by
Michael 2026-08-10: *"personal and straightforward enough… overkill and extra
mental overhead."*

The argument holds beyond taste: branching buys **isolation between concurrent
workstreams**, and this board already established that concurrency is not
happening — *"a file boundary drawn for concurrency that isn't happening is just
a wrong answer with extra steps."* Same mistake, one layer down.

⚠ **Three triggers would reopen it**, and none holds today:
1. **A second person** working in this repository.
2. **A spec that needs a write it cannot confine** to a stub.
3. **The `allowActions` allowlist reaching roughly five entries** — at which
   point the exception is the rule.

**A local Supabase stack** (`supabase start`). Cheaper than branching and it
still loses: it needs the schema *and* enough of the corpus to be worth testing
against, so it becomes a second dataset to seed, keep current, and debug when it
diverges — for a suite whose value is largely that it drives the **real**
workshop with the real content in it.

**Keep the convention, and add a checklist.** What existed. It failed silently
for 26 of 49 files and was one autosave away from writing to production; the
whole point of the fixture is that it cannot fail that way.

**Point the suite at a preview deployment instead.** Moves the risk rather than
removing it — a Vercel preview reads and writes the *same* Supabase project, so
every hazard above is unchanged and the run gets slower.
