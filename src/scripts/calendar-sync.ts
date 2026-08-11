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
 *
 * ⚠ A SUCCESS, THOUGH, HAS TO SAY SOMETHING — AND CANNOT SAY IT BY RELOADING.
 * Render precedes sync by design, so the staleness line is drawn from a
 * `synced_at` this run is about to replace: open Today after a day away and it
 * warns about a mirror that goes current a second later, then keeps warning
 * for the whole page view. Reloading to clear it is out (see above), and
 * `changed === 0` is the ORDINARY answer for a calendar with one event a
 * month, so waiting for a change would leave the line up almost every time.
 * It is removed in place instead — exactly when the fact it reports stops
 * being true. ADR-0014's demand is untouched: a mirror that is genuinely
 * stale, or genuinely broken, never reaches this branch.
 *
 * ⚠ `skipped` MUST NOT CLEAR IT, and that is the whole reason this is not
 * simply `if (!error)`. A sync that failed nine minutes ago still holds the
 * claim, so the next visit is throttled out with no error of its own — and the
 * line it would erase is the true one saying Google couldn't be reached.
 */
const run = async () => {
  try {
    const { data, error } = await actions.calendar.sync({});
    if (error || !data) return;

    // Not configured answers `skipped` too, so it is covered here: a mirror
    // nobody set up has nothing to be fresh about.
    if (!data.skipped && !data.error) {
      // Today and the Agenda room mark the line identically, so one selector
      // serves both and neither page needs to know this script exists.
      document.querySelectorAll('[data-stale]').forEach((el) => el.remove());
    }

    if (data.changed === 0) return;

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
