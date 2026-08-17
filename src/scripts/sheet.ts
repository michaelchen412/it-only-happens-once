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
//   · `fragment-sheet.ts` — ⚠ ITS `<form>` IS ONE PANEL, NOT THE SHEET. The
//     quote form is a tabpanel beside a Constellations tab whose ticks write
//     IMMEDIATELY (docs/admin.md §4a), so `wireSheet`'s dialog↔form 1:1
//     assumption does not hold and its tracker would have to learn to ignore a
//     region. That is the escape hatch this module refuses to grow.
//   · `log-sheet.ts` — has an error line and an explicit save, and NOTHING TO
//     LOSE: it opens prefilled from a dump that stays in the pile, so closing it
//     costs the prefill and nothing else. It answers ADR 0032 with the first
//     legal answer ("dismissing costs nothing") and so has no guard to share.
//
// ⚠ THIS LIST USED TO SAY `fragment-sheet.ts` AND `log-sheet.ts` "carry neither
// a dirty tracker nor an error line", AND BOTH HALVES WERE FALSE (plan 42 ·
// §4.C.11). The quote sheet has a hand-rolled dirty flag driving a full discard
// guard (`fragment-sheet.ts:326,381`) and renders `<SheetError id="sheet-error">`;
// `LogSheet.astro:96` carries an error line too. By the test written directly
// below, the quote sheet passed all three and was exempted anyway. A wrong
// exemption reason is worse than none — it invites the next reader to "fix" a
// sheet into this shell on a premise that does not hold, and the correction is
// the same defect this plan names elsewhere: the code and its comment disagreed.
//
// A `wireSheet` with six escape hatches to swallow those would be worse than the
// duplication it removed. The test of whether a sheet belongs here is whether it
// has all of: something to lose, an error line, and an explicit save.
//
// ─────────────────────────────────────────────────────────────────────────────
// ⚠ TWO CONVENTIONS THIS MODULE DOES NOT ENFORCE AND THE BUILDING KEEPS ANYWAY.
// Both were unwritten until plan 42 went looking, and both read as drift until
// the boundary is stated — which is the whole reason they are here rather than
// in a plan nobody checks out.
//
//   1. WHERE DELETE SITS. The rule is `WritingSheet.astro`'s: apart from the
//      benign controls, at the END of the thing it destroys, below a rule, with
//      a line saying what it takes and what it leaves. The quote sheet, the song
//      sheet and the composer all follow it.
//      ⚠ THE FOOTER VARIANT IS LEGAL WHEN THE FORM DOES NOT SCROLL — a short
//      record has no "end of the object" distinct from its footer, so the zone
//      buys ceremony and no separation, and under `GoalSheet`'s four fields it
//      would be a visible fraction of the sheet. Task, goal and event take that
//      variant deliberately. ⚠ The price is that a footer Delete must say
//      IRREVERSIBILITY in its confirm, because nothing on screen says it first —
//      all three of these are hard `.delete()` calls with no trash tier
//      (`tasks.remove`, `events.remove` argue why), which makes them the least
//      ceremonious deletes in the building and the only unrecoverable ones.
//
//   2. WHETHER THERE IS A CANCEL. Every sheet here carries one beside its Save;
//      the three corpus sheets carry only the ✕. That split is deliberate, and
//      it is NOT the one ADR 0032 settled — that record's table has exactly
//      these columns minus this one. A corpus sheet is wide and its primary is
//      full-width (`flex-1`), so a Cancel beside `Save quote` would read as a
//      second primary; an HQ sheet is a short form where *abandon* is a real
//      intention deserving a real button. ⚠ Do not add a Cancel to the corpus
//      sheets to make the two halves match.
// ─────────────────────────────────────────────────────────────────────────────
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
