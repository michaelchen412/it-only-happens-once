// One exit for a sheet, and one place that decides what an exit COSTS.
//
// ⚠ THE RULE THIS ENCODES (ADR 0032): every sheet is dismissible by its
// backdrop, and every sheet must answer what dismissing it costs. There are
// exactly two legal answers — *nothing* (it applies immediately, or it flushes
// on the way out) and *something* (so it guards). The third answer, which this
// codebase held seven times before the pass that added this file, is to ignore
// the click and hope: a modal that will not close when you click away reads as
// stuck, and the reader's next move is the browser Back button, which loses far
// more than the sheet would have.
//
// WHY A FUNCTION RATHER THAN A CONVENTION. Three separate gestures mean "I want
// out" — the ✕, Escape, and a press on the backdrop — and before this they were
// wired one at a time, per sheet, by whoever wrote it. That is why the two
// corpus editors had all three and the six HQ sheets had one: not a decision,
// just the order the files were written in. Routing them through a single call
// makes "did this sheet think about its exit?" a question you can answer by
// grepping for one name.
import { onBackdropDismiss } from './backdrop-close';
import { confirmDialog } from './confirm-dialog';

/**
 * Wire every way out of a sheet to one handler.
 *
 * The handler owns the POLICY — whether to confirm, what to flush, what to
 * refresh behind it. This owns only the plumbing, because the policies
 * genuinely differ: the writing sheet parks unsaved words in a draft version
 * before it even asks, and a tag sheet has nothing to park.
 *
 * @param dialog the sheet
 * @param requestClose what "the reader wants out" means here. It must close the
 *                     dialog itself on the paths where it agrees to — this
 *                     never calls `close()` for you, because a handler that
 *                     refuses (unsaved edits, kept open) has to be able to.
 * @param closeSelector the ✕ and any other in-sheet exit. Defaults to the
 *                     `[data-close]` most of these already use.
 */
export function wireSheetDismiss(
  dialog: HTMLDialogElement,
  requestClose: () => void,
  closeSelector = '[data-close]',
): void {
  dialog.querySelectorAll(closeSelector).forEach((el) => el.addEventListener('click', () => requestClose()));

  // ⚠ Escape has to be INTERCEPTED, not observed. `cancel` fires before the
  // native close, and without `preventDefault` the dialog is gone before a
  // guard can ask anything — so the confirm would open behind a sheet that had
  // already taken the words with it.
  dialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    requestClose();
  });

  // The subtle one — see `backdrop-close.ts` for why this is not a click
  // listener. A text selection that starts inside the sheet and releases
  // outside it must not count as a dismissal.
  onBackdropDismiss(dialog, requestClose);
}

/**
 * The standard "you'll lose this" confirm, so nine sheets don't each invent
 * their own wording for the same moment.
 *
 * ⚠ IT NAMES WHAT IS LOST, NOT WHAT IS CLICKED. "Are you sure?" makes the
 * reader reconstruct the stakes; "This has unsaved edits" states them. `danger`
 * because discarding is the destructive branch, and the destructive branch is
 * never the quiet one.
 *
 * @param what the thing with unsaved edits, in the sheet's own noun — "This
 *             task", "This song". Falls back to something true of all of them.
 */
export function confirmDiscard(what = 'This'): Promise<boolean> {
  return confirmDialog({
    title: 'Discard changes?',
    message: `${what} has unsaved edits. Close without saving?`,
    confirmLabel: 'Discard',
    danger: true,
  });
}

/**
 * The dirty flag most of these sheets need, and the two traps in it.
 *
 * ⚠ TRAP ONE: POPULATING A FORM IS NOT AN EDIT. Every sheet fills its fields on
 * open, and those writes fire `input`/`change` like any other. `reset()` is
 * what each sheet calls once it has finished populating, and forgetting it
 * means the guard fires on a sheet nobody has touched — which trains the reader
 * to click through the confirm, and then it protects nothing.
 *
 * ⚠ TRAP TWO: AN IMMEDIATE RELATION IS NOT AN UNSAVED EDIT. Ticking a
 * constellation or a person writes straight to the database, so a guard that
 * counted it would warn about edits that are already saved. `ignore` is the
 * selector for those regions.
 */
export function dirtyTracker(dialog: HTMLDialogElement, ignore?: string) {
  let dirty = false;
  const mark = (e: Event) => {
    if (ignore && (e.target as Element)?.closest?.(ignore)) return;
    dirty = true;
  };
  dialog.addEventListener('input', mark);
  dialog.addEventListener('change', mark);
  return {
    get: () => dirty,
    /** Call after populating on open, and after a save lands. */
    reset: () => (dirty = false),
    /** Call from a rich editor's own `update`, which fires no DOM event. */
    touch: () => (dirty = true),
  };
}
