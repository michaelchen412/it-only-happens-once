// One sheet's lifecycle, in one place (plan 41 · §4).
//
// ⚠ FOUR PASSES HAD ALREADY EXTRACTED THE MECHANISMS AND NOBODY HAD EXTRACTED
// THE SHEET. `action-error.ts` owns the submit lifecycle, `sheet-dismiss.ts` the
// three ways out, `dialog-close.ts` opening and closing across engines,
// `sheet-error.ts` finding the error line. Each solved one problem well. What
// none of them could see is that seven files then assembled those four pieces in
// the same order, with the same names, around the same three ⚠ comments — so
// "the sheet" was a shape that existed in seven copies and had no home.
//
// The copies were not drifting yet. They were drifting-shaped: nine `async
// function requestClose()` bodies, byte-similar down to the five-line note
// explaining a TypeScript narrowing quirk that only exists because each one was
// written inside an `if (sheet && form)` block. That note is gone from all of
// them now, because a parameter narrows and a closed-over `const` does not.
//
// ⚠ WHAT THIS DOES NOT TRY TO OWN, which is what keeps it honest. Three sheets
// do not use it and must not be forced to:
//
//   · `writing-sheet.ts` (1,014 lines) AUTOSAVES, so it has no dirty tracker and
//     no submit button — its exit parks unsaved words in a draft version before
//     it asks anything. Nothing below fits it.
//   · `fragment-sheet.ts` and `log-sheet.ts` carry neither a dirty tracker nor
//     an error line; they are dialogs rather than forms with something to lose.
//
// A `wireSheet` with six escape hatches to swallow those would be worse than the
// duplication it removed. The test of whether a sheet belongs here is whether it
// has all of: something to lose, an error line, and an explicit save.
import { closeWithExit, openDialog } from './dialog-close';
import { confirmDiscard, dirtyTracker, wireSheetDismiss } from './sheet-dismiss';
import { sheetError } from './sheet-error';

export interface Sheet {
  /**
   * The dirty flag, exposed because two sheets legitimately drive it by hand: a
   * rich editor's `update` fires no DOM event (`touch`), and a relation that
   * writes straight to the database is not an unsaved edit (`reset`).
   */
  dirty: ReturnType<typeof dirtyTracker>;
  /** A sentence in the sheet's error line, or `null` to clear it. */
  showError(message: string | null): void;
  /**
   * Clear the error, forget any edits, show the dialog.
   *
   * ⚠ POPULATE FIRST, THEN CALL THIS. Filling a form fires `input`/`change` like
   * any other write, so a sheet that opens and then fills would arrive already
   * dirty and confirm on the way out of a sheet nobody touched —
   * `sheet-dismiss.ts` calls that Trap One. Resetting here rather than leaving
   * it to each caller is what makes the trap unavailable rather than merely
   * documented.
   */
  open(): void;
  /**
   * The reader wants out — the same path the ✕, Escape and the backdrop take.
   * Confirms if there is anything to lose, and does nothing if they decline.
   */
  requestClose(): Promise<void>;
  /**
   * Leave without asking, for after a save, when there is nothing left to lose.
   * ⚠ It resets the tracker first, or the guard would fire on the way out over
   * edits that have just been written.
   */
  close(): Promise<void>;
}

export interface SheetOptions {
  /**
   * The sheet's own noun for what would be lost — "This task", "This song".
   * Reaches `confirmDiscard`, which names the thing rather than asking "are you
   * sure?", because a reader should not have to reconstruct the stakes.
   */
  noun?: string;
  /**
   * A region whose edits are already saved, so the guard ignores them — ticking
   * a constellation or a person writes straight to the database.
   * `sheet-dismiss.ts` calls this Trap Two.
   */
  ignore?: string;
  /** Teardown for the native `close`, which Escape and the backdrop also reach. */
  onClose?: () => void;
}

export function wireSheet(dialog: HTMLDialogElement, opts: SheetOptions = {}): Sheet {
  const dirty = dirtyTracker(dialog, opts.ignore);
  // BY ROLE, NOT BY THE NAME SOMEBODY GAVE IT — `sheet-error.ts` carries the
  // full account, and the twenty invented ids that produced it.
  const errorEl = sheetError(dialog);

  const showError = (message: string | null) => {
    if (!errorEl) return;
    errorEl.textContent = message ?? '';
    errorEl.hidden = !message;
  };

  const close = async () => {
    dirty.reset();
    await closeWithExit(dialog);
  };

  const requestClose = async () => {
    if (dirty.get() && !(await confirmDiscard(opts.noun))) return;
    await close();
  };

  wireSheetDismiss(dialog, () => void requestClose());
  if (opts.onClose) dialog.addEventListener('close', opts.onClose);

  return {
    dirty,
    showError,
    open() {
      showError(null);
      dirty.reset();
      openDialog(dialog);
    },
    requestClose,
    close,
  };
}
