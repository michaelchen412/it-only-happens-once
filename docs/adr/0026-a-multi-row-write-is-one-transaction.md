# 0026 — A write that must not partly happen is one transaction, in the database

Status: **Accepted** *(2026-08-10 — written late, from
plan 26 (`docs/plans/archive/26-the-merge-keeps-every-link.md`) and the migration
that implements it. Accepted rather than Proposed because the rule shipped with
`20260809013157_vocabulary_merges_are_one_transaction`, applied to production
2026-08-08.)*
Date: 2026-08-10

## Context

Merging a subject, an author or a work is one user gesture — *these two are the
same thing* — and several row-level writes: remap everything pointing at the
row being absorbed, then delete it.

It was implemented as that sequence, in TypeScript, inside an Astro Action, with
every write's result thrown away. **Two ways of losing data followed, both
silent, both reported to the user as success:**

1. **A transient failure mid-remap still reached the delete.** The foreign keys
   on `fragments.author_id` / `fragments.work_id` are `ON DELETE SET NULL`, so a
   half-finished merge quietly **nulled** a fragment's author or work instead of
   moving it — and `fragment_subjects` rows not yet remapped went out with the
   cascade.
2. **The works merge remapped `fragments.work_id` and nothing else.** But
   `person_works.work_id` **cascades**. Merging two works destroyed every
   person's shelf link to the merged-from one, **and the note written on it**.

Neither was visible: the action returned `{ ok: true }`, the row disappeared as
expected, and the loss was somewhere else entirely.

The plan's proposed fix was to check each result in TypeScript and refuse before
the delete. Michael took the stronger one and set the standing rule with it.

## Decision

**A multi-row write that must not partly happen is a `plpgsql` function, not a
guarded sequence of calls from the application.**

- A function is **one statement to Postgres**, so every branch either commits
  whole or rolls back whole. There is no "partly merged" state to recover from,
  and **no ordering for a future reader to get wrong**.
- ⚠ **`SECURITY INVOKER`** — the default, and named explicitly in the migration
  anyway. **RLS stays the trust boundary**; these run as the caller, exactly as
  the actions did. This is the line that keeps the rule from becoming a way
  around [0012](0012-hq-is-a-private-second-domain.md) and the RLS model
  generally.
- An `is_admin()` check at the top of each function is the **readable refusal**:
  without it a non-admin's call would touch zero rows under RLS and return
  success — the silent `{ ok: true }` this whole ADR is about, one layer down.
- **The absorption rule rides along, because it is the same class of silence:**
  the survivor's own values win, and only its **blank** fields are filled from
  the row about to disappear. A merge can *add* information and can never
  *overwrite* it.

## Consequences

- **The correctness argument is stated once, where the work happens**, instead of
  spread across three handlers. The migration header carries it in full; this ADR
  carries the rule.
- **A new class of thing now lives in the database**, and it has to be
  maintained there: the functions are in migrations, and changing a merge means a
  migration rather than an edit to a TypeScript file. Accepted — that is the
  cost of the guarantee, and migrations are already the schema's record.
- **Not every multi-row write qualifies.** The test is *must not partly happen*.
  A write whose partial completion is merely untidy does not need this; a write
  whose partial completion **destroys or silently mutates data the user did not
  name** does.
- **It does not make the application layer redundant.** Validation, authorization
  intent and the user-facing sentence stay in the action; what moved is atomicity.
- **`ON DELETE` behaviour is now load-bearing in a new way.** The two bugs above
  were both FK semantics (`SET NULL`, `CASCADE`) doing exactly what they were
  told, at a moment the application had not finished its work. Any future FK
  onto a mergeable table should be read with this ADR in hand.

## Alternatives

**Check each result in TypeScript and refuse before the delete.** What
plan 26 (`docs/plans/archive/26-the-merge-keeps-every-link.md`) assumed, and it is
**strictly weaker**: the writes already committed *stay committed*. It converts
a silent partial merge into a loud partial merge — better, and still a corrupted
corpus. It also leaves the correctness argument spread across three handlers,
where the next person to add a fourth has to rediscover it.

**"Newest wins" for absorption**, rather than filling only blanks. Simpler to
state and it *silently replaces prose you wrote with prose you wrote* — a change
indistinguishable from a bug a month later, in a corpus whose whole point is that
the writing is the artifact.

**A transaction from the client library.** Not available: PostgREST exposes
statements, not sessions, so `@supabase/supabase-js` cannot open a transaction
across several calls. This is the mechanical reason the choice is *database
function* rather than *wrap the existing code in `BEGIN`* — worth recording,
because "just use a transaction" is the first thing anyone reaches for.

**`SECURITY DEFINER` on the functions.** Would let them run with elevated rights
and make the `is_admin()` check the *only* thing standing between a caller and
the rows. Rejected: it moves the trust boundary out of RLS and into a hand-written
line at the top of each function, which is precisely the "safety by discipline"
this codebase keeps refusing.
