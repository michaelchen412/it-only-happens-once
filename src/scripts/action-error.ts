// Shared client helpers for every script that writes through `astro:actions`,
// so the same error-formatting, save lifecycle and time-stamping isn't
// hand-written once per room.
//
// ⚠ THE WHOLE FILE IS ABOUT ONE INVARIANT: `astro:actions` THROWS on a dead
// network rather than returning `{ error }`. Everything below is a different
// shape of the same defence, and `submitAction` is the one to reach for first —
// see its own note for why a comment was not enough.
import { isInputError } from 'astro:actions';

/**
 * Turn an Action error into one human sentence (field errors joined).
 *
 * Also handles what `astro:actions` *throws* rather than returns: a dead
 * network surfaces as a bare `TypeError: Failed to fetch` from the fetch
 * underneath, and that string must never reach a human — it reads like a bug
 * when it's just a missing connection.
 *
 * ⚠ CALL THIS. DO NOT HAND-ROLL `err instanceof Error ? err.message : '…'`.
 * That idiom looks equivalent and is the exact bug this function exists to
 * prevent: **`TypeError` extends `Error`**, so a dead network takes the *first*
 * branch and prints `Failed to fetch`, while the friendly fallback written for
 * the offline case is unreachable in precisely the case it was written for.
 * Every HQ save path shipped with that idiom between 2026-08-02 and 2026-08-04
 * and none of them could ever say the sentence they carried. Found by audit,
 * not by use — which is the point: it only misfires when the network is down,
 * which is never while you are testing.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function formatActionError(error: any): string {
  if (isInputError(error)) return Object.values(error.fields).flat().join(' · ');
  if (isNetworkError(error)) return 'You’re offline — the server can’t be reached right now.';
  return error?.message ?? 'Something went wrong.';
}

/**
 * Await an action and turn a THROW into an `{ error }` like any other failure.
 *
 * `astro:actions` does not hand back `{ error }` when the network is dead — the
 * fetch underneath throws, so a bare `await actions.x.y(...)` rejects and skips
 * whatever came after it. On an optimistic control that means the screen keeps
 * showing a change the database never received. Pair it with
 * `formatActionError`, which knows what a thrown `TypeError` means.
 */
export async function callAction<T>(p: Promise<{ data?: T; error?: unknown }>): Promise<{ data?: T; error?: unknown }> {
  try {
    return await p;
  } catch (e) {
    return { error: e };
  }
}

export interface SubmitOptions {
  /** The control to disable for the duration. Put back on failure. */
  button?: HTMLButtonElement | null;
  /**
   * What that control says while the work runs; its own contents come back.
   *
   * ⚠ It writes `textContent`, which REMOVES any element children — several
   * buttons in this admin hold an `<Icon>` beside their word. `restore` puts
   * the original child nodes back rather than re-writing the text, so the glyph
   * cannot be lost permanently; the first version of this restored
   * `button.textContent` and silently ate the trash icon on GoalSheet's Delete,
   * one file after the note warning about it was written. What it still does is
   * make the button REFLOW for the duration, so leave `busy` off where the
   * label is short and the icon is doing the work — TagSheet's Save and
   * GoalSheet's Delete are the two that opt out.
   */
  busy?: string;
  /** Where the one failure sentence goes. */
  onError: (message: string) => void;
  /**
   * Put the control back after a SUCCESS too. Default `false`, and the default
   * is the interesting half: almost every consumer navigates, reloads or
   * replaces its surface on success, and a button that flips back to **Save**
   * while the next page is still loading is both a lie about what is happening
   * and a second submit waiting to be pressed. Set this only where the control
   * OUTLIVES the save — a dialog that is closed and reopened rather than
   * replaced. (FragmentSheet's song form is the whole reason this option
   * exists: its Save has no validity rule to re-enable it on the way back in.)
   */
  reusable?: boolean;
}

/**
 * One lifecycle for one save: disable the control, say what it is doing, await
 * the work, and turn ANY failure — thrown or returned — into one sentence.
 *
 * Returns `{ ok: true, data }` or `{ ok: false }`, so a caller reads as
 * `if (!res.ok) return;` and never has to think about which kind of failure it
 * just had. The error is already on screen and the button is already back.
 *
 * ⚠ THIS IS A FUNCTION BECAUSE THE COMMENT DID NOT WORK. The invariant above
 * was carried by a warning pasted into sixteen files, and a full-repo audit on
 * 2026-08-08 ran the grep [15](docs/plans/archive/15-freshness.md) asked for:
 * nine of the fifty-nine scripts had missed the paste. One was the quote/song
 * Save, where a dead network left the button disabled for the life of the sheet
 * with nothing on screen at all. A convention that fails at 15% of its sites is
 * not a convention — so the lifecycle is encoded once, and the eight sheets
 * that hand-rolled it (goal, event, task, person, link, log, log-box, tag) are
 * its first consumers.
 *
 * ⚠ IT ALSO FIXES WHAT THE HAND-ROLLED COPIES GOT WRONG, which is easy to miss
 * when reading the diff as a pure move. Every one of them did
 * `if (error) throw new Error(error.message)` and then formatted the *rethrow* —
 * so a validation failure arrived as `astro:actions`' generic wrapper sentence
 * and the field-level messages `formatActionError` exists to join were thrown
 * away one line before it was called. The returned error is passed through
 * whole here.
 *
 * `work` is handed a `busy` setter for the multi-step case: PersonSheet saves a
 * row, uploads a photo, then points the row at it, and the label has to be able
 * to say which of the three is happening.
 */
export async function submitAction<T>(
  work: (busy: (label: string) => void) => Promise<{ data?: T; error?: unknown }>,
  { button, busy, onError, reusable = false }: SubmitOptions,
): Promise<{ ok: true; data?: T } | { ok: false }> {
  // The NODES, not the string — see `SubmitOptions.busy`. `textContent = …`
  // detaches these rather than destroying them, so putting the same array back
  // returns an `<Icon>` intact.
  const original = button ? [...button.childNodes] : [];
  const setBusy = (text: string) => {
    if (button) button.textContent = text;
  };
  const restore = () => {
    if (!button) return;
    button.disabled = false;
    if (busy) button.replaceChildren(...original);
  };

  if (button) button.disabled = true;
  if (busy) setBusy(busy);

  try {
    const { data, error } = await work(setBusy);
    if (error) {
      onError(formatActionError(error));
      restore();
      return { ok: false };
    }
    if (reusable) restore();
    return { ok: true, data };
  } catch (e) {
    // The reason this whole file exists: a dead network rejects here rather
    // than arriving as `error` above, and without this the control never comes
    // back and the screen never says why.
    onError(formatActionError(e));
    restore();
    return { ok: false };
  }
}

/** True when a failure is connectivity rather than an answer from the server. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isNetworkError(error: any): boolean {
  return error instanceof TypeError || (typeof navigator !== 'undefined' && navigator.onLine === false);
}

/** "3:45 PM" — the timestamp shown in save indicators (now, or a given epoch ms). */
export const nowTime = (at?: number) =>
  new Date(at ?? Date.now()).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
