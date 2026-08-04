// Keeping the Google mirror fresh, with no scheduler (13 · Piece 3).
//
// ⚠ THE PAGE THAT NEEDS THE DATA IS WHAT FETCHES IT. There is no cron in this
// repo — the nightly backup the plan named as the precedent lives in another
// one — and the live calendar gets about one real event a month, so a push
// channel renewed weekly would be machinery guarding almost nothing. Instead
// Today and the Agenda room ask, after paint, and the action ignores them if
// the mirror is younger than ten minutes.
//
// THE ORDER MATTERS: render first, sync second. The page is drawn from the
// mirror immediately and is never blocked on Google — so a slow or dead
// network costs nothing but freshness, which is the failure mode ADR-0014
// accepts in exchange for having no reconciliation to do.
import { actions } from 'astro:actions';

/**
 * ⚠ A FAILURE NEVER RELOADS, AND THAT IS WHAT MAKES THIS LOOP-PROOF.
 *
 * Reload-on-change is safe because a reload re-runs this and the server-side
 * throttle then answers `skipped`. Reload-on-error would not be: the error
 * would recur, and so would the reload. So a failed sync says nothing here —
 * it is recorded on `calendar_sync`, and the staleness line speaks on the next
 * render, which is one navigation away at most.
 */
const run = async () => {
  try {
    const { data, error } = await actions.calendar.sync({});
    if (error || !data || data.changed === 0) return;

    // Never yank the page out from under an open editor. The sheet holds
    // unsaved input, and a mirrored row appearing is not worth losing it — the
    // next navigation will pick the change up anyway.
    if (document.querySelector('dialog[open]')) return;
    location.reload();
  } catch {
    // `astro:actions` throws on a dead network rather than returning `{ error }`.
    // There is nothing to say about it here: the page already rendered.
  }
};

// `requestIdleCallback` where it exists — this is the least urgent thing on the
// page, and on a phone at 7am it must not compete with the check-in's first
// paint. Safari has no such thing, hence the timeout.
if ('requestIdleCallback' in window) {
  (window as Window & { requestIdleCallback: (cb: () => void) => void }).requestIdleCallback(run);
} else {
  setTimeout(run, 400);
}
