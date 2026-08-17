# 0038 — A private admin surface may require JavaScript

Status: **Accepted** *(2026-08-17 — Michael's call, taken while the plan that
raised it was still being written, and built the same day.)*
Date: 2026-08-17

## Context

`/admin/sets` rendered every set as an open `<form>` on the list page, with no
client script at all, and defended that in a comment worth quoting in full
because this record exists to overrule it:

> ⚠ **PLAIN FORMS, NO CLIENT SCRIPT, AND THAT IS A DEPARTURE WORTH DEFENDING.**
> Every other room in the workshop is JS-driven — sheets, drawers, panels —
> because they edit objects with a dozen fields, bulk selection and live preview.
> A set has FIVE fields and there will be about seven of them. Astro's actions
> accept a form POST natively, so this page is server-rendered, works with script
> disabled, cannot get its optimistic state out of step with the database, and is
> about a tenth of the code a sheet would be.
>
> If a set ever grows a sixth field or the list passes ~30 rows, that argument
> expires and this becomes a sheet like its neighbours.

Three of those claims did not survive measurement, and the first is the one that
matters.

**1. ⚠ The PAGE was the commit unit, so the room could lose work.** Every card
being a live form meant that a reorder, a delete, or a Save on *any* card issued
a POST, redirected and reloaded — **silently discarding unsaved text in every
other card**, with no guard and no warning. `/admin/library` has the identical
hazard and **guarded it on 2026-08-12** (`library.ts`, a confirm naming the other
dirty rows). The sets page shipped unguarded three days later, which is what a
rule held by habit rather than by code looks like after seventy-two hours.

**2. Its own escape clause had already fired.** The card rendered **six**
controls — title, slug, playlist, quote, description, status — on the day the
comment claiming five was written. The second condition (thirty rows) had not
fired and still has not.

**3. "A tenth of the code" is not true.** `GoalSheet.astro` is **126 lines** for
five fields. A set sheet plus a slimmed list is comparable, not 10×.

**And the page's departure was not only structural.** Because it was a
whole-card form, publishing rode a `<select>` inside `sets.save` — six days after
the constellation composer's own comment argued in writing against exactly that
control, and two days after [plan 41 · §5a] established for `goals` that a
status column has exactly one writer. Neither ruling reached the table created
the same day.

## Decision

**A private, single-user admin surface may require JavaScript. Progressive
enhancement is not, on its own, a reason to keep a page-scoped form.**

`/admin/sets` becomes a list of rows plus a `SetSheet` drawer, matching its
nearest sibling `/admin/constellations` — which is what the `sets` table's own
migration says it was shaped after.

**The three grounds, narrowest first:**

1. **The Observatory is one authenticated person on their own devices**, gated to
   a single account. There is no population of readers here whose browsers might
   differ; there is one, and he installed the app to the Home Screen.
2. **Every other room already requires script to create anything.** The no-JS
   property was true of exactly one surface, so it was not a property of the
   admin — it was an inconsistency that happened to be defensible.
3. ⚠ **The benefit was bought at the price of a page that cannot hold two edits
   at once.** That is the trade this record refuses. A surface whose commit unit
   is the page can lose work by construction, and no amount of
   server-rendered honesty compensates for that.

## Consequences

- **It does not license dropping progressive enhancement on the PUBLIC side**,
  and the distinction is the whole of the scope. A reader's browser is not ours
  to assume. `MusicSets.astro` keeps its `<noscript>` iframe for exactly this
  reason, and nothing in this record touches `src/pages/blog`, `/about`, or a
  constellation page.
- **It settles the question for surfaces that do not exist yet**, which is the
  reason it is an ADR rather than a code comment: a new admin room does not have
  to re-argue whether it may use a sheet.
- **The losing argument is preserved at the site**, in `SetSheet.astro`'s header,
  rather than only here. ⚠ That is deliberate: this file is where the *decision*
  lives, and the file is where somebody about to re-propose the alternative will
  actually be reading.
- **What the change bought, beyond closing the hazard**: the room now keeps the
  house rules it was breaking — `PageHeader` + one primary, `EmptyState` carrying
  the same door, the `.f`/`.f__k` field grammar (it had declared a page-local
  `const FIELD`, a fourth form system of the kind ADR 0033 deleted from
  `about.astro`), `confirmDialog` instead of the last native `confirm()` in the
  admin, drag-or-Alt reorder, and the error line beside the control that failed
  rather than at the top of the page.
- ⚠ **`status` left `sets.save`'s SCHEMA, not just its markup**, and that is the
  half a reviewer would wave through. With the control gone but
  `.default('draft')` still in the schema, Zod's default fires on every save —
  because an action cannot tell "cleared" from "not sent" — so editing a live
  set's description would have **unpublished it**. On `goals` that bug reset a
  private intention; here it would take a page off the public site.
  `src/tests/actions-sets.test.ts` pins it, and was verified to fail with the
  field restored.

## Alternatives

- **Keep the forms and add the Library's dirty-row guard.** The narrowest fix,
  and it closes the data loss. Rejected because it leaves six other house rules
  broken on that page for no gain, and because the guard exists on the Library
  only to survive a genuinely different problem — a hundred records on one page,
  where a per-object save would be worse.
- **Keep the forms and accept the loss.** Stated to be refused: a surface that
  discards typed words without saying so is not a trade, it is a defect.
- **A `<noscript>` fallback form beside the sheet.** Two write paths into one
  table, one of which nobody exercises and therefore nobody notices breaking.
  ADR 0034's distinction applies in reverse: two *doors* are fine, two *write
  paths* are the thing to refuse.
- **Make every admin room no-JS.** The honest inverse, and it would cost the
  writing sheet's autosave, the composer's in-place refresh, the cart, every
  picker, and TipTap. Nobody proposed it; recorded so the asymmetry reads as a
  decision.

[plan 41 · §5a]: ../plans/README.md
