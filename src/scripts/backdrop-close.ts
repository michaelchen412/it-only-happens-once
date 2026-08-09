// Dismiss a `<dialog>` by its backdrop — but only on a press that both STARTED
// and ENDED there.
//
// ⚠ THE NAIVE VERSION LOSES WORK, WHICH IS WHY THIS IS A FUNCTION. A `<dialog>`
// has no separate backdrop element to listen on: `::backdrop` is a pseudo, so
// the only signal is "the click landed on the dialog box itself rather than on
// anything inside it". Wiring that to `click` alone means a **text selection
// that begins inside the sheet and releases outside it closes the sheet** —
// which is a gesture people make constantly while editing (drag right-to-left
// across a paragraph and overshoot), and it took whatever was unsaved with it.
//
// `click` fires on the common ancestor of the pointerdown and pointerup
// targets, so a drag from a `<textarea>` out to the backdrop reports the dialog
// as its target and is indistinguishable from a deliberate dismiss — unless you
// remember where the press began. That is the whole trick, and it is four lines
// nobody reconstructs from first principles at the moment they need it.
//
// Three sheets had it and four dialogs did not (docs/plans/25 · §3): the ✚
// capture box, the log sheet, the publish dialog and the notes filer. The
// capture box is the worst of the four — closing it flushes, so a stray
// selection there ended a thought early.

/**
 * @param dialog the `<dialog>` whose backdrop should dismiss it
 * @param close  what dismissal means here — rarely just `dialog.close()`, since
 *               most of these surfaces flush, guard against unsaved edits, or
 *               refresh something on the way out
 */
export function onBackdropDismiss(dialog: HTMLDialogElement, close: () => void): void {
  let pressedOnBackdrop = false;
  dialog.addEventListener('pointerdown', (e) => (pressedOnBackdrop = e.target === dialog));
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog && pressedOnBackdrop) close();
  });
}
