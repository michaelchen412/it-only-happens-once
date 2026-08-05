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
    const onEnd = (e: TransitionEvent) => {
      if (e.target === dialog) finish();
    };
    dialog.addEventListener('transitionend', onEnd);
    const timer = window.setTimeout(finish, FALLBACK_MS);
  });
}
