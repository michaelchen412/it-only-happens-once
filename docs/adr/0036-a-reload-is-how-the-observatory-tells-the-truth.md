# 0036 — A reload is how the Observatory tells the truth

Status: **Accepted** *(2026-08-15 — written late, from plan 41 · §5. Accepted
rather than Proposed because the rule has governed every admin surface since HQ
was built; what was missing was an address for it.)*
Date: 2026-08-15

## Context

`location.reload()` appears **31 times across 20 client modules** in
`src/scripts/`. Every one of them runs after a successful write.

Nothing in the repository says why. The reasoning existed — three call sites
argue it well, `task-sheet.ts` best of all — but it was spread across comments
in the files that happen to do it, so a reader meets the decision thirty-one
times as an apparent *absence* of state management rather than once as a choice.
That is the shape of finding a codebase has when nobody wrote the rule down, and
it is what an audit on 2026-08-15 reported it as before reading the call sites.

The cost is not hypothetical either. `dialog-close.ts` opens by describing a
`location.reload()` tearing a page down two frames into a dialog's exit
animation, which is the bug that produced `afterDialogClose` in the first place.

## Decision

**After a write, an admin surface re-derives its state by reloading, and patches
the DOM only where a reload would destroy something the page is holding.**

The argument is not that reloading is cheap. It is that **the alternative is a
second implementation of every derived thing on the page**, in JavaScript,
racing the one in SQL:

- Ticking one task changes which GROUP it belongs to, how late it is, the count
  beside every heading, and the badge in the chrome. Four derivations, four
  chances to disagree with the database, in a room whose entire purpose is that
  you can trust what it says about today.
- The Observatory is **one signed-in user on their own data**. A reload costs a
  round trip nobody is competing for, and `no-store` on `/admin` (see
  [`architecture.md`](../architecture.md) §3) means the request actually happens
  rather than being answered from a stale cache.
- Re-deriving is **total**. Patching is partial by construction, and its failure
  mode is a screen that is quietly wrong — the same class of failure
  [`_shared.ts`](../../src/actions/_shared.ts)'s `requireAdmin` note is about,
  where the interface reports something that did not happen.

⚠ **The exception is where a reload would throw away state the page owns and the
database does not.** Two exist, both deliberate:

- **The notes room.** Filing a brain dump as a task announces `hq:note-filed`
  and lets the pile tidy itself, because a reload would discard the undo strip
  at the exact moment it has something to offer — and nothing on that page is
  derived from the task at all.
- **A control that moves first.** The goal status segments and the pin write
  optimistically and roll back on refusal, because a segmented control that
  waits for a round trip is not a segmented control.

The test for a new one: **does the page hold something the database has never
been told about?** If not, reload.

⚠ **A reload must not race an exit animation.** `closeWithExit(dialog)` resolves
after the dialog has finished leaving; the reload goes after it, not beside it.
This is the rule `dialog-close.ts` exists to keep, and it is part of this
decision rather than a separate one.

## Consequences

- **The Observatory's correctness does not depend on anyone remembering to
  update four things.** The database is the only model, and the page is a
  rendering of it.
- **It does not scale to a multi-user surface**, and it is not meant to. Nothing
  public reloads: the reader-facing side is edge-cached and static-feeling by
  design, and this rule is scoped to `/admin` for the same reason `no-store` is.
- **Every reload is a visible flash.** Accepted, and it is the honest cost. On a
  local network against a `no-store` route it reads as a redraw; it would not
  survive a slow connection, and if the Observatory ever has to, this is the ADR
  to reopen.
- **`bfcache` is already gone** for the admin area, so a reload is not fighting a
  restore. The two decisions support each other.

## Alternatives

**Patch the DOM after each write.** The instinct anyone arriving from a
component framework has, and the reason this needed an address: 31 call sites is
exactly the volume that invites a sweeping "fix". It replaces one query with a
hand-written copy of every derivation on the page, and the copies fail silently
— a count that is wrong looks exactly like a count that is right.

**Refetch the page and swap a fragment of it.** What
`fragments-panel.ts` does, and it is genuinely better *where the fragment is
self-contained*. It is not free: the swap is page-sized main-thread work, and
`dialog-close.ts` had to defer it behind the exit animation for precisely that
reason. Worth reaching for when a reload is measurably in the way; not worth
adopting as the default, since it still requires deciding what the fragment's
boundary is, per surface.

**A client-side store.** The framework-shaped answer, and the one this codebase
has already refused twice — no UI framework, no hydration, *the DOM is the
state* ([`architecture.md`](../architecture.md) §6). Adding a store to avoid
reloads would import the whole problem set it exists without: staleness,
invalidation, and two models of the same rows.
