# 0032 — A sheet is dismissible, and says what that costs

Status: **Accepted** *(2026-08-11, with the pass that makes it true across all
eleven surfaces and the test that keeps it true.)*
Date: 2026-08-11

## Context

Michael, 2026-08-11, opening a consistency question with a specific symptom:

> "The song sheet doesn't close if I click on the outside of the sheet, whereas
> the other two do. […] I very well understand that the UI/UX and the intention
> of each one of those between writing, song and quote is all quite different,
> but I still think we can take some steps to make it more consistent."

An audit of every admin `<dialog>` found the symptom was one instance of a
larger shape. **Three separate gestures mean *I want out*** — the ✕, Escape, and
a press on the backdrop — and each was wired by hand, per sheet, by whoever
wrote it:

| | ✕ | Escape | Backdrop | Unsaved-work guard |
|---|---|---|---|---|
| FragmentSheet (quote) | ✅ | ✅ | ✅ | ✅ |
| WritingSheet | ✅ | ✅ | ✅ | ✅ |
| FragmentBrowser | ✅ | ✅ | ✅ | n/a |
| LogSheet | ✅ | native | ✅ | n/a |
| **SongSheet** | ✅ | native | ❌ | ❌ |
| Task, Goal, Person, Event, Link, Tag | ✅ | native | ❌ | ❌ |

**The split is not a decision anyone took.** It is the order the files were
written in. Plan 25 ran a pass over the corpus editors and four dialogs in
August and added `backdrop-close.ts`; the six HQ sheets predate it and were
never revisited, and the song sheet — written a week later — inherited the HQ
shape by copying the nearest neighbour. Nobody ever argued that a task sheet
should ignore an outside click.

**And the two columns are one decision, not two.** Backdrop dismissal without a
guard means one stray click silently destroys everything typed into the sheet —
so the row that lacks the guard is exactly the row where adding the dismissal
would do harm. That coupling is why the drift persisted: each half looked
individually unsafe to fix.

**What "no dismissal" actually costs, stated once.** A modal that will not close
when you click away does not read as *protected*; it reads as **stuck**. The
reader's next move is Escape (which worked, silently, and took the words with
it) or the browser's Back button — which leaves the room entirely and loses far
more than the sheet ever would have.

## Decision

**Every sheet is dismissible by its backdrop, and every sheet must answer what
dismissing it costs.** There are exactly two legal answers:

1. **Nothing** — the surface applies immediately, or it flushes on the way out.
   Dismiss freely. The capture box is the clearest case: closing it *saves* the
   thought, so guarding would be backwards.
2. **Something** — so it guards, and the guard catches **all three gestures**,
   not whichever one its author remembered.

**There is no third answer.** "Ignore the click and hope" is what this record
retires, and it was the answer seven times.

**One call wires the plumbing; each sheet keeps its policy.**
`wireSheetDismiss(dialog, requestClose, closeSelector?)` routes the ✕, Escape
(intercepted at `cancel`, before the native close can take the words) and the
backdrop into one handler. The handler is the sheet's own, because the policies
genuinely differ — the writing sheet parks unsaved words in a draft version
*before* it even asks the question, and a tag sheet has nothing to park.

**The backdrop half is not a click listener**, and that subtlety stays where it
already lived (`backdrop-close.ts`): a press must both *start* and *end* on the
backdrop, or a text selection that begins inside the sheet and releases outside
it counts as a dismissal — a gesture people make constantly while editing.

**`dirtyTracker` carries the two traps** that make a hand-rolled dirty flag
wrong. Populating a form on open fires `input` like any other write, so the
tracker is reset after every populate — a guard that fires on a sheet nobody
touched trains the reader to click through it, and then it protects nothing.
And a relation that applies immediately (a constellation tick, a person tick) is
**not** unsaved work, so those regions are ignored.

## Consequences

**A test enforces it, because a comment demonstrably did not.**
`src/tests/sheet-dismiss.test.ts` finds every script that calls `showModal()` —
derived, so a tenth sheet joins by existing — and requires each to call
`wireSheetDismiss` or to appear on an exemption list **with the sentence saying
why dismissing it costs nothing**. This is the same shape and the same argument
as [ADR 0027](0027-one-lifecycle-for-every-action-call.md)'s per-file allowlist:
a rule that must be re-remembered at every new site needs a tripwire.

**It caught two surfaces the audit had already passed over** — `FragmentBrowser`
and `LogSheet` answered the gestures but not through the seam, so the property
was true and not checkable. Writing the test found them in the first run.

**The test's blind spot is written into it.** It matches text, so it asks
*whether the question was asked*, not whether the answer is right; a
`requestClose` that forgets to confirm passes. The alternative is an AST rule
deciding what counts as a sufficient guard, and the policies are too different
for that to be anything but a second source of truth. One end-to-end spec
carries the behavioural half, on the sheet that prompted the pass: a clean sheet
must go on an outside press, a dirty one must not.

**Three drifts were reclassified as justified and left alone**, which is the
half of a consistency pass that is easy to skip:

- **Widths** (`max-w-5xl` composer and browser, `max-w-2xl` quote, `max-w-md`
  short forms) track content. Uniform widths here would be consistency for its
  own sake.
- **The writing sheet's primary action says *Publish…*, not *Save*.** It is the
  one type with a draft lifecycle, and the button should say what it does.
- **The song sheet is the only one with a sticky footer.** Every other sheet's
  primary action sits inline at the end of *its form*, because the form is the
  whole sheet. There, one Save commits three tabs, so it belongs to the sheet
  rather than to any panel — at the foot of Feelings it would read as saving the
  words only, and it would vanish the moment you opened Notes.

**One latent bug fell out of the pass.** `fragment-sheet.ts` queried
`document.querySelectorAll('[data-close]')` — an attribute **nine components
render** — so it bound the quote sheet's close handler to every other sheet's ✕
that happened to be mounted on the same page. Harmless only because of which
pages currently mount which sheets, which is a fact about today's composition
and not a property anything enforced. The seam scopes to the dialog.

**Accepted cost — a confirm that can annoy.** A guard the reader meets often is
a guard the reader learns to dismiss without reading. The mitigation is entirely
in `dirtyTracker`'s two traps: on the common path — open a sheet, look, close it
— `dirty` is false and nothing is asked.

## Alternatives

- **Leave the HQ sheets alone and fix only the song sheet.** The narrowest read
  of the complaint, and it was Michael's own instinct to reject: *"let's do the
  full nine sheet pass."* It would have left the same trap for the tenth sheet,
  and the tenth sheet is the one nobody is looking at.
- **Backdrop dismissal everywhere, guards nowhere.** Half the work and worse
  than doing nothing: it converts a mildly annoying non-response into silent
  data loss on six surfaces that previously could not lose anything by accident.
- **Guards everywhere, dismissal nowhere.** Keeps the current behaviour and
  formalises it. Rejected on what "stuck" actually costs — see Context.
- **A `<Sheet>` component owning the shell, the tabs, the footer and the exit.**
  The real fix if these surfaces were converging, and they are not: a tag sheet
  is six checkboxes, the writing sheet is a near-fullscreen composer with
  autosave and a version history. Forcing one component over that range produces
  a component with a prop for every difference, which is the same drift wearing
  a type signature. **The seam is the exit, and only the exit** — which is the
  part every one of them genuinely shares.
- **An ESLint rule instead of a test.** It would catch the omission at the right
  moment. It cannot carry the exemption list's *reasons*, and the reasons are
  the part that makes the list honest rather than a snooze button.
