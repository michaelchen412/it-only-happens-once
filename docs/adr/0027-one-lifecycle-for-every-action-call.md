# 0027 — Every action call goes through one lifecycle, and a test enforces it

Status: **Accepted** *(2026-08-10 — written late, from
plan 25 (`docs/plans/archive/25-the-save-survives.md`) and the code that
implements it. Accepted rather than Proposed because both halves shipped:
`submitAction` / `callAction` in `569395b`, and the tripwire in `000d279`.)*
Date: 2026-08-10

## Context

**`astro:actions` throws on a dead network rather than returning `{ error }`.**
The fetch underneath rejects, so a bare `await actions.x.y(…)` skips *every line
after it* — the re-enable, the dialog close, the sentence that was supposed to
explain what happened. The button stays disabled, nothing is said, and the
change the screen is still showing never reached the database.

The class only misfires when the network is down, **which is never while you are
testing**. It is invisible to typecheck, to lint, to the unit suite, and to any
amount of using the app on a working connection.

Two rounds of trying to hold this by convention failed, and the numbers are why
this ADR exists:

- **The comment did not work.** The invariant was carried by a warning pasted
  into sixteen files. A full-repo audit on 2026-08-08 ran the grep
  plan 15 (`docs/plans/archive/15-freshness.md`) had asked for and found **nine of
  the fifty-nine client scripts had missed the paste** — one of them the
  quote/song Save, which offline stuck disabled for the life of the sheet with
  nothing on screen. **A convention that fails at 15% of its sites is not a
  convention.**
- **The obvious hand-rolled fix was itself the bug.** Every HQ save path between
  2026-08-02 and 2026-08-04 wrote `err instanceof Error ? err.message : '…'`.
  It looks equivalent and is not: **`TypeError` extends `Error`**, so a dead
  network takes the first branch and prints `Failed to fetch`, while the friendly
  offline sentence written for exactly that case is unreachable. Found by audit,
  not by use.

Eight sheets then hand-rolled the same disable → await → format → restore
lifecycle, ~200 lines of it, identical and separately maintained.

## Decision

**One lifecycle, in one place, with a test that stops the next file opting out.**

1. **`submitAction`** owns the whole lifecycle for a submit-shaped control:
   disable, set the busy label, await through `callAction`, format *any* failure
   — thrown or returned — through `formatActionError`, and restore in `finally`.
   Reach for this first.
2. **`callAction`** is the narrower tool: it awaits an action and turns a
   **throw** into an `{ error }` like any other failure, for callers that own
   their own UI.
3. **`formatActionError`** is the only permitted way to turn a failure into a
   sentence. ⚠ **Do not hand-roll `err instanceof Error ? err.message : …`** —
   see Context.
4. **A promise chain must always settle resolved** —
   `.catch((e) => say(formatActionError(e), true))` — so one failure cannot
   poison the saves queued behind it.
5. ⚠ **The tripwire is a test with a per-file allowlist**
   (`src/tests/action-guard.test.ts`), not a lint rule. Any file holding a bare
   `await actions.…` must be on the list **with a sentence saying who catches the
   throw**. The allowlist is the debt, and it only ever shrinks — a second
   assertion fails on stale entries, so a file that stops holding one has to be
   removed from the list.

## Consequences

- **The failure mode moved from silent to loud at the right layer.** A save that
  cannot reach the server now says so in the sheet, in a sentence written for a
  human.
- **Adding a bare await is still allowed, and now costs a sentence.** Twelve
  files are on the allowlist today, each with its reason — most because every
  await sits inside a `try` whose catch ends in `formatActionError`, two because
  the guard is one level up in the caller. That is the honest granularity: the
  test asks *which files hold one at all*, not whether each is safe.
- ⚠ **Two blind spots, written into the test rather than pretended away.** It
  matches **text**, so it cannot see an action awaited through an alias
  (`await action(fd)`, `await call(actions.…)`), and it cannot tell a guarded
  await from an unguarded one.
- **`src/tests/` is skipped by the walker**, because the test file quotes the
  pattern it hunts for — in prose and in a regex — and no comment filter can be
  trusted to tell those from a real call.
- **This constrains every new client script.** A file that writes through
  `astro:actions` and is not on the allowlist must use the helpers; there is no
  third option that passes `verify`.

## Alternatives

**Leave it to the comment.** Measured and rejected on its own numbers: 9 of 59
files, and the one that mattered most was a Save. This is the alternative with
the strongest evidence against it in the whole repository.

**An ESLint `no-restricted-syntax` rule on `await actions.`** — the AST version,
and the one plan 25 (`docs/plans/archive/25-the-save-survives.md`) left as an open
question. Rejected, and the reason is specific: **the rule would have to decide
what counts as a sufficient `try`**, and *a `try` whose catch hand-rolls
`err.message` is the exact half-pattern this codebase already paid for* — see
Context, and `admin/people/[slug].astro`, which had the catch and still could
not say the sentence it carried. A rule that green-lights that pattern is worse
than no rule, because it certifies it. Measured 2026-08-10: **29 of the 33 bare
call sites in `src/` already sit inside a `try` or check `error` explicitly**, so
an AST rule strict enough to be useful would fire almost entirely on correct
code — and a config that fires on correct code is one that gets disabled, which
is `eslint.config.js`'s own stated argument for staying permissive.

> Measured 2026-08-10, by classifying every bare site in `src/`: **31 real call
> sites, of which 29 sit inside a `try` or check `error` explicitly.** The
> remaining two are `notes.ts`'s undo callback, whose invoker catches — which is
> the allowlist's own entry for that file. So the AST rule would fire on 31
> sites and be *right about none of them*.

**Make `callAction` mandatory by removing direct access to `actions`** (a wrapper
module, with the raw import banned). Genuinely airtight, and rejected as
disproportionate: it adds an indirection layer to every call site to catch a
class the allowlist already catches, and it would break the two files whose guard
is legitimately one level up in the caller.
