import { lockScroll, unlockScroll } from './scroll-lock';

// `afterDialogClose(dialog)` — resolve once a closing <dialog> has finished
// animating out.
//
// WHY THIS IS NEEDED AT ALL. app.css gives every dialog a real exit: the drawer
// slides out over 0.28s, the modal fades and scales over 0.2s, both using
// `transition-behavior: allow-discrete` on `display` and `overlay` so the EXIT
// animates rather than snapping. That work was done and it is correct. What
// broke it was what ran next to it — a `location.reload()` in the same tick,
// which tore the page down a frame or two into the slide. The animation was
// never wrong; it just never got to run.
//
// Removing the navigation fixes that. But the thing that replaces it — refetch
// the page, parse it, swap `innerHTML` into the suite — is a page-sized piece
// of main-thread work, and landing it mid-slide janks the animation we just
// got back. So the pattern is: START the fetch immediately (the network is off
// the main thread and there is no reason to wait), and DEFER the swap until
// the exit has finished.
//
// ── The timeout is not optional ──────────────────────────────────────────
// This gates real work on an animation finishing, so anything that can stop the
// event arriving becomes a suite that silently never refreshes: a dialog
// removed from the DOM mid-transition, a `display: none` from somewhere else, a
// browser that doesn't fire `transitionend` for a discrete property. A race
// against a timeout turns every one of those from "stale forever" into "a
// slightly early swap", which nobody can see.
//
// Note `prefers-reduced-motion` does NOT need a special case: app.css zeroes
// the durations (`0.01ms !important`) rather than removing the transitions, so
// `transitionend` still fires — immediately. That is deliberate, and it is why
// this helper works unchanged for both preferences.
//
// ⚠⚠ AND THE `overlay` HALF OF THAT EXIT ONLY EVER WORKED IN CHROMIUM. See
// `closeWithExit` below, which is what a dialog should use.
//
// ── 2026-08-15: THIS MODULE IS NOW THE ONLY WAY A DIALOG OPENS OR SHUTS ──────
// `closeWithExit` was written 2026-08-11 for the public Reader and then used by
// that one dialog, while the workshop's twenty kept calling `close()` directly —
// a state admin.css named in a comment ("the same one-line cure available") and
// left standing. Michael, 2026-08-15: *"the popovers, sheets, and dialogues on
// iOS and Chrome never close gracefully, no matter where we are."* That is not
// device jank; it is this gap, on every sheet in the building.
//
// So the pair below is the seam, and both halves are needed — `openDialog`
// exists because `closeWithExit` leaves a dialog OPEN while it animates, which
// means every reopen has to be able to say "stand down" (see `onCancelled`).
// Wiring that by hand at twenty-nine `showModal()` sites is twenty-nine chances
// to forget, and forgetting is silent: the sheet reopens and then shuts itself
// 300ms later. One function, one rule, greppable.

/** Longer than the slowest exit (0.28s) with room for a slow frame. */
const FALLBACK_MS = 350;

export function afterDialogClose(dialog: HTMLElement): Promise<void> {
  return new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      dialog.removeEventListener('transitionend', onEnd);
      window.clearTimeout(timer);
      resolve();
    };
    // `transitionend` fires once PER PROPERTY — the drawer transitions
    // translate, overlay and display — so take the first and stop listening.
    // The target check matters too: the event bubbles, and a hover transition
    // on some button inside the dialog would otherwise resolve this early.
    //
    // ⚠ AND `pseudoElement` MATTERS FOR THE SAME REASON, WHICH IS NOT OBVIOUS:
    // a `::backdrop` transition dispatches its `transitionend` ON THE DIALOG,
    // so `e.target === dialog` is true for the backdrop's fade as well as for
    // the sheet's own slide. The backdrop runs 0.25s and the drawer 0.28s, so
    // the backdrop always won that race — and once this helper drives the
    // close, winning it meant shutting the dialog 30ms early and CANCELLING the
    // slide at ~90% of the way out. Caught by a spec that waited for the
    // `translate` transition to end and never saw one: `transitioncancel` fired
    // instead. Empty string is the element itself.
    const onEnd = (e: TransitionEvent) => {
      if (e.target === dialog && !e.pseudoElement) finish();
    };
    dialog.addEventListener('transitionend', onEnd);
    const timer = window.setTimeout(finish, FALLBACK_MS);
  });
}

