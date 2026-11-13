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
  /**
   * True when the editor that announced this is STILL OPEN — a save landed
   * mid-edit, and the rows behind the sheet can catch up while you work.
   * `settled` is already resolved on these: there is no exit to wait for.
   *
   * Only a host that registered with `{ live: true }` ever sees one; see
   * `onFragmentsChanged` for what happens to everyone else.
   */
  live: boolean;
  /** @internal — set by a host that let a live announcement go by, so the
   *  sheet still owes it the close-time one. */
  heldForClose?: boolean;
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
    live: false,
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
export function onFragmentsChanged(fn: (e: FragmentsChanged) => boolean, opts: { live?: boolean } = {}): void {
  document.addEventListener('fragments:changed', (e) => {
    const detail = (e as CustomEvent<FragmentsChanged>).detail;
    // A host that cannot redraw behind an open sheet (the composer swaps a
    // whole suite, which is not something to do under somebody's cursor) is
    // never handed a live announcement. It says "not yet" instead, which keeps
    // the sheet's debt open — so this host still hears about the change on
    // close, exactly as it did before live announcements existed.
    if (detail.live && !opts.live) {
      detail.heldForClose = true;
      return;
    }
    if (fn(detail)) e.preventDefault();
  });
}

/*
  ── WHILE THE SHEET IS STILL OPEN ─────────────────────────────────────────
  (2026-11-13.) Every sheet used to announce its changes on the way OUT, so the
  list behind an essay you had been editing for twenty minutes went on showing
  the twenty-minute-old row — and closing the sheet was what started the
  refresh, which made closing the slow part. Michael: *"if I make changes in the
  fragment editor, that needs to propagate a change to the background in the
  browser, but it doesn't do it until the sheet is closed."*

  So a sheet now reports each change as it lands, and the hosts that can redraw
  quietly do it then. By the time you close, there is usually nothing left to
  do. What is NOT given up is the reload fallback: a live announcement nobody
  could fully answer leaves the debt standing, and the close-time
  `settle` pays it through `notifyFragmentsChanged` the old way — reload included.
*/

/** How long a burst of saves must go quiet before the list behind is redrawn.
 *  The writing sheet autosaves as you type; redrawing a table under every one
 *  of those would be main-thread work landing between keystrokes. */
const LIVE_SETTLE_MS = 1200;

export interface CorpusDebt {
  /** Something this sheet wrote is now on the server. Call it AFTER the write
   *  succeeds — announcing before it lands has the host refetch the old row. */
  changed: () => void;
  /** The sheet is shutting: settle whatever is still owed, falling back to a
   *  reload when no host can. Call it right after `closeWithExit(dialog)`. */
  settle: () => void;
}

/**
 * The bookkeeping between a sheet and the corpus behind it, in one place, so
 * neither sheet keeps its own flags for "did anything change" and "did anybody
 * hear about it".
 *
 * ⚠ THE DEBT OUTLIVES THE PIECE. It is about the LIST, not about what the sheet
 * is showing — so reopening the sheet on another fragment does not clear it.
 * (The writing sheet's old `everSaved` did exactly that: making a copy or
 * promoting a version set it, then reloaded the piece, which reset it, and the
 * list behind never heard about the copy.)
 */
export function corpusDebt(dialog: HTMLElement): CorpusDebt {
  let owed = false;
  let timer = 0;

  const isOpen = () => (dialog as HTMLDialogElement).open && !dialog.dataset.closing;

  function announceLive() {
    // Shut by a route that skipped our `settle` (Chromium closes a dialog
    // directly on a second Escape mid-exit — see dialog-close.ts). Nothing is
    // left to edit behind, so settle it the ordinary way.
    if (!isOpen()) {
      owed = false;
      notifyFragmentsChanged();
      return;
    }
    const detail: FragmentsChanged = { settled: Promise.resolve(), live: true };
    const claimed = !document.dispatchEvent(
      new CustomEvent<FragmentsChanged>('fragments:changed', { cancelable: true, detail }),
    );
    // Paid only when somebody redrew AND nobody asked to be told again later.
    if (claimed && !detail.heldForClose) owed = false;
  }

  return {
    changed() {
      clearTimeout(timer);
      if (isOpen()) {
        owed = true;
        timer = window.setTimeout(announceLive, LIVE_SETTLE_MS);
        return;
      }
      // A write that landed AFTER the sheet began to shut — a membership toggle
      // still in flight when you pressed ✕. `settle` has already run and found
      // nothing owed, so this one is told now rather than at some later close.
      owed = false;
      notifyFragmentsChanged(dialog.dataset.closing ? dialog : null);
    },
    settle() {
      clearTimeout(timer);
      if (!owed) return;
      owed = false;
      notifyFragmentsChanged(dialog);
    },
  };
}
