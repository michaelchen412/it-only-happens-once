# 0043 — A script binds per arrival, not per document

Status: **Accepted** *(2026-09-18)*
Date: 2026-09-18
Closes: docs/plans/24 §9, open since 2026-08-07.
Amends [0036](0036-a-reload-is-how-the-observatory-tells-the-truth.md), which
still holds — a write still re-derives by reloading — but whose cost has changed
and is now stated here.

## Context

The Observatory mounted no `<ClientRouter />`. Every navigation between its rooms
was a full document load: the chrome repainted, and every script the next page
carried was fetched, parsed and executed again. `nav-progress.ts` exists because
of it — the press had to be acknowledged by something, since the browser's own
tab spinner is behind a collapsed URL bar on a phone.

Turning the router on had been costed once, on 2026-08-07, and deferred:

> *"a `<script>` module runs ONCE per document, and a view-transition swap
> replaces the DOM without re-running it — so every listener bound directly to a
> page element dies after the first navigation. Counted: **40 files and ~250
> element-bound listener sites** in the admin have no `astro:page-load` re-init.
> That is a migration."*

That deferral was right at the time and the number was the wrong measure, which
only became clear when the work was actually done.

### What made it tractable

**The instrument came before the migration.** The suite had 352 `page.goto`
calls and no others — and `page.goto` is a *full document load*, which re-runs
every script. So the entire e2e suite would have stayed green with every
listener in the building dead. `tests/e2e/walk.spec.ts` navigates by **clicking**
instead, and it was written and baselined *before* the router was switched on, so
the breakage could be measured rather than predicted.

Measured with the router on, against a guess of "40 files / 250 sites":

| | |
| --- | --- |
| scripts the Observatory actually loads | **32** |
| needed nothing at all | **2** — already bound only to things a swap keeps |
| custom elements, self-upgrading | **2** |
| solved by `transition:persist` instead | **1** |
| genuinely migrated | **27** |

**And the first visit masks the whole class.** Astro executes scripts that are
*new to the page*, so walking into a room for the first time runs its module and
everything works. Walk out and back and nothing re-runs. Three probes — the pile,
the Library, the manager — passed a single-visit check and were dead on the
second. A fault that only appears the second time you visit somewhere does not
get reported as a fault; it gets reported as *"it sometimes doesn't work"*.

## Decision

**The Observatory navigates client-side, and an admin script binds its DOM work
on every arrival rather than once per document.**

`scripts/page.ts` is the one mechanism. `onPage(boot)` registers `boot` for
`astro:page-load`, which fires on the initial load *and* every navigation, so the
boot is never also called directly — doing both would double every binding on the
first page.

**A listener on `document` or `window` goes through the `page.on` the boot is
handed.** This is the half that matters. The two failures are opposites:

- an element listener **dies** — the element was thrown away, and somebody
  notices the moment they press it;
- a `document` listener **accumulates** — `document` survives the swap, so
  re-registering leaves N copies after N visits, and one press files a note
  twice, opens two dialogs, sends two writes. Nothing looks wrong until the
  second one lands.

`page.on` records what it registered and removes it on the way out, so the count
cannot grow. A `page.cleanup` covers anything else that must be undone — in
practice, destroying the TipTap instances a boot mounted, which ProseMirror keeps
reachable through its own listeners and which are therefore never collected.

### Three things this is not

**Not a rule carried by a comment.** `src/tests/page-boot.test.ts` scrapes the
admin pages for the scripts they load and asserts both halves. It found four
scripts a manual survey had missed, in nested routes. Exemptions are named in
that file with the reason each is safe, because a list without reasons grows
until it means nothing.

**Not `onPage` everywhere.** The ✚ carries `transition:persist` instead: its
dialog has a mounted editor inside it, and re-booting on every navigation would
re-mount 512 KB of TipTap each time you crossed the building — the exact cost
[0043's sibling work](../admin.md) had just removed. Persisting also says the
truer thing, since the ✚ is one control the rooms move past rather than a thing
each room has a copy of. **A component whose state should survive a navigation
persists; a component that should be rebuilt uses `onPage`.**

**Not a replacement for the progress bar.** A swap still fetches the next page,
so the frame between the press and the arrival is exactly as empty as it was.
`nav-progress.ts` still earns its place, and its `astro:page-load` clear — written
six weeks early, against this day — now has a real event to hear.

## Consequences

- Navigating between rooms no longer re-parses the admin bundle. Combined with
  the lazy-editor work of the same week, the pile went from 563 KB of
  critical-path JS to 52 KB, and now does not re-execute even that on a walk.
- **A new admin script must call `onPage`**, or `page-boot.test.ts` fails with
  the reason. This is the rule's real enforcement; the ADR is only its argument.
- [0036](0036-a-reload-is-how-the-observatory-tells-the-truth.md) is unchanged —
  `location.reload()` is still a full document load and still the honest way to
  re-derive after a write. Its **cost has risen relative to its neighbours**,
  though: a reload now throws away a document the router would have kept. That
  is a reason to prefer a patch where 0036 already allows one, not a reason to
  reopen it.
- The public site was already on `<ClientRouter />`; the two halves of the app
  now agree, and `site-search.ts`'s note about the difference between them is the
  last place that difference is described.