/**
 * `closeWithExit(dialog)` — close a <dialog> so that its exit animation ACTUALLY
 * RUNS, in every engine rather than only in Chromium.
 *
 * ⚠⚠ THE PATTERN EVERY TUTORIAL TEACHES IS CHROMIUM-ONLY, AND IT FAILS SILENTLY
 * EVERYWHERE ELSE. Calling `dialog.close()` and letting CSS animate the exit
 * depends on the **`overlay`** property to defer the element's removal from the
 * top layer until the transition ends. Support, checked 2026-08-11:
 *
 *     Chrome / Edge  ✅ 117+
 *     Safari         ❌ not supported (desktop through 27, iOS through 26.5)
 *     Firefox        ❌ not supported (through 156)
 *
 * Every browser on iOS is WebKit — iOS Chrome is Safari's engine wearing a
 * different icon — so on a phone, `close()` drops the dialog out of the top
 * layer in the same frame and the 0.28s slide is never rendered at all. MDN
 * says it plainly: the element "is removed from the top layer immediately upon
 * closing… making the dialog appear to just disappear instantly."
 *
 * Michael, 2026-08-11, on an iPhone: *"the sheet is just fine opening and
 * closing smoothly on desktop, but when i try on iphone in chrome it has the
 * old problem of just instantaneously closing."* Opening was always fine —
 * `@starting-style` and `transition-behavior: allow-discrete` ARE Baseline
 * (Safari 17.4+, Firefox 129+). It is only the exit that needed `overlay`.
 *
 * So this stops needing it. Rather than closing and asking the browser to keep
 * a closed dialog on screen, the dialog **stays genuinely open** for the length
 * of its animation — `[data-closing]` drives the exit in CSS while `[open]` is
 * still there — and `close()` happens only once it has finished. Nothing about
 * that is engine-specific: it is an ordinary transition on an ordinary visible
 * element.
 *
 * The returned promise resolves after the dialog is really shut. `onCancelled`
 * lets a caller notice that the dialog was REOPENED mid-exit, in which case
 * this never closes it — the reopen wins and the caller's own teardown (a
 * scroll lock, say) must not run.
 */
export async function closeWithExit(dialog: HTMLDialogElement, opts: { onCancelled?: () => void } = {}): Promise<void> {
  if (!dialog.open) return;
  // Already leaving: don't restart the animation or stack a second close.
  if (dialog.dataset.closing) return;

  dialog.dataset.closing = '1';
  await afterDialogClose(dialog);
  // `openDialog` clears the flag when something reopens the sheet mid-slide. It
  // is the one signal that this close has been overtaken, so honour it.
  if (!dialog.dataset.closing) {
    opts.onCancelled?.();
    return;
  }
  delete dialog.dataset.closing;
  dialog.close();
}

