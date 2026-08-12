// The link sheet and the Shared zone's unlink buttons (12 · Piece 3).
//
// Two modes over one dialog, a client-side filter over server-rendered rows,
// and a single-select. Everything reloads after a write for the same reason the
// About block does: the zone is rendered by the server, including the two-hop
// resolution of a work's fragments, and re-deriving any of that in the browser
// is how the saved shape and the shown shape start to disagree.
import { actions } from 'astro:actions';
import { wireRadioGroups } from './radio-group';
import { submitAction } from './action-error';
import { confirmDialog } from './confirm-dialog';
import { confirmDiscard, dirtyTracker, wireSheetDismiss } from './sheet-dismiss';
import { sheetError } from './sheet-error';

type Mode = 'work' | 'fragment';

const sheet = document.querySelector<HTMLDialogElement>('#link-sheet');
const zone = document.querySelector<HTMLElement>('[data-shared]');
const personId = zone?.dataset.personId;

/**
 * Two error targets, not one.
 *
 * ⚠ The sheet's own `#link-error` sits INSIDE a `<dialog>`, so an unlink
 * failure written there would be invisible: unlinking happens with the sheet
 * closed. A silent failure that leaves the row on screen reads as "it didn't
 * take", which is exactly the swallowed-save class of bug the check-in shipped.
 */
// By role rather than by `#link-error` — see `sheet-error.ts`.
//
// ⚠ `sheet`, NOT `document`, AND THE FIRST DRAFT GOT THAT WRONG. Passing
// `document` returns the FIRST error line in the page, and on a profile
// `PersonSheet` renders before this one — so every link failure was written
// into a hidden element belonging to another sheet and nothing appeared. That
// is the whole reason this function takes a root: an id was globally unique and
// a role is not, so the scope has to come from the caller. Caught by
// `links.spec.ts`, which asserts the sentence actually shows.
const sheetErrorEl = sheet ? sheetError(sheet) : null;
const zoneError = document.querySelector<HTMLElement>('[data-shared-error]');

const show = (el: HTMLElement | null, msg: string) => {
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
};
const clearError = () => {
  if (sheetErrorEl) sheetErrorEl.hidden = true;
  if (zoneError) zoneError.hidden = true;
};

