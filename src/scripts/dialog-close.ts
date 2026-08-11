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
  // `show()` clears the flag when something reopens the sheet mid-slide. It is
  // the one signal that this close has been overtaken, so honour it.
  if (!dialog.dataset.closing) {
    opts.onCancelled?.();
    return;
  }
  delete dialog.dataset.closing;
  dialog.close();
}