/**
 * `openDialog(dialog)` — the other half of `closeWithExit`, and the only way a
 * modal should be opened in this codebase.
 *
 * It does two things `showModal()` alone cannot:
 *
 * ⚠ IT CANCELS AN EXIT IN FLIGHT. Because a leaving dialog stays genuinely
 * `open` for the length of its animation, reopening one 100ms after dismissing
 * it — tapping a second row straight after closing the first, which is an
 * ordinary thing to do in a list — finds a dialog that is already `open` and
 * already sliding away. Clearing `[data-closing]` puts it back into its resting
 * state, and the pending `closeWithExit` sees the cleared flag and stands down
 * instead of shutting a sheet you just asked for.
 *
 * ⚠ IT IS IDEMPOTENT. `showModal()` throws `InvalidStateError` on a dialog that
 * is already open, so the guard is not politeness — without it, the reopen path
 * above is an exception rather than a sheet.
 *
 * ⚠ IT ALSO DECIDES WHERE FOCUS LANDS, AND THAT IS NOT A SIDE ERRAND. Left to
 * itself, `showModal()` focuses the first focusable descendant — which in every
 * sheet in this building is `SheetHeader`'s ✕, because the header is the first
 * thing in the markup. So opening a document to read it announced "Close" and
 * ringed it. Michael, 2026-08-15: *"if I open up a sheet, I will see this ugly
 * blue outline on the X button to close the sheet… Why is that UI element
 * highlighted?"* Measured on the writing sheet, after any keyboard use:
 * `activeElement` = `button[aria-label="Close"]`, `:focus-visible` = true,
 * `outline: rgb(16,16,16) auto 1px` — the browser's own ring, on the one
 * control in the sheet that does nothing but leave it.
 *
 * The fix is not to hide the ring; it is to stop pointing it at the exit. Focus
 * goes to the DIALOG, which is what the WAI-ARIA authoring practices prescribe
 * when the first focusable thing is not the thing you came for — a screen
 * reader then announces the sheet's own name and role rather than "Close,
 * button", and there is nothing ringed because a modal filling the screen needs
 * no ring to say where you are (see admin.css).
 *
 * `tabindex` is set here rather than in twenty markup files because it is a
 * consequence of this function's choice, not a property of any one sheet: a
 * `<dialog>` is not focusable on its own.
 *
 * ⚠ AND `[autofocus]` STILL WINS. `showModal()` honours it, and a sheet that
 * genuinely opens INTO a field should say so declaratively; stealing focus back
 * to the container would break exactly the sheets that had thought about this.
 * The imperative `.focus()` calls that several sheets make on the line after
 * this one win for the same reason — they run later.
 *
 * There is no `returnValue` parameter on the close side for the same reason
 * there is no `show()` (non-modal) here: every dialog in this building is
 * modal, and the two that carry a `returnValue` (`confirm-dialog`,
 * `alt-dialog`) set it on the element before closing, which `close()` with no
 * argument preserves.
 */
export function openDialog(dialog: HTMLDialogElement): void {
  delete dialog.dataset.closing;
  lockScroll(dialog);
  if (dialog.open) return;
  if (!dialog.hasAttribute('tabindex')) dialog.tabIndex = -1;
  dialog.showModal();
  if (!dialog.querySelector('[autofocus]')) dialog.focus();
}

/* ── The scroll lock, wired once for every dialog in the building ────────────
   (2026-08-17.) `showModal()` was doing this job on desktop and only appearing
   to: the spec does not require a modal dialog to freeze the document, and iOS
   Safari does not, so on a phone the page behind the capture box scrolled under
   your thumb. Reader.astro had solved it properly a week earlier and was the
   only surface that had.

   ⚠ RELEASED ON `close`, NOT IN `closeWithExit`, and Reader.astro is where that
   reasoning was first written down: `close` is the one event meaning "this is
   now shut" no matter WHO shut it, and there is at least one route we do not
   control — Chromium's close watcher fires `cancel` only while the press still
   carries user activation, so a second Escape during a slide-out closes the
   dialog directly, past every handler a sheet installed. Anything keyed on our
   own exit path leaks the lock there, and a leaked lock is a page that will not
   scroll with nothing on screen to explain it.

   Capture phase because `close` does not bubble — a capturing listener still
   sees it on the way down. One listener at the document, rather than one per
   dialog, so a sheet added later inherits this by existing.

   The pairing is deliberately lopsided: locking is explicit (`openDialog`),
   unlocking is automatic. A dialog cannot forget to release something it never
   asked for. */
if (typeof document !== 'undefined') {
  document.addEventListener(
    'close',
    (e) => {
      const t = e.target;
      if (t instanceof HTMLDialogElement) unlockScroll(t);
    },
    true,
  );
  // `<html>` persists across a view transition, so a lock held by a dialog that
  // is about to be swapped away would follow the reader to the next page.
  document.addEventListener('astro:before-swap', () => unlockScroll());
}