if (sheet && personId) {
  /** Every gesture that leaves this sheet routes through `requestClose` below. */
  const dirty = dirtyTracker(sheet);

  const search = sheet.querySelector<HTMLInputElement>('[data-link-search]')!;
  const noteInput = sheet.querySelector<HTMLInputElement>('[data-link-note]')!;
  const saveBtn = sheet.querySelector<HTMLButtonElement>('[data-link-save]')!;
  const lists: Record<Mode, HTMLElement | null> = {
    work: sheet.querySelector('[data-list="work"]'),
    fragment: sheet.querySelector('[data-list="fragment"]'),
  };

  let mode: Mode = 'work';
  let picked: { id: string; label: string } | null = null;

  const setPicked = (next: typeof picked) => {
    picked = next;
    saveBtn.disabled = !next;
    // "Link Piranesi" rather than "Link" — the button names what it is about to
    // do, which is the only confirmation this action gets.
    saveBtn.textContent = next ? `Link ${next.label.slice(0, 24)}${next.label.length > 24 ? '…' : ''}` : 'Link';
  };

  /** Filter the VISIBLE list only; the hidden one is re-filtered when it shows. */
  function applyFilter() {
    const q = search.value.trim().toLowerCase();
    const list = lists[mode];
    if (!list) return;
    let shown = 0;
    list.querySelectorAll<HTMLElement>('[data-pick]').forEach((row) => {
      const hit = !q || (row.dataset.search ?? '').includes(q);
      row.hidden = !hit;
      if (hit) shown++;
    });
    const none = list.querySelector<HTMLElement>('[data-none]');
    if (none) none.hidden = shown > 0 || !q;
  }

  function setMode(next: Mode) {
    mode = next;
    sheet!
      .querySelectorAll<HTMLButtonElement>('[data-mode]')
      .forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === next)));
    for (const [key, el] of Object.entries(lists)) if (el) el.hidden = key !== next;
    // "Add a quote from them" belongs to the fragment mode only — a work is
    // created by the quote's own Work field, so offering it here would point
    // at the wrong door.
    const addQuote = sheet!.querySelector<HTMLElement>('[data-add-quote]');
    if (addQuote) addQuote.hidden = next !== 'fragment';
    // A selection does not survive a mode switch: the id would still be valid
    // and would link the wrong KIND of thing, silently.
    sheet!.querySelectorAll('.picker__row.is-on').forEach((r) => r.classList.remove('is-on'));
    setPicked(null);
    applyFilter();
  }

  sheet
    .querySelectorAll<HTMLButtonElement>('[data-mode]')
    .forEach((btn) => btn.addEventListener('click', () => setMode(btn.dataset.mode as Mode)));

  search.addEventListener('input', applyFilter);

  sheet.addEventListener('click', (e) => {
    const row = (e.target as Element).closest<HTMLElement>('[data-pick]');
    if (!row || !sheet.contains(row)) return;
    const already = row.classList.contains('is-on');
    sheet.querySelectorAll('.picker__row.is-on').forEach((r) => r.classList.remove('is-on'));
    // Clicking the chosen row again clears it, so a mis-tap has a way back that
    // is not "close the sheet and start over".
    if (already) return setPicked(null);
    row.classList.add('is-on');
    setPicked({ id: row.dataset.id!, label: row.dataset.label ?? 'this' });
  });

  document.querySelectorAll<HTMLElement>('[data-open-link-sheet]').forEach((btn) =>
    btn.addEventListener('click', () => {
      clearError();
      search.value = '';
      noteInput.value = '';
      setMode('work');
      dirty.reset(); // populating is not editing — see dirtyTracker
      sheet.showModal();
      search.focus();
    }),
  );

  /*
    ⚠ THE ✕, ESCAPE AND THE BACKDROP ALL MEAN "I WANT OUT" (ADR 0032). This
    sheet answered only the first for its whole life — clicking away did
    nothing at all, which reads as stuck and sends the reader to the browser's
    Back button, where far more is lost than the sheet would have cost.
  
    It GUARDS because it has something to lose: an explicit-save form holds
    everything typed into it until the button is pressed. The confirm cannot
    fire on a sheet nobody edited — the tracker is reset after every populate —
    so this costs nothing on the common path.
  */
  async function requestClose() {
    if (dirty.get() && !(await confirmDiscard('This link'))) return;
    dirty.reset();
    // `!` because a hoisted `async function` cannot inherit the narrowing
    // from the `if (sheet && …)` around it — the same reason this file already
    // writes `sheet!` at its other exits.
    sheet!.close();
  }
  wireSheetDismiss(sheet, requestClose);

  saveBtn.addEventListener('click', async () => {
    if (!picked) return;
    clearError();
    const note = noteInput.value.trim() || null;
    const target = picked;
    // The lifecycle is `submitAction` now (docs/plans/25 · §2). The reason it
    // is not optional here is unchanged: `astro:actions` THROWS on a dead
    // network, and a swallowed failure leaves this button stuck saying
    // "Linking…" forever — the exact bug the check-in shipped with.
    // `<unknown>`: the two branches return differently-shaped `data`, so there
    // is no single `T` to infer — and nothing here reads it. Naming the type
    // parameter is the whole fix; widening either action would be worse.
    const res = await submitAction<unknown>(
      () =>
        mode === 'work'
          ? actions.links.work({ personId, workId: target.id, note })
          : actions.links.fragment({ personId, fragmentId: target.id, note }),
      { button: saveBtn, busy: 'Linking…', onError: (m) => show(sheetErrorEl, m) },
    );
    if (!res.ok) return;
    location.reload();
  });
}

// ── unlinking, from the shelf ─────────────────────────────────────────────
// Guarded, though nothing is destroyed: the work and the fragment are both
// untouched, and only the attribution goes. The confirm exists because that
// attribution is the part you cannot reconstruct — you will remember the book
// and not who gave it to you, which is the whole reason this table exists.
zone?.querySelectorAll<HTMLButtonElement>('[data-unlink]').forEach((btn) =>
  btn.addEventListener('click', async () => {
    if (!personId) return;
    const kind = btn.dataset.unlink as Mode;
    const label = btn.dataset.label ?? 'this';
    const ok = await confirmDialog({
      title: 'Remove the link?',
      message: `“${label}” stays in the corpus exactly as it is. Only the connection to this person goes.`,
      confirmLabel: 'Unlink',
    });
    if (!ok) return;

    const res = await submitAction<unknown>(
      () =>
        kind === 'work'
          ? actions.links.unlinkWork({ personId, workId: btn.dataset.id! })
          : actions.links.unlinkFragment({ personId, fragmentId: btn.dataset.id! }),
      // The ZONE's error box, not the sheet's — the sheet is closed when you
      // unlink, so a sentence written inside it would be invisible. See the
      // note on the two targets at the top of this file.
      { button: btn, onError: (m) => show(zoneError, m) },
    );
    if (!res.ok) return;
    location.reload();
  }),
);

// The role promises arrow keys and one tab stop; this is what keeps it
// (plan 38 · §6.3). Idempotent — every group is wired exactly once.
wireRadioGroups();
