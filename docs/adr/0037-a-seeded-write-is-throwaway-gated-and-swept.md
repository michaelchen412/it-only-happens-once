# 0037 — A seeded write is throwaway, gated and swept

Status: **Accepted** *(2026-08-15 — written late, from plan 41 · §3 and §10. The
mechanism shipped 2026-08-09 with `library.spec.ts`; what was missing was the
rule.)*
Date: 2026-08-15

Extends [ADR 0028](0028-the-e2e-suite-is-read-only-against-live.md). **Nothing
in it is reversed** — the suite is still read-only by construction and opting
out is still a named line of code. What this adds is the case 0028 did not have
when it was written: a spec that genuinely needs a row, and the discipline that
makes one safe.

## Context

0028's Consequences say, of a spec that needs to write:

> **A spec that genuinely needs to write has nowhere good to go.** Today none
> does. When one does, that is the second reopen trigger below firing…

One does. `library.spec.ts` proves that a vocabulary **merge** keeps a person's
shelf link *and the note written on it* — the exact loss
[ADR 0026](0026-a-multi-row-write-is-one-transaction.md) exists to prevent. A
stub can record which action was called; it cannot show that the survivor kept
the note, because there is no survivor and no note. That assertion needs real
rows.

So the mechanism was built — `tests/e2e/db.ts` — and it is good. What it never
got was a rule, which means the next spec that needs a row has to rediscover all
five parts of it or invent worse ones. That is the gap this closes.

⚠ **There is still no local Supabase stack, and this does not ask for one.** The
rows are written into Michael's live project. Everything below follows from that
one fact.

## Decision

**A spec may create rows in the live project only if all five hold. They are one
rule, not a checklist to pick from.**

1. **Off by default, behind a named environment flag.** `E2E_ALLOW_WRITES=1`.
   `npm run test:e2e` must stay read-only, because it is the thing you run
   without thinking; a spec that seeds is one you *choose* to run.
2. **Every seeded row carries the `zzz-e2e-throwaway` prefix**, in its slug
   **and** in its visible name. ⚠ It is ugly on purpose: if a teardown ever
   fails, what is left behind must be obviously disposable at a glance in a room
   Michael actually opens. A plausible-looking work called "Notes" would sit
   there for a year. `zzz` also sorts it to the bottom.
3. **The sweep runs in `afterEach`, not at the end of a test body** — so it runs
   when an assertion *fails*, which is the case that actually leaves litter —
   **and it sweeps previous runs too**, so an interrupted run cleans up on the
   next one rather than never.
4. **The service-role key lives under `tests/` and nowhere else.** It bypasses
   RLS, so nothing in `src/` may import it, and the standing audit finding is
   that it appears in no request-handling code.
5. **The spec drives the real control through the admin's own session**, and
   uses the service client only to *seed* and to *assert on the rows
   afterwards*. A test that writes through the service client and then checks
   the screen has proved nothing about the write path.

⚠ **AND THE READ/WRITE DISTINCTION 0028 COULD NOT DRAW.** Its third reopen
trigger is *"the `allowActions` allowlist reaching roughly five entries — at
which point the exception is the rule."* That was written when every opt-out was
the same kind of thing. It no longer is, and counting them together makes the
trigger measure the wrong quantity:

- **An opt-out that can WRITE** is what the guard exists to bound. There is
  exactly one, and it is gated by rule 1.
- **An opt-out that names only READS behind `requireAdmin`** does not weaken
  read-only at all — the suite is still 100% read-only with six of them. What it
  buys is the only thing that checks a `select` against the real schema, which
  is not a small thing: `20d8577` is a query that pointed at a table that had
  moved, green in every check, because *a stub records the call you made, not
  the schema you made it against*.

**So trigger 3 counts write-capable opt-outs, and reads are a separate, bounded
category.** `e2e-read-only.test.ts` holds both numbers.

## Consequences

- **The next spec that needs a row has a rule to follow** rather than a file to
  imitate, and the five parts are testable individually.
- **`npm run test:e2e` is unchanged** and stays the thing you run without
  thinking.
- ⚠ **A failed sweep leaves real rows in a real corpus.** That is the residual
  risk and it is not zero; rules 2 and 3 make it visible and self-healing rather
  than absent. The alternative — seeding on every run — was rejected on
  2026-08-09 precisely because the suite is the thing that gets interrupted
  with ⌃C.
- **Allowing a read by name buys nothing on its own.** `allowActions` *permits*;
  it does not *cause*. A name on the list with no spec driving that flow is
  inert, so the work is always writing the spec, and the allowlist entry is the
  paperwork that follows it. Stated because the opposite is an easy and
  satisfying mistake to make.
- **0028's trigger 2 is now spent**, and its Status carries a pointer here.

## Alternatives

**A local Supabase stack.** Refused again, for 0028's own reason: it needs the
schema *and* enough of the corpus to be worth testing against, so it becomes a
second dataset to seed, keep current, and debug when it diverges — for a suite
whose value is that it drives the **real** workshop with the real content in it.

**Database branching.** Refused by Michael on 2026-08-10 and unchanged: it buys
isolation between concurrent workstreams, and there is one developer.

**Never write; assert only what a stub can prove.** What 0028 assumed, and
plan 26 showed the limit of: the merge bug destroyed a note, and every
stub-level assertion about it passed. A test that cannot fail on the thing that
broke is not covering it.

**Write through the service client and assert on the screen.** Cheaper to set up
and it inverts the point — it proves the fixture, not the action. Rule 5 exists
to refuse it.
