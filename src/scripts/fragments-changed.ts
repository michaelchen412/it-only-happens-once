// `fragments:changed` — "a fragment was created, edited, trashed, placed or
// unplaced; whatever you are showing of the corpus is now stale."
//
// WHY AN EVENT AND NOT A DIRECT CALL. The thing that knows a fragment changed
// is an editor sheet, and the sheets are shared: the same FragmentSheet and
// WritingSheet are mounted by /admin/fragments, by the constellation composer,
// and inside the composer's own browser drawer. A sheet cannot import "the
// host's refresh function" because there isn't one function — there are three
// hosts with three different ideas of what needs redrawing, and two of them can
// be on screen at once (the drawer sits over the composer, and BOTH should
// refresh: the drawer's rows AND the suite behind it).
//
// ── The cancelable half, which is the load-bearing half ──────────────────
// The event is CANCELABLE, and a host that can refresh in place claims it with
// `preventDefault()`. If nobody claims it, the caller falls back to
// `location.reload()` — exactly what it did before this file existed.
//
// That fallback is not defensive clutter; it is what makes this change safe to
// make. These sheets are mounted on pages nobody is thinking about right now,
// and on any page that hasn't been taught to listen, the old behaviour is still
// correct behaviour — a reload is ugly, not wrong. Without it, adding a sheet
// to a fourth page would silently produce a room that never updates, and the
// symptom (stale data, no error) is the kind you don't notice for a week.

import { afterDialogClose } from './dialog-close';

export interface FragmentsChanged {
  /**
   * Resolves once the dialog that announced this has finished animating shut
   * (or immediately, if none did).
   *
   * ⚠ Listeners must gate their DOM SWAP on this, not their fetch. The close
   * animation and a page-sized `innerHTML` swap both want the main thread, and
   * the swap wins — which janks the exit we just went to the trouble of
   * recovering. Network is off the main thread, so start that immediately and
   * hold only the paint.
   */
  settled: Promise<void>;
}

/**
 * Announce that the corpus changed, and return how it was handled.
 * Falls back to a full reload when no host claims the event.
 *
 * Pass the dialog you have JUST closed, if any. The caller is the only one who
 * knows — the hosts listening have no idea which sheet was on top of them — and
 * it's what lets every listener wait for the exit without knowing about dialogs.
 */
export function notifyFragmentsChanged(closing?: HTMLElement | null): 'claimed' | 'reloaded' {
  const detail: FragmentsChanged = {
    settled: closing ? afterDialogClose(closing) : Promise.resolve(),
  };
  const claimed = !document.dispatchEvent(
    new CustomEvent<FragmentsChanged>('fragments:changed', { cancelable: true, detail }),
  );
  if (claimed) return 'claimed';
  location.reload();
  return 'reloaded';
}

/**
 * Handle `fragments:changed` by refreshing in place. **Return true if you
 * actually did** — that is what claims the event.
 *
 * The return value is not ceremony. A host that can only sometimes act (the
 * browser drawer, which is worth refreshing when open and pointless when
 * closed) must not claim the event on the occasions it does nothing, or it
 * would suppress the reload fallback on behalf of a host that would have
 * handled it properly. Claiming means "this is handled", not "I was listening".
 *
 * Every listener still runs — two hosts both claiming is normal and correct.
 * The browser drawer and the composer underneath it are both looking at data
 * the same save invalidated, and both should redraw.
 */
export function onFragmentsChanged(fn: (e: FragmentsChanged) => boolean): void {
  document.addEventListener('fragments:changed', (e) => {
    if (fn((e as CustomEvent<FragmentsChanged>).detail)) e.preventDefault();
  });
}
